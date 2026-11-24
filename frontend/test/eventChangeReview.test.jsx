import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Edits to a live event, reviewed (owner, 2026-11-24): the organizer's change
 * to approved details waits for an admin; an admin edits everything at once.
 */
const api = vi.hoisted(() => ({ del: vi.fn(async () => ({})), post: vi.fn(async () => ({})), patch: vi.fn() }));
vi.mock('../src/app/utils/apiClient', () => ({ ...api, get: vi.fn(async () => []) }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ChangeRequestBanner from '../src/app/organizer/events/[id]/ChangeRequestBanner';

const request = {
  id: 'req-1', eventId: 'ev-1', status: 'pending', createdAt: '2026-11-24T10:00:00Z',
  changes: [
    { column: 'title', field: 'title', label: 'Title', from: 'Adel Ogla', to: 'Adel Ogla Live' },
    { column: 'city', field: 'city', label: 'City', from: 'Toronto', to: 'Houston' },
  ],
};
const event = { id: 'ev-1', timezone: 'America/Chicago', changeRequest: request };

beforeEach(() => { api.del.mockClear(); api.post.mockClear(); });

describe('the change waiting for review', () => {
  it('shows the organizer each field, from and to, and lets them withdraw it', async () => {
    const onChanged = vi.fn();
    render(<ChangeRequestBanner event={event} onChanged={onChanged} />);
    expect(screen.getByText('Waiting for Eventsli to review your change')).toBeInTheDocument();
    expect(screen.getByText('Adel Ogla Live')).toBeInTheDocument();
    expect(screen.getByText('Houston')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw this change' }));
    expect(api.del).toHaveBeenCalledWith('/events/ev-1/change-request', expect.anything());
    expect(onChanged).toHaveBeenCalled();
  });

  it('gives the admin Approve, and Decline only with a reason', async () => {
    render(<ChangeRequestBanner asAdmin request={request} event={{ id: 'ev-1', timezone: 'America/Chicago' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Decline…' }));
    const decline = screen.getByRole('button', { name: 'Decline change' });
    expect(decline).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why not/), 'The headliner is not confirmed.');
    await userEvent.click(decline);
    expect(api.post).toHaveBeenCalledWith('/admin/change-requests/req-1/reject', { note: 'The headliner is not confirmed.' }, expect.anything());
  });

  it('approving posts to the request', async () => {
    render(<ChangeRequestBanner asAdmin request={request} event={{ id: 'ev-1' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Approve and publish' }));
    expect(api.post).toHaveBeenCalledWith('/admin/change-requests/req-1/approve', {}, expect.anything());
  });

  it('shows nothing once the request is approved or withdrawn', () => {
    const { container } = render(<ChangeRequestBanner event={{ ...event, changeRequest: { ...request, status: 'approved' } }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
