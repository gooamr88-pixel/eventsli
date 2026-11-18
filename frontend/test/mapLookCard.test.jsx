import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), put: vi.fn() }));

import { get, put } from '../src/app/utils/apiClient';
import MapLookCard from '../src/app/organizer/events/[id]/map/style/MapLookCard';

/**
 * The Map look card (2026-11-18). It shipped once with a state variable used
 * but never declared, which passed lint and the build and crashed the Venue
 * Builder on its first render. Rendering it is the test that would have caught it.
 */
describe('MapLookCard', () => {
  beforeEach(() => {
    get.mockResolvedValue({ looks: [{ id: 'look_mine1', name: 'Our gala', floor: '#000000', seat: '#ffcc00' }] });
    put.mockImplementation(async (_path, body) => ({ looks: body.looks.map((l, i) => ({ id: l.id || `look_new${i}`, ...l })) }));
  });

  test('renders the presets and the organizer’s saved looks', async () => {
    render(<MapLookCard look={null} onChange={() => {}} onApplyToTables={() => {}} tableCount={3} />);
    expect(screen.getByRole('button', { name: /Cream classic/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Our gala' })).toBeTruthy());
  });

  test('a preset is applied as the map’s look', async () => {
    const onChange = vi.fn();
    render(<MapLookCard look={null} onChange={onChange} onApplyToTables={() => {}} tableCount={3} />);
    await userEvent.click(screen.getByRole('button', { name: /Night gala/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ floor: '#16141d', name: 'Night gala' }));
  });

  test('saving a look asks for a name, then keeps it on the account', async () => {
    const onChange = vi.fn();
    render(<MapLookCard look={{ floor: '#fffcf2', seat: '#d6006e' }} onChange={onChange} onApplyToTables={() => {}} tableCount={3} />);
    await waitFor(() => expect(get).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /Save as my look/ }));
    const field = screen.getByLabelText('Name this look');
    await userEvent.clear(field);
    await userEvent.type(field, 'Wedding');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [path, body] = put.mock.calls[0];
    expect(path).toBe('/organizer/map-looks');
    expect(body.looks.at(-1)).toMatchObject({ name: 'Wedding', floor: '#fffcf2' });
    expect(await screen.findByRole('status')).toBeTruthy();
  });
});
