import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The screens rewritten for the simpler organizer journey (2026-11-23) load,
 * and say the right thing when the feature is off. The parts are tested in
 * partnerParts.test.jsx and the sidebar in navModel.test.js.
 */

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const state = vi.hoisted(() => ({ event: null, path: '/' }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => state.path }));
vi.mock('../src/app/organizer/nav/OrganizerEvents', () => ({ useOrganizerEvents: () => ({ reload: vi.fn() }) }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ event: state.event, refresh: vi.fn() }) }));
vi.mock('../src/app/hooks/useApi', () => ({ useApi: () => ({ data: null, error: null, reload: vi.fn() }) }));

const { default: Sponsors } = await import('../src/app/organizer/events/[id]/sponsors/Sponsors');
const { default: Vendors } = await import('../src/app/organizer/events/[id]/vendors/Vendors');
const { default: SectionTabs } = await import('../src/app/organizer/events/[id]/SectionTabs');
const { default: VendorStaff } = await import('../src/app/organizer/events/[id]/attendees/VendorStaff');
const { default: SponsorsPointer } = await import('../src/app/organizer/events/[id]/content/SponsorsPointer');

describe('the rewritten screens', () => {
  test('Sponsors and Vendors, when off, offer to turn on', () => {
    state.event = { id: EVENT_ID, partners: { sponsors: false, vendors: false } };
    render(<><Sponsors eventId={EVENT_ID} /><Vendors eventId={EVENT_ID} /></>);
    expect(screen.getByText(/Sponsors are off for this event/)).toBeTruthy();
    expect(screen.getByText(/Vendors are off for this event/)).toBeTruthy();
  });

  test('Sponsors, when on, opens on its three plain sections', () => {
    state.event = { id: EVENT_ID, partners: { sponsors: true, vendors: false } };
    render(<Sponsors eventId={EVENT_ID} />);
    for (const name of ['Sponsors', 'Packages', 'Page & settings']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Pipeline' })).toBeNull();
  });

  test('Vendors, when on, has no floor plan or door list tab for an event with a map', () => {
    state.event = { id: EVENT_ID, listingType: 'ticketed', partners: { sponsors: false, vendors: true } };
    render(<Vendors eventId={EVENT_ID} />);
    expect(screen.getByRole('button', { name: 'Booths & prices' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Floor plan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Door list' })).toBeNull();
  });

  test('a listing keeps its floor plan and vendor door list inside Vendors', () => {
    state.event = { id: EVENT_ID, listingType: 'display_only', partners: { sponsors: false, vendors: true } };
    render(<Vendors eventId={EVENT_ID} />);
    expect(screen.getByRole('button', { name: 'Floor plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Door list' })).toBeTruthy();
  });

  test('the tab strip over Orders', () => {
    state.path = `/organizer/events/${EVENT_ID}/offline`;
    render(<SectionTabs eventId={EVENT_ID} event={{ admissionType: 'reserved' }} />);
    expect(screen.getByRole('link', { name: 'Offline payments' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Commission' })).toBeTruthy();
  });

  test('the Door list shows vendor staff only for an event with vendors', () => {
    state.event = { id: EVENT_ID, partners: { vendors: false } };
    const { container } = render(<VendorStaff eventId={EVENT_ID} />);
    expect(container.innerHTML).toBe('');
  });

  test('the Event page screen points to Sponsors instead of editing them', () => {
    render(<SponsorsPointer event={{ id: EVENT_ID, partners: { sponsors: true } }} count={2} />);
    expect(screen.getByRole('link', { name: /Go to Sponsors/ }).getAttribute('href')).toBe(`/organizer/events/${EVENT_ID}/sponsors`);
    expect(screen.getByText(/2 shown now/)).toBeTruthy();
  });
});
