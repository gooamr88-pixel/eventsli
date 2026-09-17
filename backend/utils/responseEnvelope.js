/**
 * One response shape for the whole API.
 *
 *   success → { success: true,  data, meta?, pagination? }
 *   failure → { success: false, error, message, meta? }
 *
 * The alternative — every controller inventing its own shape — means the
 * frontend needs a special case per endpoint, and the special cases are
 * discovered one production bug at a time.
 */

function sendOk(res, data, { status = 200, meta, pagination } = {}) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  if (pagination) body.pagination = pagination;
  return res.status(status).json(body);
}

function sendFail(res, { status = 400, error = 'ERROR', message, meta } = {}) {
  const body = { success: false, error, message: message || error };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * Error code → HTTP status.
 *
 * Controllers and RPCs return a CODE; the status is looked up here. That keeps
 * the two from drifting — the same failure can't be a 400 on one route and a
 * 409 on another, and the frontend can switch on a stable string instead of
 * parsing an English sentence.
 *
 * Only codes something actually sends. EVENT_ENDED, ORPHAN_SEAT,
 * INVOICE_OVERDUE and ALREADY_SCANNED were listed with copy written for them
 * and were never emitted by any controller or SQL function (the gate reports a
 * duplicate scan as a result, not an error). The frontend's error map is held
 * to this list by a parity test, so a code comes back here the day it is sent.
 */
const ERROR_STATUS = {
  // auth
  UNAUTHENTICATED: 401,
  INVALID_TOKEN: 401,
  SESSION_REVOKED: 401,
  FORBIDDEN: 403,
  ACCOUNT_BANNED: 403,
  ORGANIZER_BANNED: 403,
  EMAIL_NOT_VERIFIED: 403,        // the right password, an unconfirmed address
  INVALID_CODE: 400,
  CODE_EXPIRED: 410,

  // events
  EVENT_NOT_FOUND: 404,
  EVENT_NOT_PUBLISHED: 403,
  EVENT_CANCELLED: 410,
  EVENT_SUSPENDED: 403,
  PRICE_LOCKED_AFTER_SALE: 409,   // BRD §13
  TERMS_NOT_ACCEPTED: 403,        // BRD §21

  // inventory
  SEAT_UNAVAILABLE: 409,
  TABLE_UNAVAILABLE: 409,
  TABLE_PARTIALLY_SOLD: 409,      // BRD §25 — full-table option has closed
  TABLE_PASSWORD_REQUIRED: 403,   // BRD §27
  TABLE_PASSWORD_INVALID: 403,
  TIER_SOLD_OUT: 409,
  PURCHASE_LIMIT_EXCEEDED: 400,   // BRD §11
  RESERVATION_EXPIRED: 410,
  RESERVATION_NOT_FOUND: 404,

  // payments
  PAYMENT_REQUIRED: 402,
  STRIPE_NOT_CONNECTED: 403,
  STRIPE_NOT_ACTIVE: 403,
  STRIPE_NOT_CONFIGURED: 503,
  CURRENCY_LOCKED_AFTER_SALE: 409,
  SCANNER_LOCKED: 403,

  // tickets
  TICKET_NOT_FOUND: 404,
  TRANSFER_DISABLED: 403,         // BRD §10
  ALREADY_TRANSFERRED: 409,       // BRD §10 — one transfer only

  // media
  UNSUPPORTED_MEDIA_TYPE: 415,
  STORAGE_NOT_CONFIGURED: 503,

  // A capability switched off on this platform — card payments, Google
  // sign-in. These were sent as PAYMENT_REQUIRED, whose copy tells a person to
  // try another card: advice that cannot help when payments are simply off.
  FEATURE_DISABLED: 503,

  // ── Codes that were being emitted WITHOUT being listed here ───────────────
  // Every one of these was passed straight to sendFail with a literal status,
  // so it never consulted this table — and the frontend's error map, which is
  // generated from this table, had no entry for any of them. They reached a
  // person as "something went wrong", which is the exact failure the table
  // exists to prevent. Found by enumerating the codes in source and diffing.
  //
  // Catalogue, not selling: a tier or category the organizer is editing.
  DUPLICATE_TIER: 409,
  DUPLICATE_CATEGORY: 409,
  TIER_IN_USE: 409,        // seats are priced by it — deleting reprices them to 0
  TIER_HAS_SALES: 409,
  BELOW_SOLD: 409,         // a quantity below what has already sold

  // The role ladder (BRD §19). Both are refusals a reviewer must be able to
  // read as a reason rather than as a failure.
  SELF_ACTION: 409,        // nobody acts on themselves
  LAST_SUPER_ADMIN: 409,   // the platform would become unadministrable

  // The organizer journey: activation by link, setup, payments, archive and
  // cancellation requests.
  TOKEN_EXPIRED: 400,              // an activation link past its time, or replaced
  ALREADY_VERIFIED: 409,           // the link was already used; sign in instead
  ORGANIZER_SETUP_REQUIRED: 403,   // organization details before the first event
  PAYMENT_METHOD_REQUIRED: 409,    // a ticketed event with no way to take money
  PAYMENT_METHOD_UNAVAILABLE: 400, // choosing a channel the account has not set up
  EVENT_ARCHIVED: 409,             // restore it before changing it
  CANCELLATION_PENDING: 409,       // one open request per event

  // app.js's catch-all. A client can receive it, so it needs a sentence.
  INTERNAL_ERROR: 500,

  // generic
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  NOT_FOUND: 404,
};

module.exports = { sendOk, sendFail, ERROR_STATUS };
