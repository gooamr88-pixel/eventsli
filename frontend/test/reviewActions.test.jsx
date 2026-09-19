import { describe, test, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Hoisted above the imports by vitest, so ReviewActions receives the mock.
// `get` is here for the review dialog, which reads the submission preview.
vi.mock('../src/app/utils/apiClient', () => ({ post: vi.fn(), get: vi.fn() }));

import { get, post } from '../src/app/utils/apiClient';
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
 * AND — the review dialog. Step 2 no longer submits on the click: it opens a
 * summary of the event, every fee, what a buyer pays and what the organizer
 * receives, and the event is sent only after that is confirmed. The tests
 * below go through it, because that is now the only route to the endpoint.
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

/** What GET /events/:id/submission-preview answers, trimmed to what is read. */
const preview = (overrides = {}) => ({
  event: {
    id: 'evt-1',
    title: 'Harbourfront Gala',
    description: 'An evening by the water.',
    listingType: 'ticketed',
    admissionType: 'reserved',
    category: 'Gala',
    venueName: 'Harbourfront Centre',
    venueAddress: '235 Queens Quay W',
    city: 'Toronto',
    country: 'CA',
    startsAt: '2027-06-01T23:00:00.000Z',
    endsAt: '2027-06-02T03:00:00.000Z',
    timezone: 'America/Toronto',
    currency: 'CAD',
    maxTicketsPerOrder: 6,
    allowTicketTransfer: true,
  },
  fees: {
    commissionPct: 1.5, commissionTaxPct: 0, eventTaxPct: 0,
    paymentFeeMode: 'auto', paymentFeePct: 2.9, paymentFeeFixedCents: 30,
    feeBearer: 'buyer', stripe: { pct: 2.9, fixedCents: 30 },
  },
  lines: [{
    label: 'General admission',
    kind: 'tier',
    detail: '200 available',
    faceCents: 5000,
    eventTaxCents: 0,
    commissionCents: 75,
    commissionTaxCents: 0,
    paymentFeeCents: 184,
    stripeCostCents: 180,
    buyerTotalCents: 5184,
    organizerNetCents: 4925,
    platformTakeCents: 259,
    isFree: false,
  }],
  hasTickets: true,
  policies: [],
  terms: { accepted: true, version: 1 },
  isFree: false,
  needs: {},
  blockers: [],
  canSubmit: true,
  ...overrides,
});

const openReview = () => screen.getByRole('button', { name: /review and submit/i });
const confirmButton = () => screen.getByRole('button', { name: /^submit for review$/i });
const acceptButton = () => screen.getByRole('button', { name: /accept terms/i });

/** Open the dialog, wait for the preview, tick the confirmation. */
async function reachConfirm(user) {
  await user.click(openReview());
  await screen.findByText(/before you submit/i);
  await user.click(screen.getByRole('checkbox', { name: /send this event to eventsli/i }));
  return confirmButton();
}

function Harness({ initial, onRefetch = () => {} }) {
  const [event, setEvent] = useState(initial);
  return (
    <ReviewActions
      event={event}
      onChanged={(next) => (next ? setEvent(next) : onRefetch())}
    />
  );
}

describe('ReviewActions — terms, then submit', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    get.mockResolvedValue(preview());
  });

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

    expect(openReview()).toBeDisabled();
    // Nothing is agreed by a stray click: the box has to be ticked first.
    expect(acceptButton()).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /organizer agreement/i }));
    expect(acceptButton()).toBeEnabled();

    await user.click(acceptButton());

    expect(post).toHaveBeenCalledWith('/events/evt-1/accept-terms', undefined, { noRedirect: true });
    await waitFor(() => expect(openReview()).toBeEnabled());
    expect(screen.queryByRole('button', { name: /accept terms/i })).not.toBeInTheDocument();
    expect(screen.getByText(/accepted for this event/i)).toBeInTheDocument();
  });

  test('the review opens instead of submitting, and shows what the money does', async () => {
    const user = userEvent.setup();
    render(<Harness initial={draft({ review: { termsAccepted: true } })} />);

    await user.click(openReview());
    await screen.findByText(/before you submit/i);

    // The click opened a dialog. It did NOT send the event.
    expect(post).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(
      '/events/evt-1/submission-preview',
      expect.objectContaining({ cache: 'no-store' }),
    );

    expect(screen.getByText('Harbourfront Centre')).toBeInTheDocument();
    expect(screen.getByText('Toronto')).toBeInTheDocument();
    // The two figures the whole dialog exists for, from the server.
    expect(screen.getByText('CA$51.84')).toBeInTheDocument();
    expect(screen.getByText('CA$49.25')).toBeInTheDocument();

    // And nothing is sendable until the organizer says they have read it.
    expect(confirmButton()).toBeDisabled();
  });

  test('submitting after confirming the review calls the submit endpoint', async () => {
    const user = userEvent.setup();
    post.mockResolvedValue(draft({ status: 'pending_review', review: { termsAccepted: true } }));

    render(<Harness initial={draft({ review: { termsAccepted: true } })} />);
    await user.click(await reachConfirm(user));

    expect(post).toHaveBeenCalledWith('/events/evt-1/submit', undefined, { noRedirect: true });
    expect(await screen.findByText(/with eventsli for review/i)).toBeInTheDocument();
  });

  test('an outstanding blocker is listed, and the event cannot be sent', async () => {
    const user = userEvent.setup();
    get.mockResolvedValue(preview({
      canSubmit: false,
      blockers: [{ code: 'VALIDATION_ERROR', message: 'Add a city before submitting.', meta: null }],
    }));

    render(<Harness initial={draft({ review: { termsAccepted: true } })} />);
    await user.click(openReview());

    expect(await screen.findByText(/add a city before submitting/i)).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    // The checkbox is out of reach too — ticking it would be agreeing to
    // something that cannot happen.
    expect(screen.getByRole('checkbox', { name: /send this event to eventsli/i })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  test('a failed acceptance says why and keeps Submit locked', async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(Object.assign(new Error('Could not record acceptance.'), { code: 'INTERNAL_ERROR', status: 500 }));

    render(<Harness initial={draft()} />);
    await user.click(screen.getByRole('checkbox', { name: /organizer agreement/i }));
    await user.click(acceptButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not record acceptance/i);
    expect(openReview()).toBeDisabled();
    expect(acceptButton()).toBeEnabled();
  });

  test('TERMS_NOT_ACCEPTED on submit re-reads the event instead of leaving a dead button', async () => {
    const user = userEvent.setup();
    const onRefetch = vi.fn();
    post.mockRejectedValue(Object.assign(new Error('Review and accept the organizer terms.'), { code: 'TERMS_NOT_ACCEPTED', status: 403 }));

    render(<Harness initial={draft({ review: { termsAccepted: true } })} onRefetch={onRefetch} />);
    await user.click(await reachConfirm(user));

    await waitFor(() => expect(onRefetch).toHaveBeenCalled());
  });
});
