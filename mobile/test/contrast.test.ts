/**
 * Colour contrast for every text / background pair the screens use (WCAG 2.2):
 * 4.5:1 for text, 3:1 for icons and large bold text (1.4.3, 1.4.11). A door is
 * a bright foyer or a dark street, and the person reading may be squinting at
 * a phone held at arm's length.
 */
import { colors, tones } from '../src/ui/theme';

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const TEXT: [string, string, string][] = [
  ['body text on white', colors.text, colors.bg],
  ['body text on the sunken panels', colors.text, colors.bgSunken],
  ['muted text on white', colors.muted, colors.bg],
  ['muted text on the sunken panels', colors.muted, colors.bgSunken],
  ['subtle captions on white', colors.subtle, colors.bg],
  ['input placeholders on the search field', colors.placeholder, colors.bgSunken],
  ['links and the accent on white', colors.accent, colors.bg],
  ['button labels on the accent', colors.onAccent, colors.accent],
  ...Object.entries(tones).map(([name, t]) => [`${name} answer text on its own wash`, t.fg, t.soft] as [string, string, string]),
  ...Object.entries(tones).map(([name, t]) => [`${name} text on white`, t.fg, colors.bg] as [string, string, string]),
];

const GRAPHICS: [string, string, string][] = [
  ...Object.entries(tones).map(([name, t]) => [`the white mark on the ${name} disc`, colors.white, t.strong] as [string, string, string]),
  ['white camera badges on the teal', colors.white, colors.teal700],
];

test.each(TEXT)('%s: at least 4.5:1', (_label, fg, bg) => {
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
});

test.each(GRAPHICS)('%s: at least 3:1', (_label, fg, bg) => {
  expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
});
