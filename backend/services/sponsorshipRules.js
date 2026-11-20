/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Sponsorship rules that need no database (2026-11-20). Pure, so they are
 * tested without one, and shared by the organizer side and the sponsor portal.
 *
 * The database re-checks everything here that touches money or stock
 * (migration 20261202090000); these exist so a person gets a clear sentence
 * before a request is sent, not instead of the lock.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const LEVELS = Object.freeze(['headline', 'gold', 'silver', 'bronze', 'partner']);
const STAGES = Object.freeze(['lead', 'proposal', 'signed', 'lost', 'cancelled']);
const OFFLINE_METHODS = Object.freeze(['bank_transfer', 'cash', 'cheque', 'other']);
const MAX_INSTALLMENTS = 12;
const MAX_BENEFITS = 30;

class SponsorshipError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => new SponsorshipError(code, message);

/**
 * The database's short codes, as the person reads them. Codes the API does not
 * list on its own map to a generic one with a specific sentence.
 */
const DB_CODES = Object.freeze({
  SPONSORSHIP_NOT_FOUND: ['NOT_FOUND', 'That sponsorship does not exist.'],
  SPONSORSHIP_PACKAGE_NOT_FOUND: ['NOT_FOUND', 'That package does not exist on this event.'],
  SPONSORSHIP_WRONG_STAGE: ['SPONSORSHIP_WRONG_STAGE', 'That cannot be done at this stage of the deal.'],
  SPONSORSHIP_ALREADY_SIGNED: ['SPONSORSHIP_WRONG_STAGE', 'This agreement is already signed.'],
  SPONSORSHIP_NOT_SIGNED: ['SPONSORSHIP_WRONG_STAGE', 'The agreement has to be signed before a payment is recorded.'],
  SPONSORSHIP_BAD_AMOUNT: ['VALIDATION_ERROR', 'That amount does not match what is owed.'],
  SPONSORSHIP_BAD_EXPIRY: ['VALIDATION_ERROR', 'The reply-by date has to be in the future.'],
  SPONSORSHIP_BAD_METHOD: ['VALIDATION_ERROR', 'Choose how the payment was made.'],
  SPONSORSHIP_SCHEDULE_MISMATCH: ['VALIDATION_ERROR', 'The payments have to add up to the sponsorship amount exactly.'],
  SPONSORSHIP_SOLD_OUT: ['SPONSORSHIP_SOLD_OUT', 'Every sponsorship in this package has been taken. Ask the organizer about another package.'],
  SPONSORSHIP_PROPOSAL_EXPIRED: ['SPONSORSHIP_PROPOSAL_EXPIRED', 'This proposal has expired. Ask the organizer to send it again.'],
  SPONSORSHIP_ALREADY_PAID: ['SPONSORSHIP_ALREADY_PAID', 'This payment has already been recorded.'],
  SPONSORSHIP_PAYMENT_MISMATCH: ['FORBIDDEN', 'That payment does not belong to this sponsorship.'],
});

/** A Supabase/PostgREST error from one of our functions, as a SponsorshipError (or the error itself). */
function fromDb(error) {
  const text = String(error?.message || '');
  const code = Object.keys(DB_CODES).find((c) => text.includes(c));
  if (!code) return new Error(text || 'database error');
  const [apiCode, message] = DB_CODES[code];
  return Object.assign(fail(apiCode, message), { dbCode: code });
}

/** A benefits list as stored: trimmed strings, no blanks, bounded. */
function cleanBenefits(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail('VALIDATION_ERROR', 'List what is included one item per line.');
  const out = list.map((b) => String(b ?? '').trim()).filter(Boolean);
  if (out.length > MAX_BENEFITS) throw fail('VALIDATION_ERROR', `A package can list at most ${MAX_BENEFITS} benefits.`);
  if (out.some((b) => b.length > 120)) throw fail('VALIDATION_ERROR', 'Each benefit is at most 120 characters.');
  return out;
}

/**
 * The payment schedule a proposal carries.
 *
 * [{ label, amountCents, dueAt }] → [{ label, amount_cents, due_at }]
 *
 * Must add up to the amount exactly — never "about right": the sponsor signs
 * the schedule, and a cent left over is a cent nobody can ever pay. A free
 * (in-kind) sponsorship has no schedule at all.
 */
function cleanSchedule(amountCents, schedule) {
  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount < 0) throw fail('VALIDATION_ERROR', 'The amount must be a whole number of cents.');
  const list = Array.isArray(schedule) ? schedule : [];
  if (amount === 0) {
    if (list.length) throw fail('VALIDATION_ERROR', 'An in-kind sponsorship has nothing to pay, so it has no payment schedule.');
    return [];
  }
  if (list.length < 1) throw fail('VALIDATION_ERROR', 'Add at least one payment.');
  if (list.length > MAX_INSTALLMENTS) throw fail('VALIDATION_ERROR', `At most ${MAX_INSTALLMENTS} payments.`);
  const out = list.map((item, i) => {
    const cents = Number(item?.amountCents);
    if (!Number.isInteger(cents) || cents <= 0) throw fail('VALIDATION_ERROR', `Payment ${i + 1} needs an amount above zero.`);
    const due = new Date(item?.dueAt);
    if (Number.isNaN(due.getTime())) throw fail('VALIDATION_ERROR', `Payment ${i + 1} needs a due date.`);
    const label = String(item?.label ?? '').trim().slice(0, 80) || (list.length === 1 ? 'Full payment' : `Payment ${i + 1}`);
    return { label, amount_cents: cents, due_at: due.toISOString() };
  });
  const sum = out.reduce((s, x) => s + x.amount_cents, 0);
  if (sum !== amount) {
    throw fail('VALIDATION_ERROR', `The payments add up to ${sum} but the sponsorship is ${amount} (in cents). Make them match exactly.`);
  }
  return out;
}

/**
 * A default schedule: `parts` equal payments, the first due now and the rest
 * spread before the event; any odd cents go on the first. A starting point the
 * organizer edits, never something sent without being shown.
 */
function suggestSchedule(amountCents, parts, { now = new Date(), eventStartsAt = null } = {}) {
  const amount = Number(amountCents);
  const n = Math.max(1, Math.min(MAX_INSTALLMENTS, Math.floor(Number(parts) || 1)));
  if (!Number.isInteger(amount) || amount <= 0) return [];
  const base = Math.floor(amount / n);
  const first = amount - base * (n - 1);
  const start = new Date(now).getTime();
  const end = eventStartsAt ? new Date(eventStartsAt).getTime() - 7 * 86400e3 : start + n * 30 * 86400e3;
  const span = Math.max(0, end - start);
  return Array.from({ length: n }, (_, i) => ({
    label: n === 1 ? 'Full payment' : (i === 0 ? 'Deposit' : `Payment ${i + 1}`),
    amountCents: i === 0 ? first : base,
    dueAt: new Date(start + (n === 1 ? 14 * 86400e3 : Math.round((span * i) / (n - 1)) + (i === 0 ? 7 * 86400e3 : 0))).toISOString(),
  }));
}

/**
 * Where a deal stands, in one word the screens and the board share.
 * `paid` and `part_paid` are not stages of their own — they are a signed deal
 * read together with its money.
 */
function status(deal) {
  if (deal.stage !== 'signed') return deal.stage;
  const amount = Number(deal.amount_cents ?? deal.amountCents ?? 0);
  const paid = Number(deal.paid_cents ?? deal.paidCents ?? 0);
  if (paid >= amount) return 'paid';
  return paid > 0 ? 'part_paid' : 'signed';
}

/** The board's columns, in order. */
const BOARD = Object.freeze([
  { key: 'lead', label: 'Leads' },
  { key: 'proposal', label: 'Proposal sent' },
  { key: 'signed', label: 'Signed' },
  { key: 'paid', label: 'Paid' },
  { key: 'closed', label: 'Lost / cancelled' },
]);

function boardColumn(deal) {
  const s = status(deal);
  if (s === 'part_paid') return 'signed';
  if (s === 'lost' || s === 'cancelled') return 'closed';
  return s;
}

/** Is a proposal past its reply-by date? */
function isExpired(deal, now = Date.now()) {
  const at = deal.proposal_expires_at ?? deal.proposalExpiresAt;
  return deal.stage === 'proposal' && !!at && new Date(at).getTime() <= now;
}

/** The platform fee on a card payment, in basis points of the amount. */
function feeFor(amountCents, feeBps) {
  const bps = Math.max(0, Math.min(3000, Math.floor(Number(feeBps) || 0)));
  return Math.floor((Number(amountCents) * bps) / 10000);
}

/**
 * A sponsor's logo: this event's own `sponsor-<16 hex>.<ext>` object from the
 * signed-upload steps. Checked by shape so a caller cannot point a deal at
 * another event's file.
 */
function ownSponsorLogo(eventId, path) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `events/${eventId}/`;
  return path.startsWith(prefix) && /^sponsor-[0-9a-f]{16}\.(jpg|png|webp)$/.test(path.slice(prefix.length));
}

module.exports = {
  LEVELS, STAGES, OFFLINE_METHODS, MAX_INSTALLMENTS, BOARD, DB_CODES,
  SponsorshipError, fail, fromDb, cleanBenefits, cleanSchedule, suggestSchedule,
  status, boardColumn, isExpired, feeFor, ownSponsorLogo,
};
