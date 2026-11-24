import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Saved events (2026-11-24): private events come back (`withPrivate`), and
 * saves whose events are gone can be cleared so "Saved events (n)" matches.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../src/app/utils/apiClient', () => api);
vi.mock('../src/app/components/EventCard', () => ({ default: ({ event }) => <span>{event.title}</span> }));

import SavedEvents from '../src/app/events/saved/SavedEvents';
import { readSaved } from '../src/app/hooks/useSavedEvents';

beforeEach(() => {
  api.get.mockReset();
  window.localStorage.setItem('eventsli.saved', JSON.stringify(['adel-ogla-houston', 'gone-event']));
});

describe('saved events', () => {
  it('asks for private events too, and offers to clear the ones that are gone', async () => {
    api.get.mockResolvedValue([{ id: '1', slug: 'adel-ogla-houston', title: 'Adel OglA', isPrivate: true }]);
    render(<SavedEvents />);
    expect(await screen.findByText('Adel OglA')).toBeInTheDocument();
    expect(api.get.mock.calls[0][0]).toMatch(/withPrivate=true/);
    await userEvent.click(screen.getByRole('button', { name: 'Clear it' }));
    expect(readSaved()).toEqual(['adel-ogla-houston']);
  });

  it('when none come back, they can all be cleared', async () => {
    api.get.mockResolvedValue([]);
    render(<SavedEvents />);
    await userEvent.click(await screen.findByRole('button', { name: 'Clear them from saved' }));
    expect(readSaved()).toEqual([]);
  });
});
