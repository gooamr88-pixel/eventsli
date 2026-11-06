import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * TECH-AUDIT-LOG T-074: an organizer still on the OLD Stripe setup (an account
 * on which Eventsli would carry their losses) has card checkout refused by the
 * API. The Payments page must say so and offer to reconnect — not show the
 * generic "needs details" state, which would leave them waiting on nothing.
 */
vi.mock('../src/app/utils/apiClient', () => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('../src/app/hooks/useAuth', () => ({ refreshAuth: vi.fn() }));

import { get } from '../src/app/utils/apiClient';
import { StripeSection } from '../src/app/organizer/payments/PaymentMethods';

const organizer = { payments: { stripeReady: false } };

beforeEach(() => { vi.mocked(get).mockReset(); });

describe('Stripe card on the Payments page', () => {
  test('a legacy account is told to reconnect, with a Reconnect button', async () => {
    vi.mocked(get).mockResolvedValue({ connected: true, canReceivePayouts: false, needsReconnect: true, requirements: [] });
    render(<StripeSection organizer={organizer} onChanged={() => {}} />);
    expect(await screen.findByText('Reconnect needed')).toBeInTheDocument();
    expect(screen.getByText('Reconnect Stripe to keep taking card payments.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reconnect Stripe/ })).toBeInTheDocument();
  });

  test('an account still onboarding keeps the ordinary "needs details" state', async () => {
    vi.mocked(get).mockResolvedValue({ connected: true, canReceivePayouts: false, needsReconnect: false, requirements: [] });
    render(<StripeSection organizer={organizer} onChanged={() => {}} />);
    expect(await screen.findByText('Needs details')).toBeInTheDocument();
    expect(screen.queryByText(/Reconnect Stripe/)).toBeNull();
    expect(screen.getByRole('button', { name: /Continue with Stripe/ })).toBeInTheDocument();
  });
});
