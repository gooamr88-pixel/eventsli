import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
let user = { isSuperAdmin: true };
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), useSearchParams: () => search }));
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('../src/app/hooks/useAuth', () => ({ useAuth: () => ({ user }) }));
vi.mock('../src/app/hooks/useCategories', () => ({ useCategories: () => ({ list: [{ slug: 'party', label: 'Party' }] }) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../src/app/components/ui/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('../src/app/organizer/nav/OrganizerEvents', () => ({ useOrganizerEvents: () => ({ events: [{ id: 'ev-1', title: 'Spring Gala' }] }) }));

import { get, post, patch } from '../src/app/utils/apiClient';
import Templates from '../src/app/organizer/templates/Templates';
import AdminTemplates from '../src/app/admin/templates/AdminTemplates';
import MapTemplateDialog from '../src/app/organizer/events/[id]/map/style/MapTemplateDialog';
import { formFromTemplate } from '../src/app/organizer/events/new/TemplateStart';

/**
 * Event templates (owner, 2026-11-19): the organizer's page, the console,
 * the Venue Builder's map picker and the new-event pre-fill.
 */
const summary = { tiers: 2, seats: 18, tables: 2, hasMap: true, addons: 1, currency: 'CAD', lowestPriceCents: 6000 };
const mine = { id: 'tpl-mine', scope: 'organizer', name: 'Our gala', listingType: 'ticketed', summary, useCount: 3 };
const shared = { id: 'tpl-eventsli', scope: 'platform', name: 'Wedding — 20 tables', listingType: 'ticketed', featured: true, status: 'published', summary };
const full = {
  ...shared,
  data: {
    currency: 'CAD',
    event: { title: 'Wedding', venueName: 'Grand Hall', city: 'Toronto', timezone: 'America/Toronto', admissionType: 'reserved', maxTicketsPerOrder: 8, startTime: '18:00', durationMinutes: 300, allowTicketTransfer: false },
    tiers: [{ key: 't1', name: 'VIP', priceCents: 12000 }, { key: 't2', name: 'Standard', priceCents: 6000 }],
    addons: [{ name: 'Photo', priceCents: 1500 }],
    categories: [{ key: 'c1', name: 'Family' }],
    map: {
      layout: { tableStyles: { t1: { fill: '#8c8c8c' } } },
      tables: [
        { label: 'T1', seatCount: 8, shape: 'round', position: { x: 10, y: 10, rotation: 0 }, tierKey: 't1', categoryKey: 'c1' },
        { label: 'T2', seatCount: 10, shape: 'rect', position: { x: 40, y: 10, rotation: 0 }, tierKey: 't2' },
      ],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  search = new URLSearchParams();
  user = { isSuperAdmin: true };
  get.mockImplementation(async (path) => {
    if (path === '/organizer/templates') return { mine: [mine], eventsli: [shared], enabled: true };
    if (path.startsWith('/organizer/venue-maps')) return { mine: [], library: [], forVenue: [], enabled: true, venue: null };
    if (path.startsWith('/organizer/templates/')) return full;
    if (path.startsWith('/admin/templates?scope=organizer')) return { templates: [{ ...mine, organizerName: 'Starlight' }], enabled: true };
    if (path.startsWith('/admin/templates?')) return { templates: [{ ...shared, status: 'draft', sourceEventId: 'ev-1' }], enabled: true };
    return full;
  });
  post.mockResolvedValue({});
  patch.mockResolvedValue({});
});

describe('the organizer’s Templates page', () => {
  test('lists their templates, and Eventsli’s on the other tab', async () => {
    render(<Templates />);
    expect(await screen.findByText('Our gala')).toBeTruthy();
    expect(screen.getByText(/2 ticket types · 18 seats · 1 add-on/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Eventsli templates/ }));
    expect(screen.getByText('Wedding — 20 tables')).toBeTruthy();
    expect(screen.getByText('Featured')).toBeTruthy();
  });

  test('Use opens the new-event form on that template', async () => {
    render(<Templates />);
    await screen.findByText('Our gala');
    await userEvent.click(screen.getByRole('button', { name: 'Use template' }));
    expect(push).toHaveBeenCalledWith('/organizer/events/new?type=ticketed&template=tpl-mine');
  });

  test('an Eventsli template can be copied into the library', async () => {
    render(<Templates />);
    await screen.findByText('Our gala');
    await userEvent.click(screen.getByRole('button', { name: /Eventsli templates/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy to mine' }));
    expect(post).toHaveBeenCalledWith('/organizer/templates/tpl-eventsli/copy', {}, { noRedirect: true });
  });

  test('?from=<event> opens Save on that event', async () => {
    search = new URLSearchParams('from=ev-1');
    render(<Templates />);
    const dialog = await screen.findByRole('dialog', { name: 'Save an event as a template' });
    await userEvent.type(within(dialog).getByLabelText('Template name'), 'Gala setup');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save template' }));
    expect(post).toHaveBeenCalledWith('/organizer/templates', { eventId: 'ev-1', name: 'Gala setup' }, { noRedirect: true });
  });

  test('Preview shows ticket types and the seating map', async () => {
    render(<Templates />);
    await screen.findByText('Our gala');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('VIP')).toBeTruthy());
    expect(within(dialog).getByRole('group', { name: 'Seat map' })).toBeTruthy();
  });
});

describe('the admin console', () => {
  test('a super admin publishes an Eventsli template', async () => {
    render(<AdminTemplates />);
    expect(await screen.findByText('Draft')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(patch).toHaveBeenCalledWith('/admin/templates/tpl-eventsli', { status: 'published' }, { noRedirect: true });
  });

  test('a plain admin can look but sees no controls', async () => {
    user = { isSuperAdmin: false };
    render(<AdminTemplates />);
    await screen.findByText('Wedding — 20 tables');
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New template from an event' })).toBeNull();
    expect(screen.getByText(/Changing them is for super admins/)).toBeTruthy();
  });

  test('an organizer’s template can be made an Eventsli one', async () => {
    render(<AdminTemplates />);
    await screen.findByText('Draft');
    await userEvent.click(screen.getByRole('button', { name: /Organizers’ templates/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Make Eventsli template' }));
    expect(post).toHaveBeenCalledWith('/admin/templates/tpl-mine/promote', {}, { noRedirect: true });
  });
});

test('the Venue Builder takes a template’s map, matching ticket types by name', async () => {
  const onApply = vi.fn();
  render(
    <MapTemplateDialog
      eventId="ev-1"
      tiers={[{ id: 'mine-vip', name: 'vip ' }]} categories={[{ id: 'mine-fam', name: 'Family' }]}
      replacing={false} onApply={onApply} onClose={() => {}}
    />,
  );
  // Event templates are their own tab beside the venue map library (2026-11-24).
  await userEvent.click(await screen.findByRole('button', { name: /Event templates/ }));
  await userEvent.click(await screen.findByRole('button', { name: /Our gala/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Use this map' }));
  const spec = onApply.mock.calls[0][0];
  expect(spec.tables[0]).toMatchObject({ label: 'T1', tierId: 'mine-vip', categoryId: 'mine-fam', style: { fill: '#8c8c8c' } });
  expect(spec.tables[1].tierId).toBeNull();
});

test('a template pre-fills the new-event form but never the dates', () => {
  const base = { title: '', category: 'other', description: '', timezone: 'UTC', startsAt: '', endsAt: '', venueName: '', venueAddress: '', city: '', venuePlaceId: '', venueLat: '', venueLng: '', maxTicketsPerOrder: '10', allowTicketTransfer: true };
  const form = formFromTemplate(full, base);
  expect(form).toMatchObject({ title: 'Wedding', venueName: 'Grand Hall', city: 'Toronto', timezone: 'America/Toronto', maxTicketsPerOrder: '8', allowTicketTransfer: false });
  expect(form.startsAt).toBe('');
  expect(form.endsAt).toBe('');
});
