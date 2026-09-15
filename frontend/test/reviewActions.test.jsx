import { describe, test, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted above the imports by vitest, so ReviewActions receives the mock.
vi.mock('../src/app/utils/apiClient', () => ({ post: vi.fn() }));

import { post } from '../src/app/utils/apiClient';
import ReviewActions from '../src/app/organizer/events/[id]/ReviewActions';

/**
 * REGRESSION — accepting the organizer terms "did not save".
 *
 * The button recorded the acceptance, but the page re-read an event whose
 * `review.termsAccepted` only Submit could set, so the terms step came back and
 * Submit stayed disabled: an organizer could never submit an event. The
 * backend half (accept → the event reads as accepted) is in
 * backend/test/integration/eventLifecycle.test.js and termsAcceptance.test.js.
 *
 * The harness plays the event layout: `onChanged(next)` replaces the event
 * with the server's answer, exactly as EventLayout's refresh does.
 */
const draft = (overrides = {}) => ({
  id: 'evt-1',
  title: 'Harbourfront Gala',
  status: 'draft',
  currency: 'CAD',
  fees: {
    commissionPct: 1.5, commissionTaxPct: 0, paymentFeeMode: 'auto',
    paymentFeePct: 2.9, paymentFeeFixedCents: 30, feeBearer: 'buyer', eventTaxPct: 0,
  },
  review: { termsAccepted: false, rejectionReason: null },
  ...overrides,
});

function Harness({ initial, onRefetch = () => {} }) {
  const [event, setEvent] = useState(initial);
  return (
    <ReviewActions
      event={event}
      onChanged={(next) => (next ? setEvent(next) : onRefetch())}
    />
  );
}

const submitButton = () => screen.getByRole('button', { name: /submit for review/i });
const acceptButton = () => screen.getByRole('button', { name: /accept terms/i });

describe('ReviewActions — terms, then submit', () => {
  beforeEach(() => { post.mockReset(); });

  test('accepting the terms unlocks Submit from the server’s answer, without a reload', async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (path) => {
      if (path.endsWith('/accept-terms')) {
        return {
          accepted: true, version: 1, termsId: 't-1',
          event: draft({ review: { termsAccepted: true, rejectionReason: null } }),
        };
      }
      throw new Error(`unexpected ${path}`);
    });

    render(<Harness initial={draft()} />);

    expect(submitButton()).toBeDisabled();
    // Nothing is agreed by a stray click: the box has to be ticked first.
    expect(acceptButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /organizer agreement/i }));
    expect(acceptButton()).toBeEnabled();

    await user.click(acceptButton());

    expect(post).toHaveBeenCalledWith('/events/evt-1/accept-terms', undefined, { noRedirect: true });
    await waitFor(() => expect(submitButton()).toBeEnabled());
    expect(screen.queryByRole('button', { name: /accept terms/i })).not.toBeInTheDocument();
    expect(screen.getByText(/accepted for this event/i)).toBeInTheDocument();
  });

  test('submitting after accepting calls the submit endpoint', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue(draft({ status: 'pending_review', review: { termsAccepted: true } }));

    render(<Harness initial={draft({ review: { termsAccepted: true } })} />);
    await user.click(submitButton());

    expect(post).toHaveBeenCalledWith('/events/evt-1/submit', undefined, { noRedirect: true });
    expect(await screen.findByText(/with eventsli for review/i)).toBeInTheDocument();
  });

  test('a failed acceptance says why and keeps Submit locked', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(Object.assign(new Error('Could not record acceptance.'), { code: 'INTERNAL_ERROR', status: 500 }));

    render(<Harness initial={draft()} />);
    await user.click(screen.getByRole('checkbox', { name: /organizer agreement/i }));
    await user.click(acceptButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not record acceptance/i);
    expect(submitButton()).toBeDisabled();
    expect(acceptButton()).toBeEnabled();
  });

  test('TERMS_NOT_ACCEPTED on submit re-reads the event instead of leaving a dead button', async () => {
    const user = userEvent.setup();
    const onRefetch = vi.fn();
    post.mockRejectedValue(Object.assign(new Error('Review and accept the organizer terms.'), { code: 'TERMS_NOT_ACCEPTED', status: 403 }));

    render(<Harness initial={draft({ review: { termsAccepted: true } })} onRefetch={onRefetch} />);
    await user.click(submitButton());

    await waitFor(() => expect(onRefetch).toHaveBeenCalled());
  });
});
