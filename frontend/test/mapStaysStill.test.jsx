import { describe, test, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { usePanZoom } from '../src/app/components/seating/usePanZoom';

/**
 * "No moving when creating an event or browsing seats, it's annoying" (owner,
 * 2026-11-19). The map moves only when asked: a bare wheel is the page's, a
 * moved map is never re-framed by a content change, and touch is cooperative.
 */
const BOX = { x: 0, y: 0, width: 1000, height: 700 };

// What the harness last rendered, reported from an effect (never written
// during render).
let api = null;
let setBox = null;
function Harness({ options, onApi }) {
  const [bounds, set] = useState(BOX);
  const pz = usePanZoom(bounds, options);
  const { svgRef, view, handlers, touchAction } = pz;
  useEffect(() => { onApi(pz, set); }, [onApi, pz]);
  return (
    <svg
      ref={svgRef} data-testid="map" style={{ touchAction }}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} {...handlers}
    />
  );
}

function mount(options) {
  const out = render(<Harness options={options} onApi={(pz, set) => { api = pz; setBox = set; }} />);
  const svg = out.getByTestId('map');
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 350, right: 500, bottom: 350 });
  return svg;
}

describe('the map stays still unless asked', () => {
  test('a bare wheel leaves the map alone and says how to zoom', () => {
    const svg = mount();
    const before = { ...api.view };
    const e = new WheelEvent('wheel', { deltaY: 100, clientX: 250, clientY: 175, bubbles: true, cancelable: true });
    act(() => { svg.dispatchEvent(e); });
    expect(api.view).toEqual(before);
    expect(e.defaultPrevented).toBe(false);   // the page scrolls
    expect(api.hint).toBe('wheel');
  });

  test('Ctrl + wheel (and a trackpad pinch) zooms, and the page does not', () => {
    const svg = mount();
    const e = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 250, clientY: 175, bubbles: true, cancelable: true });
    act(() => { svg.dispatchEvent(e); });
    expect(api.view.width).toBeLessThan(BOX.width);
    expect(e.defaultPrevented).toBe(true);
  });

  test('once moved, a content change does not re-frame it', () => {
    const svg = mount();
    act(() => { svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: 250, clientY: 175, cancelable: true })); });
    const zoomed = { ...api.view };
    act(() => setBox({ x: -50, y: -50, width: 1200, height: 800 }));
    expect(api.view).toEqual(zoomed);
  });

  test('untouched, it still frames content that arrives', () => {
    mount();
    act(() => setBox({ x: -50, y: -50, width: 1200, height: 800 }));
    expect(api.view).toEqual({ x: -50, y: -50, width: 1200, height: 800 });
  });

  test('touch is cooperative on buyer maps', () => {
    expect(mount().style.touchAction).toBe('pan-x pan-y');
  });

  test('touch is direct in the editor, where one finger drags tables', () => {
    expect(mount({ touch: 'direct', follow: 'always', wheelMode: 'pan' }).style.touchAction).toBe('none');
  });

  test('a one-finger swipe the page took shows the two-finger hint', () => {
    const svg = mount();
    fireEvent.pointerDown(svg, { pointerId: 1, pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerCancel(svg, { pointerId: 1, pointerType: 'touch' });
    expect(api.hint).toBe('touch');
  });
});
