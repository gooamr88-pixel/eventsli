import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShapePicker, SeatsPerSide, TableAppearance } from '../src/app/organizer/events/[id]/map/style/TableStyleSection';
import ZoneStyleSection from '../src/app/organizer/events/[id]/map/style/ZoneStyleSection';
import WallToolPanel from '../src/app/organizer/events/[id]/map/style/WallToolPanel';

/**
 * Every styling panel renders, for every kind of thing it styles. A panel
 * that throws takes the whole Venue Builder down with it.
 */
describe('table style', () => {
  test('seats per side change the seat count with them', async () => {
    const onChange = vi.fn();
    render(<SeatsPerSide table={{ label: 'S04', shape: 'd_shape', seatCount: 3, style: null }} onChange={onChange} />);
    expect(screen.getByText('Curved side')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'One more, Curved side' }));
    expect(onChange).toHaveBeenCalledWith({ seatCount: 4, style: { sides: { top: 0, right: 2, bottom: 0, left: 2 } } });
  });

  test('a new shape starts from its own seat spread', async () => {
    const onChange = vi.fn();
    render(<ShapePicker table={{ label: 'T1', shape: 'rect', seatCount: 6, style: { sides: { top: 3, bottom: 3 }, fill: '#8c8c8c' } }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /More shapes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Pill/ }));
    expect(onChange).toHaveBeenCalledWith({ shape: 'pill', style: { fill: '#8c8c8c' } });
  });

  test('every shape renders', () => {
    for (const shape of ['round', 'row', 'half_moon', 'high_top', 'u_shape', 'hexagon']) {
      const t = { label: 'T', shape, seatCount: 6, style: null };
      const { unmount } = render(<><ShapePicker table={t} onChange={() => {}} /><SeatsPerSide table={t} onChange={() => {}} /><TableAppearance table={t} onChange={() => {}} /></>);
      unmount();
    }
  });
});

describe('area style', () => {
  test('every kind renders its own controls', () => {
    for (const kind of ['bar', 'wall', 'door_gap', 'text', 'decor']) {
      const { unmount } = render(
        <ZoneStyleSection zone={{ id: `z-${kind}`, kind, w: 80, h: 40, sublabel: 'Tea · Drinks' }} colour="#0e3a4a" onChange={() => {}} />,
      );
      unmount();
    }
  });

  test('hiding the name stores showLabel: false', async () => {
    const onChange = vi.fn();
    render(<ZoneStyleSection zone={{ id: 'z1', kind: 'custom', w: 80, h: 40 }} colour="#0e3a4a" onChange={onChange} />);
    await userEvent.click(screen.getByLabelText('Show name'));
    expect(onChange).toHaveBeenCalledWith({ showLabel: false }, { mergeKey: 'z1:showLabel' });
  });
});

test('the wall tool panel finishes and cancels', async () => {
  const tool = {
    options: { thickness: 6, snap45: true }, setOptions: vi.fn(), points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], finish: vi.fn(), cancel: vi.fn(),
  };
  render(<WallToolPanel tool={tool} />);
  await userEvent.click(screen.getByRole('button', { name: 'Finish walls' }));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(tool.finish).toHaveBeenCalled();
  expect(tool.cancel).toHaveBeenCalled();
});
