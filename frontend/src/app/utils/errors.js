/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Every error code the API can return, and what a person should do about it.
 *
 * Mirrors ERROR_STATUS in backend/utils/responseEnvelope.js. That table exists
 * so a controller returns a CODE and the status is looked up in one place; this
 * one exists so the UI switches on that code and the English is written in one
 * place.
 *
 * NEVER branch on `message`. The API's messages are prose meant for a person
 * and are free to change — a copy edit on the backend would silently break a
 * `if (message === 'Those seats are no longer available.')` and nothing would
 * fail until someone tried to buy a seat.
 *
 * `recovery` is the part that matters. An error that says only what went wrong
 * leaves the viewer to guess, and on a checkout page they guess "leave".
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * `tone` decides how it is rendered, and it is not the same question as the
 * HTTP status.
 *
 *   fatal   — the flow is over; offer the way back
 *   retry   — the same action may work if repeated
 *   fix     — the viewer can change something and continue
 *   waiting — nothing is wrong; something has not happened yet
 */
const E = (code, title, recovery, tone = 'fix') => [code, { code, title, recovery, tone }];

export const ERRORS = Object.freeze(Object.fromEntries([
  // ── Auth ──────────────────────────────────────────────────────────────────
  E('UNAUTHENTICATED', 'Please sign in',
    'You need an account to do that.', 'fatal'),
  E('INVALID_TOKEN', 'Your session expired',
    'Sign in again to pick up where you left off.', 'fatal'),
  E('SESSION_REVOKED', 'This session was ended',
    'It was signed out on another device, or by an administrator. Sign in again.', 'fatal'),
  E('FORBIDDEN', 'Not allowed',
    'Your account does not have access to this.', 'fatal'),
  E('ACCOUNT_BANNED', 'This account is suspended',
    'Contact support if you think that is a mistake.', 'fatal'),
  E('ORGANIZER_BANNED', 'Your organizer account is suspended',
    'You can still see and settle what you owe, but nothing new can go on sale. Contact support.', 'fatal'),
  E('EMAIL_NOT_VERIFIED', 'Confirm your email first',
    'We have sent a 6-digit code to your inbox. Enter it to finish signing in.'),
  E('INVALID_CODE', 'That code is not right',
    'Check the latest email from us and type the six digits again.'),
  E('CODE_EXPIRED', 'That code has expired',
    'Codes last ten minutes. Send yourself a new one and use that instead.'),

  // ── Events ────────────────────────────────────────────────────────────────
  E('EVENT_NOT_FOUND', 'Event not found',
    'The link may be wrong, or the event may no longer be listed.', 'fatal'),
  E('EVENT_NOT_PUBLISHED', 'Not on sale yet',
    'This event has not been published. Check back soon.', 'waiting'),
  E('EVENT_CANCELLED', 'This event was cancelled',
    'If you already have tickets, the organizer will be in touch about a refund.', 'fatal'),
  E('EVENT_SUSPENDED', 'This event is unavailable',
    'It has been temporarily removed from sale.', 'fatal'),
  E('PRICE_LOCKED_AFTER_SALE', 'Prices are locked',
    'Tickets have already sold at the current price, so it cannot change. Add a new tier instead.'),
  // Both audiences meet this one — an organizer submitting an event and a buyer
  // at checkout (BRD §21) — so it names neither.
  E('TERMS_NOT_ACCEPTED', 'Accept the terms first',
    'Read and accept the terms, then try again.'),

  // ── Inventory ─────────────────────────────────────────────────────────────
  // The seat-map codes are the ones a buyer meets most, and every one of them
  // means the same thing to them — "not yours" — so each says what to do next
  // rather than which internal state it was in.
  E('SEAT_UNAVAILABLE', 'Someone got there first',
    'One or more of those seats was taken while you were choosing. Pick again.', 'retry'),
  E('TABLE_UNAVAILABLE', 'That table is taken',
    'Choose another table, or pick individual seats.', 'retry'),
  E('TABLE_PARTIALLY_SOLD', 'That table is no longer available whole',
    'Some of its seats have sold. You can still book the seats that are left.', 'retry'),
  E('TABLE_PASSWORD_REQUIRED', 'This table is private',
    'Enter the password the organizer gave you.'),
  E('TABLE_PASSWORD_INVALID', 'That did not work',
    'Check the password with the organizer and try again.', 'retry'),
  E('TIER_SOLD_OUT', 'Sold out',
    'That ticket type has gone. Try another.'),
  E('PURCHASE_LIMIT_EXCEEDED', 'Too many tickets',
    'This event limits how many one order can hold. Reduce your selection.'),
  E('RESERVATION_EXPIRED', 'Your hold expired',
    'Seats are held for 35 minutes. Yours went back on sale — choose again.', 'fatal'),
  E('RESERVATION_NOT_FOUND', 'We lost track of that hold',
    'Start again from the seat map.', 'fatal'),

  // ── Payments ──────────────────────────────────────────────────────────────
  // Three of these are the organizer's Stripe state, not the buyer's problem,
  // and they are the reason a code table beats a generic "payment failed": each
  // has a different person who can fix it.
  E('PAYMENT_REQUIRED', 'Payment did not complete',
    'Nothing was charged. Try again, or use a different card.', 'retry'),
  E('STRIPE_NOT_CONNECTED', 'This organizer cannot take payment yet',
    'They have not finished connecting their payout account. Tickets go on sale once they do.', 'waiting'),
  E('STRIPE_NOT_ACTIVE', 'Payouts are not enabled for this organizer',
    'Stripe still needs information from them before they can be paid.', 'waiting'),
  E('STRIPE_NOT_CONFIGURED', 'Card payments are switched off',
    'This is a configuration on our side, not yours. Please try again shortly.', 'waiting'),
  E('CURRENCY_LOCKED_AFTER_SALE', 'The currency cannot change',
    'Tickets have already sold, so this event has to stay in the currency they were sold in.'),
  E('SCANNER_LOCKED', 'Scanning is locked for this event',
    'An overdue commission invoice locked the gate. It reopens the moment the invoice is settled.'),

  // ── Tickets ───────────────────────────────────────────────────────────────
  E('TICKET_NOT_FOUND', 'Ticket not found',
    'Check the link, or have it sent to your email again.'),
  E('TRANSFER_DISABLED', 'Transfers are off for this event',
    'The organizer has disabled passing tickets on.', 'fatal'),
  E('ALREADY_TRANSFERRED', 'This ticket was already transferred',
    'A ticket can only be passed on once.', 'fatal'),

  // ── Catalogue ─────────────────────────────────────────────────────────────
  E('DUPLICATE_TIER', 'That name is taken',
    'Another ticket type on this event already uses it.'),
  E('DUPLICATE_CATEGORY', 'That name is taken',
    'Another table category on this event already uses it.'),
  E('TIER_IN_USE', 'Seats are priced by this',
    'Deleting it would leave those seats costing nothing. Move them to another ticket type first.'),
  E('TIER_HAS_SALES', 'Tickets have already sold on this',
    'It cannot be removed. Deactivate it instead if you want to stop selling it.'),
  E('BELOW_SOLD', 'That is fewer than have sold',
    'The quantity cannot go below the number already bought.'),

  // ── The role ladder (BRD §19) ─────────────────────────────────────────────
  // Refusals a reviewer has to be able to read as a REASON. A 403 toast here
  // reads as a broken screen; these read as the rule they are.
  E('SELF_ACTION', 'You cannot do that to your own account',
    'Ask another administrator.', 'fatal'),
  E('LAST_SUPER_ADMIN', 'This is the last super admin',
    'Promote someone else first, or the platform would be left with nobody able to administer it.'),

  // ── The organizer journey ─────────────────────────────────────────────────
  E('TOKEN_EXPIRED', 'This activation link has expired',
    'Send yourself a new one — the newest email is the one that works.'),
  E('ALREADY_VERIFIED', 'Your account is already active',
    'Sign in with your email and password to continue.', 'fatal'),
  E('ORGANIZER_SETUP_REQUIRED', 'Set up your organization first',
    'Add your organization name, brand and description on the dashboard, then create your event.'),
  E('PAYMENT_METHOD_REQUIRED', 'Add a way to get paid first',
    'A ticketed event needs Stripe or a manual payment method before it can go on sale. Set one up under Payment methods.'),
  E('PAYMENT_METHOD_UNAVAILABLE', 'That payment option is not set up',
    'Connect Stripe or add a manual payment method first, then choose it for this event.'),
  E('EVENT_ARCHIVED', 'This event is archived',
    'Restore it first to make changes.'),
  E('CANCELLATION_PENDING', 'A cancellation request is already open',
    'Eventsli is reviewing it. You will get an email with the decision.', 'waiting'),

  // ── Media ─────────────────────────────────────────────────────────────────
  E('UNSUPPORTED_MEDIA_TYPE', 'That file type will not work',
    'Upload a JPEG, PNG or WebP image.'),
  E('STORAGE_NOT_CONFIGURED', 'Image uploads are unavailable',
    'This is a configuration on our side. Your event is saved — add the image later.', 'waiting'),

  // ── Switched off on this platform ─────────────────────────────────────────
  // Card payments or Google sign-in not turned on. It used to arrive as
  // PAYMENT_REQUIRED and tell the person to try another card.
  E('FEATURE_DISABLED', 'Not available yet',
    'This is switched off on Eventsli for now. Nothing was charged or changed — try again later or use another way in.', 'waiting'),

  // ── Generic ───────────────────────────────────────────────────────────────
  E('VALIDATION_ERROR', 'Check the details',
    'Something in the form needs fixing.'),
  E('RATE_LIMITED', 'Too many attempts',
    'Wait a moment before trying again.', 'retry'),
  E('CONFLICT', 'That cannot be done right now',
    'Something changed while you were working. Reload and try again.', 'retry'),
  E('NOT_FOUND', 'Not found',
    'It may have been removed, or the link may be wrong.', 'fatal'),
  E('INTERNAL_ERROR', 'Something went wrong on our side',
    'Not your doing, and nothing was changed. Please try again in a moment.', 'retry'),
  E('NETWORK', 'Could not reach the server',
    'Check your connection and try again.', 'retry'),
]));

/**
 * Resolves any thrown value into something renderable.
 *
 * An UNMAPPED code falls back to the server's own message and logs a warning
 * rather than passing silently. A code this table has never heard of is either
 * a backend that moved ahead of the frontend or a typo in a controller, and
 * both need to be loud — a silent fallback is how a code stays unmapped for
 * months.
 */
export function describeError(err) {
  const code = err?.code;
  const known = code && ERRORS[code];
  if (known) return known;

  if (code && code !== 'ERROR' && process.env.NODE_ENV !== 'production') {
    console.warn(`[errors] Unmapped API error code "${code}". Add it to utils/errors.js.`);
  }

  return {
    code: code || 'ERROR',
    title: 'Something went wrong',
    recovery: err?.message || 'Please try again.',
    tone: 'retry',
  };
}

/** True for the codes that mean the seat selection itself has to be redone. */
/**
 * The sentence to show for a failure.
 *
 * The server's own message when there is one — it names the field, the number
 * or the rule ("Tickets have already sold, so feeBearer can no longer change").
 * `describeError`'s recovery line is the fallback, for a network failure or a
 * response with nothing more specific to say. Showing only the recovery line
 * turned every one of those refusals into "Something in the form needs fixing."
 */
export function messageFor(err) {
  const { recovery } = describeError(err);
  const text = typeof err?.message === 'string' ? err.message.trim() : '';
  if (!text || err?.code === 'NETWORK' || text === err?.code) return recovery;
  return text;
}

export function isSelectionLost(code) {
  return ['SEAT_UNAVAILABLE', 'TABLE_UNAVAILABLE', 'TABLE_PARTIALLY_SOLD',
    'RESERVATION_EXPIRED', 'RESERVATION_NOT_FOUND'].includes(code);
}

/** True when the blocker is the organizer's Stripe setup, not the buyer. */
export function isOrganizerPayoutProblem(code) {
  return ['STRIPE_NOT_CONNECTED', 'STRIPE_NOT_ACTIVE', 'STRIPE_NOT_CONFIGURED'].includes(code);
}
