import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * ONE TAP CHOOSES in 3D (owner, 2026-11-24: "no select then select"), and a
 * private table in 3D asks for its password with the tapped seat attached.
 * The WebGL scene is replaced by a list of its seats, each a button calling
 * the same `onPick` the real scene calls.
 */
vi.mock('../src/app/components/venue/VenueScene3D', () => ({
  default: ({ model, onPick }) => (
    <div>
      {(model?.seats || []).map((entry) => (
        <button key={entry.id} type="button" onClick={() => onPick(entry)}>{`3D seat ${entry.seat?.id}`}</button>
      ))}
    </div>
  ),
}));

const { default: VenueExperience } = await import('../src/app/components/venue/VenueExperience');

const table = (over = {}) => ({
  id: 't1', label: 'A1', seatCount: 2, priceCents: 10000, shape: 'round', status: 'available',
  canBookWhole: true, isPrivate: false, position: { x: 50, y: 50, rotation: 0 }, ...over,
});
const seats = (tableId, over = {}) => [1, 2].map((n) => ({
  id: `${tableId}-s${n}`, tableId, number: String(n), priceCents: 5000, available: true, tierId: null, ...over,
}));

async function in3d(props) {
  const user = userEvent.setup();
  render(<VenueExperience currency="USD" {...props} />);
  await user.click(screen.getByRole('radio', { name: /3D/ }));
  return user;
}

describe('the 3D room', () => {
  test('tapping an open seat chooses it at once', async () => {
    const onSelectSeat = vi.fn();
    const user = await in3d({ tables: [table()], seats: seats('t1'), onSelectSeat });
    await user.click(screen.getByRole('button', { name: '3D seat t1-s1' }));
    expect(onSelectSeat).toHaveBeenCalledTimes(1);
    expect(onSelectSeat.mock.calls[0][0]).toMatchObject({ id: 't1-s1' });
  });

  test('tapping a seat already chosen does not drop it', async () => {
    const onSelectSeat = vi.fn();
    const user = await in3d({ tables: [table()], seats: seats('t1'), onSelectSeat, selectedSeatIds: new Set(['t1-s1']) });
    await user.click(screen.getByRole('button', { name: '3D seat t1-s1' }));
    expect(onSelectSeat).not.toHaveBeenCalled();
  });

  test('a private table asks for its password, with the tapped seat', async () => {
    const onSelectSeat = vi.fn();
    const onLockedTable = vi.fn();
    const user = await in3d({
      tables: [table({ isPrivate: true, locked: true })],
      seats: seats('t1', { available: false, reason: 'private' }),
      onSelectSeat, onLockedTable,
    });
    await user.click(screen.getByRole('button', { name: '3D seat t1-s2' }));
    expect(onLockedTable).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }), expect.objectContaining({ id: 't1-s2' }));
    expect(onSelectSeat).not.toHaveBeenCalled();
  });
});
