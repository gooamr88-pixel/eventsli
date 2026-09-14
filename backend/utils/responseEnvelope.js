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
  EVENT_ENDED: 410,
  PRICE_LOCKED_AFTER_SALE: 409,   // BRD §13
  TERMS_NOT_ACCEPTED: 403,        // BRD §21

  // inventory
  SEAT_UNAVAILABLE: 409,
  TABLE_UNAVAILABLE: 409,
  TABLE_PARTIALLY_SOLD: 409,      // BRD §25 — full-table option has closed
  TABLE_PASSWORD_REQUIRED: 403,   // BRD §27
  TABLE_PASSWORD_INVALID: 403,
  ORPHAN_SEAT: 400,
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
  INVOICE_OVERDUE: 402,           // BRD §18
  SCANNER_LOCKED: 403,

  // tickets
  TICKET_NOT_FOUND: 404,
  ALREADY_SCANNED: 409,
  TRANSFER_DISABLED: 403,         // BRD §10
  ALREADY_TRANSFERRED: 409,       // BRD §10 — one transfer only

  // media
  UNSUPPORTED_MEDIA_TYPE: 415,
  STORAGE_NOT_CONFIGURED: 503,

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

  // app.js's catch-all. A client can receive it, so it needs a sentence.
  INTERNAL_ERROR: 500,

  // generic
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  CONFLICT: 409,
  NOT_FOUND: 404,
};

/** Sends an RPC's `{ success:false, error, message }` result as a failure. */
function sendRpcFailure(res, result, fallbackStatus = 400) {
  const code = result?.code || result?.error || 'ERROR';
  return sendFail(res, {
    status: ERROR_STATUS[code] || fallbackStatus,
    error: code,
    message: result?.message || 'Request could not be completed.',
    ...(result?.meta ? { meta: result.meta } : {}),
  });
}

module.exports = { sendOk, sendFail, sendRpcFailure, ERROR_STATUS };
