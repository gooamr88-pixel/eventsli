import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlanPanel, ToolPanel, ItemPanel, MultiPanel } from '../src/app/organizer/events/[id]/vendors/FloorPlanPanels';
import { forgetSections } from '../src/app/components/inspector/Inspector';

/**
 * The vendor floor plan's side panel (2026-11-21), on the same Inspector as
 * the seating map: a held booth cannot be deleted from it, a selection shows
 * the booth type it shares, and the Booth / Row tools keep their options in
 * the panel instead of a strip above the canvas.
 */
const types = [{ id: 'bt1', name: 'Food', priceCents: 50000 }, { id: 'bt2', name: 'Craft', priceCents: 0 }];
const booth = (over = {}) => ({ id: 'b1', kind: 'booth', code: 'DB1', x: 10, y: 10, w: 60, h: 60, r: 0, blocked: false, boothTypeId: 'bt1', ...over });

beforeEach(() => { window.localStorage.clear(); forgetSections(); });

describe('one booth', () => {
  test('a booth a vendor holds says who, and cannot be deleted', () => {
    render(<ItemPanel e={booth()} update={() => {}} boothTypes={types} state={{ status: 'sold', vendor: { name: 'Taco Co' } }} onDelete={() => {}} onDuplicate={() => {}} rotatable />);
    expect(screen.getByText(/Booked — Taco Co/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Available to book' })).toBeDisabled();
  });

  test('availability is a switch that stores blocked', async () => {
    const update = vi.fn();
    render(<ItemPanel e={booth()} update={update} boothTypes={types} onDelete={() => {}} onDuplicate={() => {}} rotatable />);
    await userEvent.click(screen.getByRole('switch', { name: 'Available to book' }));
    expect(update.mock.calls[0][0](booth())).toMatchObject({ blocked: true });
  });

  test('Rotate turns it 15°, as the R key does', async () => {
    const update = vi.fn();
    render(<ItemPanel e={booth({ r: 30 })} update={update} boothTypes={types} onDelete={() => {}} onDuplicate={() => {}} rotatable />);
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(update.mock.calls[0][0](booth({ r: 30 }))).toMatchObject({ r: 45 });
  });
});

describe('several booths', () => {
  test('the booth type shows Mixed when they differ, and choosing sets all', async () => {
    const update = vi.fn();
    render(<MultiPanel items={[booth(), booth({ id: 'b2', boothTypeId: 'bt2' })]} update={update} boothTypes={types} onDelete={() => {}} onDuplicate={() => {}} isHeld={() => false} />);
    const select = screen.getByLabelText('Booth type for all 2');
    expect(select).toHaveValue('__mixed__');
    await userEvent.selectOptions(select, 'bt2');
    expect(update.mock.calls[0][0](booth())).toMatchObject({ boothTypeId: 'bt2' });
  });

  test('a selection with a held booth cannot be deleted', () => {
    render(<MultiPanel items={[booth(), booth({ id: 'b2' })]} update={() => {}} boothTypes={types} onDelete={() => {}} onDuplicate={() => {}} isHeld={(id) => id === 'b2'} />);
    expect(screen.getByRole('button', { name: 'Delete 2 selected' })).toBeDisabled();
  });
});

describe('tools and the hall', () => {
  test('a size preset sets the row’s width and depth', async () => {
    const setRowForm = vi.fn();
    const form = { count: 6, w: 60, h: 60, direction: 'right', prefix: 'A', boothTypeId: '' };
    render(<ToolPanel tool="row" label="Row of booths" icon="layers" hint="Click where the first booth goes." rowForm={form} setRowForm={setRowForm} boothTypes={types} onFinishWall={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: /Square/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /Corridor/ }));
    expect(setRowForm.mock.calls[0][0](form)).toMatchObject({ w: 45, h: 18 });
  });

  test('the wall tool finishes from the panel once it has two corners', () => {
    const { rerender } = render(<ToolPanel tool="wall" label="Wall" icon="pencil" rowForm={{}} setRowForm={() => {}} boothTypes={[]} draftWall={[[0, 0]]} onFinishWall={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Finish wall' })).toBeDisabled();
    rerender(<ToolPanel tool="wall" label="Wall" icon="pencil" rowForm={{}} setRowForm={() => {}} boothTypes={[]} draftWall={[[0, 0], [10, 0]]} onFinishWall={() => {}} onDone={() => {}} />);
    expect(screen.getByRole('button', { name: 'Finish wall' })).toBeEnabled();
  });

  test('the hall panel counts booths by state', () => {
    const plan = { width: 1200, height: 800, elements: [booth(), booth({ id: 'b2' }), booth({ id: 'b3', blocked: true })] };
    render(<PlanPanel plan={plan} commit={() => {}} boothTypes={types} currency="USD" states={{ b1: { status: 'sold' } }} />);
    const facts = document.querySelector('.es-insp__facts');
    const value = (name) => [...facts.querySelectorAll('dt')].find((dt) => dt.textContent === name).nextSibling.textContent;
    expect(value('Free')).toBe('1');
    expect(value('Booked')).toBe('1');
    expect(value('Unavailable')).toBe('1');
  });
});
