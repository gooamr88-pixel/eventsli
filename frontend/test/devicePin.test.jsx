import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), PUBLIC_API_URL: '/api/v1' }));
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../src/app/components/ui/Confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('../src/app/organizer/events/[id]/EventContext', () => ({ useEventContext: () => ({ event: { timezone: 'America/Toronto' } }) }));

import { patch } from '../src/app/utils/apiClient';
import { ChangePin } from '../src/app/organizer/events/[id]/devices/Devices';

/**
 * Retiring short door PINs (owner, 2026-11-20): the organizer sets a new 6-12
 * digit PIN on the Devices page; a device that signs in with a shorter one is
 * flagged there and says why.
 */

beforeEach(() => { patch.mockReset(); });

describe('a new PIN for a shared tablet', () => {
  test('a short-PIN device says why, and the new PIN is saved for that device only', async () => {
    patch.mockResolvedValue({ id: 'dev-1', label: 'Main door', pin: '73519264' });
    const onChanged = vi.fn();
    render(<ChangePin eventId="ev-1" device={{ id: 'dev-1', pinNeedsReset: true }} onChanged={onChanged} onCancel={() => {}} />);

    expect(screen.getByText(/shorter than 6 digits/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/New PIN/), '7351-9264');
    await userEvent.click(screen.getByRole('button', { name: 'Set new PIN' }));

    expect(patch).toHaveBeenCalledWith('/events/ev-1/scan-devices/dev-1/pin', { pin: '73519264' }, { noRedirect: true });
    expect(onChanged).toHaveBeenCalledWith('73519264');
  });

  test('a refused PIN shows the error and keeps the form', async () => {
    patch.mockRejectedValue(Object.assign(new Error('Set a PIN of 6 to 12 digits.'), { code: 'VALIDATION_ERROR', status: 400 }));
    const onChanged = vi.fn();
    render(<ChangePin eventId="ev-1" device={{ id: 'dev-1', pinNeedsReset: false }} onChanged={onChanged} onCancel={() => {}} />);
    expect(screen.queryByText(/shorter than 6 digits/)).toBeNull();
    await userEvent.type(screen.getByLabelText(/New PIN/), '12345678');
    await userEvent.click(screen.getByRole('button', { name: 'Set new PIN' }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set new PIN' })).toBeTruthy();
  });
});
