import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted above the imports by vitest, so the panel receives the mocks.
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), del: vi.fn() }));

import { get, del } from '../src/app/utils/apiClient';
import Drafts from '../src/app/organizer/dashboard/Drafts';
import { ConfirmProvider } from '../src/app/components/ui/Confirm';
import { ToastProvider } from '../src/app/components/ui/Toast';

/**
 * THE DRAFTS PANEL — unfinished events, and what each one is waiting on.
 *
 * The state and the "next step" link are the API's, not this component's, for
 * the same reason the launch checklist reads `event.needs` from the server:
 * two places deriving "is this ready" drift, and the organizer believes
 * whichever they read last. These tests pin the contract rather than the
 * arithmetic — that a step the server calls next is the one Continue opens.
 */
const draft = (overrides = {}) => ({
  id: 'evt-1',
  title: 'Harbourfront Gala',
  status: 'draft',
  startsAt: '2027-06-01T23:00:00.000Z',
  timezone: 'America/Toronto',
  venueName: null,
  city: null,
  rejectionReason: null,
  steps: [],
  done: 1,
  total: 6,
  next: { key: 'details', label: 'Where it happens', href: '/organizer/events/evt-1#details' },
  canDelete: true,
  ...overrides,
});

function mount() {
  return render(
    <ToastProvider>
      <ConfirmProvider>
        <Drafts />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Drafts', () => {
  beforeEach(() => {
    get.mockReset();
    del.mockReset();
  });

  test('shows how far each draft got and where it stopped', async () => {
    get.mockResolvedValue([draft()]);
    mount();

    expect(await screen.findByText('Harbourfront Gala')).toBeInTheDocument();
    expect(screen.getByText('1 of 6')).toBeInTheDocument();
    expect(screen.getByText(/next: Where it happens/)).toBeInTheDocument();
    // A draft with no venue says so rather than showing an empty gap.
    expect(screen.getByText(/No venue yet/)).toBeInTheDocument();

    // Continue goes to the missing step, not to the overview.
    expect(screen.getByRole('link', { name: /continue/i }))
      .toHaveAttribute('href', '/organizer/events/evt-1#details');
  });

  test('renders nothing at all when there are no drafts', async () => {
    get.mockResolvedValue([]);
    const { container } = mount();
    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('.es-panel')).toBeNull());
  });

  test('deleting asks first, then calls the endpoint', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue([draft()]);
    del.mockResolvedValue({ id: 'evt-1', deleted: true });
    mount();

    await user.click(await screen.findByRole('button', { name: /delete/i }));
    // Nothing has been sent yet — the confirm is the guard.
    expect(del).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: /delete draft/i }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/events/evt-1', { noRedirect: true }));
  });

  test('a draft sent back says what Eventsli asked for', async () => {
    get.mockResolvedValue([draft({
      status: 'rejected',
      rejectionReason: 'The cover image is not yours to use.',
    })]);
    mount();

    expect(await screen.findByText('Sent back')).toBeInTheDocument();
    expect(screen.getByText(/cover image is not yours/i)).toBeInTheDocument();
  });
});
