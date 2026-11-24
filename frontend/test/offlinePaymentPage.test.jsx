import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The buyer's "pay the organizer" page (owner, 2026-11-24: "make this page
 * very professional", the method "red and bold so they can see it clearly").
 */
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('token=tok') }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../src/app/utils/apiClient', () => api);
const confirmAnswer = vi.hoisted(() => vi.fn());
vi.mock('../src/app/components/ui/Confirm', () => ({ useConfirm: () => confirmAnswer }));

const { default: OfflinePaymentClient, timeLeft } = await import('../src/app/checkout/offline/[id]/OfflinePaymentClient');

const awaiting = {
  id: 'p1', status: 'awaiting', reference: '2D13-CB44', amountCents: 12500, currency: 'USD',
  dueAt: '2099-01-01T18:32:00Z', organizer: { name: 'Sawa' }, proof: null,
  method: { label: 'ZELLE', instructions: '8324682257\nSawa Enterprises llc' },
  event: { slug: 'gala', title: 'The Gala', timezone: 'America/Chicago', startsAt: '2099-01-02T01:00:00Z', venueName: 'Hall A' },
};

describe('pay the organizer', () => {
  test('three steps; the method is its own red heading; details and reference can be copied', async () => {
    api.get.mockResolvedValue(awaiting);
    const { container } = render(<OfflinePaymentClient id="p1" />);
    const method = await screen.findByRole('heading', { name: 'ZELLE' });
    expect(method).toHaveClass('es-op__method');
    expect(container.querySelectorAll('.es-op__step')).toHaveLength(3);
    expect(screen.getByText(/8324682257/)).toBeInTheDocument();
    expect(screen.getByText('2D13-CB44')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy details/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Copy$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload the receipt/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Your reservation' })).toHaveTextContent('The Gala');
  });

  test('paid: says so and links to the tickets', async () => {
    api.get.mockResolvedValue({ ...awaiting, status: 'paid', orderToken: 'ot1' });
    render(<OfflinePaymentClient id="p1" />);
    expect(await screen.findByRole('heading', { name: /Payment confirmed/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open my tickets/ })).toHaveAttribute('href', '/t/ot1');
  });

  test('the last step: "I’ve sent the payment" asks once without a receipt, then closes the flow', async () => {
    api.get.mockResolvedValue(awaiting);
    api.post.mockResolvedValue({ ...awaiting, sentAt: '2026-11-24T16:40:00Z' });
    confirmAnswer.mockResolvedValue(true);
    const user = userEvent.setup();
    render(<OfflinePaymentClient id="p1" />);
    await user.click(await screen.findByRole('button', { name: /I’ve sent the payment/ }));
    expect(confirmAnswer).toHaveBeenCalledWith(expect.objectContaining({ title: 'Finish without a receipt?' }));
    expect(api.post).toHaveBeenCalledWith('/public/offline-payments/p1/sent?token=tok', undefined, { noRedirect: true });
    expect(await screen.findByRole('heading', { name: /Payment sent/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I’ve sent the payment/ })).toBeNull();
    expect(screen.getByText('ZELLE')).toHaveClass('es-op__recap-method');
  });

  test('saying no to the question sends nothing', async () => {
    api.get.mockResolvedValue(awaiting);
    api.post.mockReset();
    confirmAnswer.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<OfflinePaymentClient id="p1" />);
    await user.click(await screen.findByRole('button', { name: /I’ve sent the payment/ }));
    expect(api.post).not.toHaveBeenCalled();
  });

  test('a receipt the organizer requires: marked Required, and the finish waits for it', async () => {
    api.get.mockResolvedValue({ ...awaiting, proofRequired: true });
    render(<OfflinePaymentClient id="p1" />);
    const finish = await screen.findByRole('button', { name: /I’ve sent the payment/ });
    expect(finish).toBeDisabled();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText(/Upload your receipt in step 3 first/)).toBeInTheDocument();
  });

  test('once the required receipt is there, the finish opens with no question', async () => {
    api.get.mockResolvedValue({ ...awaiting, proofRequired: true, proof: { uploadedAt: '2026-11-24T10:00:00Z' } });
    api.post.mockReset();
    api.post.mockResolvedValue({ ...awaiting, proofRequired: true, sentAt: '2026-11-24T16:40:00Z' });
    confirmAnswer.mockReset();
    const user = userEvent.setup();
    render(<OfflinePaymentClient id="p1" />);
    await user.click(await screen.findByRole('button', { name: /I’ve sent the payment/ }));
    expect(confirmAnswer).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalled();
  });

  test('the time left reads plainly', () => {
    expect(timeLeft(0)).toBe('Time is up');
    expect(timeLeft(12 * 60_000)).toBe('12 min left');
    expect(timeLeft((3 * 60 + 12) * 60_000)).toBe('3 h 12 min left');
    expect(timeLeft((28 * 60) * 60_000)).toBe('1 day 4 h left');
  });
});
