import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SPONSORS AND VENDORS, THE SIMPLER WAY (owner, 2026-11-23: "a hardship
 * journey … especially sponsors and vendors").
 *
 * They are opt-in from the overview, open on a three-step setup with the next
 * step highlighted, and list partners as plain rows with filters instead of a
 * board of empty columns.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const api = vi.hoisted(() => ({ put: vi.fn(), del: vi.fn() }));
const push = vi.fn();
const refresh = vi.fn();
const reload = vi.fn();
const confirm = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/' }));
vi.mock('../src/app/utils/apiClient', () => api);
vi.mock('../src/app/components/ui/Confirm', () => ({ useConfirm: () => confirm }));
vi.mock('../src/app/organizer/nav/OrganizerEvents', () => ({ useOrganizerEvents: () => ({ reload }) }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ refresh }) }));

const { default: PartnersCard } = await import('../src/app/organizer/events/[id]/PartnersCard');
const { SetupGuide, PartnerList, PartnerOff } = await import('../src/app/organizer/events/[id]/_partners/PartnerParts');

beforeEach(() => {
  [api.put, api.del, push, refresh, reload, confirm].forEach((f) => f.mockReset());
});

describe('the overview asks', () => {
  test('both are offered when off, and saying yes turns it on and opens it', async () => {
    api.put.mockResolvedValue({ sponsors: true });
    render(<PartnersCard event={{ id: 'e1', partners: { sponsors: false, vendors: false } }} />);
    expect(screen.getByRole('button', { name: /Add vendors/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Add sponsors/ }));
    expect(api.put).toHaveBeenCalledWith('/events/e1/partners/sponsors', {}, { noRedirect: true });
    // The event and the sidebar both learn about it.
    expect(refresh).toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/organizer/events/e1/sponsors');
  });

  test('one that is on is a link to its screen', () => {
    render(<PartnersCard event={{ id: 'e1', partners: { sponsors: false, vendors: true } }} />);
    expect(screen.getByRole('link', { name: /Open/ }).getAttribute('href')).toBe('/organizer/events/e1/vendors');
    expect(screen.queryByRole('button', { name: /Add vendors/ })).toBeNull();
  });

  test('an old link to a screen that is off says so and offers it, without leaving', async () => {
    api.put.mockResolvedValue({ vendors: true });
    render(<PartnerOff eventId="e1" kind="vendors" />);
    expect(screen.getByText(/Vendors are off for this event/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Add vendors to this event/ }));
    expect(api.put).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the setup guide', () => {
  const steps = (done) => [
    { key: 'a', title: 'Decide what you sell', text: '…', done: done[0], action: { label: 'Add a package', onClick: vi.fn() } },
    { key: 'b', title: 'Open your page', text: '…', done: done[1], action: { label: 'Set up the page', href: '/x' } },
    { key: 'c', title: 'Add your first', text: '…', done: done[2], action: { label: 'Add one', onClick: vi.fn() } },
  ];

  test('the first step not done is the current one, and says how far along', () => {
    render(<SetupGuide title="Get set up" steps={steps([true, false, false])} />);
    expect(screen.getByText('1 of 3 done')).toBeTruthy();
    const current = screen.getByText('Open your page').closest('li');
    expect(current.getAttribute('aria-current')).toBe('step');
    // The done step offers nothing more to do.
    expect(screen.queryByRole('button', { name: 'Add a package' })).toBeNull();
    expect(within(current).getByRole('link', { name: 'Set up the page' }).className).toContain('es-btn--primary');
  });

  test('it disappears once everything is done', () => {
    const { container } = render(<SetupGuide title="Get set up" steps={steps([true, true, true])} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the partner list', () => {
  const filters = [{ key: 'lead', label: 'New' }, { key: 'paid', label: 'Paid' }, { key: 'closed', label: 'Closed' }];
  const rows = [
    { id: '1', column: 'lead', href: '/a', name: 'Acme', sub: 'Gold', end: 'x' },
    { id: '2', column: 'paid', href: '/b', name: 'Birch', end: 'y' },
    { id: '3', column: 'paid', href: '/c', name: 'Cedar', end: 'z' },
  ];

  test('rows, not columns — and no chip for a filter with nothing in it', () => {
    render(<PartnerList label="Sponsors" filters={filters} rows={rows} />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /All 3/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Paid 2/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Closed/ })).toBeNull();
  });

  test('a chip filters the list', async () => {
    render(<PartnerList label="Sponsors" filters={filters} rows={rows} />);
    await userEvent.click(screen.getByRole('button', { name: /New 1/ }));
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual([expect.stringContaining('Acme')]);
  });

  test('empty says so in words', () => {
    render(<PartnerList label="Sponsors" filters={filters} rows={[]} empty={<p>No sponsors yet.</p>} />);
    expect(screen.getByText('No sponsors yet.')).toBeTruthy();
  });
});
