import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TablePanel from '../src/app/organizer/events/[id]/map/TablePanel';
import ZonePanel from '../src/app/organizer/events/[id]/map/ZonePanel';
import SelectionPanel from '../src/app/organizer/events/[id]/map/SelectionPanel';
import { EventProvider } from '../src/app/organizer/events/[id]/EventContext';
import { makeZone } from '../src/app/components/seating/layoutZones';
import { forgetSections } from '../src/app/components/inspector/Inspector';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(async () => ({ looks: [] })), put: vi.fn(), post: vi.fn() }));
import MapPanel from '../src/app/organizer/events/[id]/map/MapPanel';

/**
 * The seating map's inspector (2026-11-21): one panel shape for a table, an
 * area, a selection and the whole map — sections in the order the job needs
 * them, the money before the colours, and the same footer every time.
 */
const tiers = [{ id: 't-vip', name: 'VIP', priceCents: 9000 }, { id: 't-std', name: 'Standard', priceCents: 4000 }];
const table = (over = {}) => ({
  localKey: 'k1', label: 'T1', shape: 'round', seatCount: 8, position: { x: 10, y: 10, rotation: 0 }, ...over,
});
const withEvent = (ui) => render(<EventProvider value={{ eventId: 'e1', event: { id: 'e1', currency: 'USD', slug: 'gala' } }}>{ui}</EventProvider>);
const sectionTitles = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent.replace(/\s+/g, ' ').trim());

beforeEach(() => { window.localStorage.clear(); forgetSections(); });

describe('the table inspector', () => {
  test('sections run basics → tickets → availability → access → appearance, and appearance starts folded', () => {
    withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} onChange={() => {}} onRemove={() => {}} />);
    const titles = sectionTitles();
    expect(titles[0]).toMatch(/^Table/);
    expect(titles[1]).toMatch(/^Tickets & price/);
    expect(titles[2]).toMatch(/^Availability/);
    expect(titles[3]).toMatch(/^Private access/);
    expect(titles[4]).toMatch(/^Appearance/);
    // Pricing is open and reachable; the colours are not in the way.
    expect(screen.getByLabelText('Ticket type')).toBeVisible();
    expect(screen.queryByLabelText('Table colour')).toBeNull();
  });

  test('selling seats only, the whole-table price is not offered', async () => {
    withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} purchaseMode="seat_only" onChange={() => {}} onRemove={() => {}} />);
    // The extras wait behind one fold: only the ticket type up front.
    expect(screen.queryByLabelText('Seat price')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /More pricing options/ }));
    expect(screen.queryByLabelText('Whole-table price')).toBeNull();
    expect(screen.getByLabelText('Seat price')).toBeInTheDocument();
  });

  test('the pricing extras open by themselves when one is already set', () => {
    withEvent(<TablePanel table={table({ seatPriceCents: 2500 })} tiers={tiers} categories={[]} purchaseMode="seat_only" onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText('Seat price').value).toMatch(/^25/);
  });

  test('five common shapes first, the rest behind More shapes', async () => {
    withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.queryByRole('button', { name: /Hexagon/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /More shapes/ }));
    expect(screen.getByRole('button', { name: /Hexagon/ })).toBeInTheDocument();
  });

  test('selling whole tables only, the table price comes first and there is no seat price', () => {
    withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} purchaseMode="table_only" onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText('Whole-table price')).toBeInTheDocument();
    expect(screen.queryByLabelText('Seat price')).toBeNull();
  });

  test('an unpriced table says so inside the pricing section', () => {
    withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByText(/aren’t on sale yet/)).toBeInTheDocument();
  });

  test('a private table opens its access section, whatever was remembered', () => {
    withEvent(<TablePanel table={table({ isPrivate: true })} tiers={tiers} categories={[]} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByRole('switch', { name: 'Private table' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  test('a section opened on one table stays open on the next', async () => {
    const { unmount } = withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} onChange={() => {}} onRemove={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Appearance/ }));
    expect(screen.getByLabelText('Table colour')).toBeInTheDocument();
    unmount();
    withEvent(<TablePanel table={table({ localKey: 'k2', label: 'T2' })} tiers={tiers} categories={[]} onChange={() => {}} onRemove={() => {}} />);
    expect(screen.getByLabelText('Table colour')).toBeInTheDocument();
  });

  test('the footer is Rotate, Duplicate, Delete — and Delete removes this table', async () => {
    const onRemove = vi.fn();
    withEvent(<TablePanel table={table()} tiers={tiers} categories={[]} onChange={() => {}} onRotate={() => {}} onDuplicate={() => {}} onRemove={onRemove} />);
    const footer = document.querySelector('.es-insp__actions');
    expect(within(footer).getAllByRole('button').map((b) => b.textContent)).toEqual(['Rotate', 'Duplicate', 'Delete']);
    await userEvent.click(within(footer).getByRole('button', { name: 'Delete' }));
    expect(onRemove).toHaveBeenCalledWith('k1');
  });

  test('a private toggle off clears the password too', async () => {
    const onChange = vi.fn();
    withEvent(<TablePanel table={table({ isPrivate: true })} tiers={tiers} categories={[]} onChange={onChange} onRemove={() => {}} />);
    await userEvent.click(screen.getByRole('switch', { name: 'Private table' }));
    expect(onChange).toHaveBeenCalledWith('k1', { isPrivate: false, password: '' });
  });
});

describe('the area inspector', () => {
  test('sizes are in metres, and a wall has one thickness control, not two', () => {
    const wall = { ...makeZone('wall', { x: 10, y: 10 }), w: 200, h: 6 };
    render(<ZonePanel zone={wall} onChange={() => {}} onRotate={() => {}} onResetSize={() => {}} onDuplicate={() => {}} onRemove={() => {}} />);
    expect(screen.getAllByLabelText(/Thickness/)).toHaveLength(1);
    // 200 units at 0.55 m a seat pitch is a few metres, not "200".
    expect(Number(screen.getByLabelText('Length').value)).toBeLessThan(10);
  });

  test('typing a size in metres stores units', async () => {
    const onChange = vi.fn();
    const stage = makeZone('stage', { x: 10, y: 10 });
    render(<ZonePanel zone={stage} onChange={onChange} onRotate={() => {}} onResetSize={() => {}} onDuplicate={() => {}} onRemove={() => {}} />);
    const width = screen.getByLabelText('Width');
    await userEvent.clear(width);
    await userEvent.type(width, '5');
    const [, patch] = onChange.mock.calls.at(-1);
    expect(patch.w).toBeGreaterThan(100);
  });
});

describe('the selection inspector', () => {
  test('the ticket type shows the shared value, or Mixed, instead of resetting', () => {
    const { rerender } = render(
      <SelectionPanel tables={[table({ tierId: 't-vip' }), table({ localKey: 'k2', tierId: 't-vip' })]} tiers={tiers} onAssign={() => {}} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByLabelText(/Ticket type for all 2 tables/)).toHaveValue('t-vip');
    rerender(
      <SelectionPanel tables={[table({ tierId: 't-vip' }), table({ localKey: 'k2', tierId: 't-std' })]} tiers={tiers} onAssign={() => {}} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByLabelText(/Ticket type for all 2 tables/)).toHaveValue('__mixed__');
  });

  test('choosing a ticket type assigns it to every selected table', async () => {
    const onAssign = vi.fn();
    render(<SelectionPanel tables={[table(), table({ localKey: 'k2' })]} tiers={tiers} onAssign={onAssign} onRotate={() => {}} onDuplicate={() => {}} onRemove={() => {}} onClear={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText(/Ticket type for all 2 tables/), 't-std');
    expect(onAssign).toHaveBeenCalledWith('t-std');
  });
});

describe('the whole-map inspector', () => {
  test('one button selects exactly the tables that cannot be sold yet', async () => {
    const onSelectUnpriced = vi.fn();
    render(<MapPanel tableCount={10} unpricedCount={4} purchaseMode="seat_only" onSelectUnpriced={onSelectUnpriced} look={null} onLookChange={() => {}} onApplyLook={() => {}} />);
    expect(screen.getByText('4 of 10 still need a ticket type.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select these 4' }));
    expect(onSelectUnpriced).toHaveBeenCalled();
  });

  test('a priced, saved map is ready to sell and offers nothing to fix', () => {
    render(<MapPanel tableCount={3} unpricedCount={0} purchaseMode="seat_only" onSelectUnpriced={() => {}} look={null} onLookChange={() => {}} onApplyLook={() => {}} />);
    expect(screen.getByRole('button', { name: /Ready to sell/ })).toBeInTheDocument();
    expect(screen.getByText('Everything is on sale.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Select/ })).toBeNull();
  });

  test('the checklist walks an empty map: add seating first, then price, then save', async () => {
    const onAdd = vi.fn();
    const onSave = vi.fn();
    const { rerender } = render(<MapPanel tableCount={0} unpricedCount={0} purchaseMode="seat_only" onAdd={onAdd} look={null} onLookChange={() => {}} onApplyLook={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /Add rows of seats/ }));
    expect(onAdd).toHaveBeenCalledWith({ family: 'section' });
    rerender(<MapPanel tableCount={4} unpricedCount={0} purchaseMode="seat_only" dirty canSave onSave={onSave} look={null} onLookChange={() => {}} onApplyLook={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save map' }));
    expect(onSave).toHaveBeenCalled();
  });
});
