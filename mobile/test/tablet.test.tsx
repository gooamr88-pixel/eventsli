/**
 * The iPad (2026-11-18). The app follows the WINDOW, not the device: on iOS 27
 * an iPad window can be any width, so these tests drive the window size and
 * check three things:
 *
 *   1. the phone is untouched: below 600 pt the layout is the mockup's exactly
 *      (20-point gutter, no maximum width, bottom sheets);
 *   2. an iPad gets centred, bounded content, a centred tab bar and sheets as
 *      cards;
 *   3. the build is configured for it: iPad on, iPhone portrait, and every
 *      Modal willing to appear in landscape.
 */
import { act, render, screen } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Sheet } from '../src/ui/Dialog';
import { Screen } from '../src/ui/layout';
import {
  BREAKPOINT, columnStyle, contentWidth, gridColumns, layoutFor, MAX_WIDTH, sizeClassFor,
} from '../src/ui/responsive';

const PHONE = { width: 390, height: 844 };
const IPAD_PORTRAIT = { width: 820, height: 1180 };
const IPAD_LANDSCAPE = { width: 1366, height: 1024 };

async function setWindow({ width, height }: { width: number; height: number }) {
  const dims = { width, height, scale: 2, fontScale: 1 };
  await act(async () => { Dimensions.set({ window: dims, screen: dims }); });
}

async function show(node: React.ReactNode, size: { width: number; height: number }) {
  await setWindow(size);
  const metrics = { frame: { x: 0, y: 0, ...size }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  await render(<SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>);
}

afterEach(async () => { await setWindow(PHONE); });

describe('size classes', () => {
  test('every iPhone is compact, an iPad is regular or wide', () => {
    expect(sizeClassFor(320)).toBe('compact');
    expect(sizeClassFor(440)).toBe('compact'); // iPhone Pro Max
    expect(sizeClassFor(BREAKPOINT.regular - 1)).toBe('compact');
    expect(sizeClassFor(744)).toBe('regular'); // iPad mini, portrait
    expect(sizeClassFor(834)).toBe('regular'); // iPad Pro 11", portrait
    expect(sizeClassFor(1024)).toBe('wide'); // iPad Pro 13", portrait
    expect(sizeClassFor(1366)).toBe('wide'); // iPad Pro 13", landscape
  });

  test('the phone layout keeps the mockup: a 20-point gutter and no maximum width', () => {
    const phone = layoutFor(PHONE.width, PHONE.height);
    expect(phone.gutter).toBe(20);
    for (const kind of ['form', 'column', 'page'] as const) {
      const style = columnStyle(phone, kind);
      expect(style).toMatchObject({ paddingHorizontal: 20, width: '100%' });
      expect(style.maxWidth).toBeUndefined();
    }
  });

  test('content stops growing at its maximum width on a big screen', () => {
    const big = layoutFor(IPAD_LANDSCAPE.width, IPAD_LANDSCAPE.height);
    expect(big.landscape).toBe(true);
    expect(contentWidth(big, 'column')).toBe(MAX_WIDTH.column - big.gutter * 2);
    expect(contentWidth(big, 'page')).toBe(MAX_WIDTH.page - big.gutter * 2);
  });

  test('a grid fits as many cards as there is room for, between one and three', () => {
    expect(gridColumns(300, 300, 16)).toBe(1);
    expect(gridColumns(756, 300, 16)).toBe(2); // iPad portrait
    expect(gridColumns(1100, 300, 16)).toBe(3); // iPad landscape
    expect(gridColumns(5000, 300, 16)).toBe(3);
    expect(gridColumns(100, 300, 16)).toBe(1);
  });
});

describe('Screen', () => {
  test('on a phone the content is full width with the 20-point gutter', async () => {
    await show(<Screen width="column"><Text>Hello</Text></Screen>, PHONE);
    const style = StyleSheet.flatten(screen.getByTestId('screen-content').props.style);
    expect(style.paddingHorizontal).toBe(20);
    expect(style.maxWidth).toBeUndefined();
  });

  test('on an iPad the content is a centred column', async () => {
    await show(<Screen width="column"><Text>Hello</Text></Screen>, IPAD_PORTRAIT);
    const style = StyleSheet.flatten(screen.getByTestId('screen-content').props.style);
    expect(style.maxWidth).toBe(MAX_WIDTH.column);
    expect(style.alignSelf).toBe('center');
    expect(style.paddingHorizontal).toBe(32);
  });

  test('it follows the window when an iPad window is resized', async () => {
    await show(<Screen width="form"><Text>Hello</Text></Screen>, IPAD_LANDSCAPE);
    expect(StyleSheet.flatten(screen.getByTestId('screen-content').props.style).paddingHorizontal).toBe(40);
    await setWindow({ width: 375, height: 1024 }); // Split View, a third of the screen
    expect(StyleSheet.flatten(screen.getByTestId('screen-content').props.style).paddingHorizontal).toBe(20);
  });
});

describe('Sheet', () => {
  test('rises from the bottom edge on a phone', async () => {
    await show(<Sheet visible onClose={() => undefined}><Text>Body</Text></Sheet>, PHONE);
    expect(StyleSheet.flatten(screen.getByTestId('sheet').props.style).maxWidth).toBeUndefined();
  });

  test('is a card in the middle of an iPad', async () => {
    await show(<Sheet visible onClose={() => undefined}><Text>Body</Text></Sheet>, IPAD_PORTRAIT);
    expect(StyleSheet.flatten(screen.getByTestId('sheet').props.style).maxWidth).toBe(560);
  });
});

describe('the build', () => {
  const root = join(__dirname, '..');
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')).expo;

  test('runs full screen on an iPad, in every orientation and in Split View', () => {
    expect(app.ios.supportsTablet).toBe(true);
    // Leaving this off is what lets iPadOS resize the window; App Store
    // Connect also refuses an iPad build that requires full screen with only
    // portrait orientations (ITMS-90474).
    expect(app.ios.requireFullScreen).not.toBe(true);
  });

  test('keeps the iPhone in portrait', () => {
    expect(app.orientation).toBe('portrait');
  });

  test('every Modal can appear in landscape (React Native defaults to portrait only)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx$/.test(name)) files.push(p);
      }
    };
    walk(join(root, 'src'));
    const modals = files.flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      return [...src.matchAll(/<Modal\b[^>]*>/g)].map((m) => ({ file: f, tag: m[0] }));
    });
    expect(modals.length).toBeGreaterThan(0);
    for (const m of modals) expect([m.file, m.tag.includes('supportedOrientations')]).toEqual([m.file, true]);
  });
});
