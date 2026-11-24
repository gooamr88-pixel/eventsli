import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** Clearing the audit log (2026-11-24): counted, reasoned, CLEAR typed. */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(async () => ({ deleted: 12 })) }));
vi.mock('../src/app/utils/apiClient', () => api);
vi.mock('../src/app/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ClearAuditDialog from '../src/app/admin/audit/ClearAuditDialog';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockClear();
  api.get.mockResolvedValue({ data: [], pagination: { total: 12, totalPages: 1 } });
});

describe('Clear the audit log', () => {
  it('says how many go, and clears only with a reason and CLEAR typed', async () => {
    const onCleared = vi.fn();
    render(<ClearAuditDialog onClose={() => {}} onCleared={onCleared} />);
    expect(await screen.findByText('12')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Clear 12 entries' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Why are you clearing it/), 'Yearly clean-up after export');
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/to confirm/), 'CLEAR');
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(api.post).toHaveBeenCalledWith('/admin/audit/clear', {
      scope: 'older', days: 90, confirm: 'CLEAR', reason: 'Yearly clean-up after export',
    }, expect.anything());
    expect(onCleared).toHaveBeenCalled();
  });

  it('"Everything" sends scope all', async () => {
    render(<ClearAuditDialog onClose={() => {}} />);
    await userEvent.click(screen.getByLabelText('Everything'));
    await userEvent.type(screen.getByLabelText(/Why are you clearing it/), 'Fresh start before launch');
    await userEvent.type(screen.getByLabelText(/to confirm/), 'CLEAR');
    await userEvent.click(await screen.findByRole('button', { name: /^Clear 12/ }));
    expect(api.post.mock.calls[0][1]).toMatchObject({ scope: 'all', confirm: 'CLEAR' });
    expect(api.post.mock.calls[0][1].days).toBeUndefined();
  });
});
