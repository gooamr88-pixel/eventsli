/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Vendor rules that need no database (2026-11-20). Pure, so they are tested
 * without one, and shared by the organizer side, the vendor portal and the
 * public application form.
 *
 * The database re-checks everything here that touches money or stock
 * (migration 20261203090000); these exist so a person gets a clear sentence
 * before a request is sent, not instead of the lock.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { feeFor } = require('./sponsorshipRules');

const STAGES = Object.freeze(['submitted', 'waitlisted', 'offered', 'confirmed', 'rejected', 'withdrawn', 'cancelled']);
const OPEN_STAGES = Object.freeze(['submitted', 'waitlisted', 'offered']);
const OFFLINE_METHODS = Object.freeze(['bank_transfer', 'cash', 'cheque', 'other']);
const QUESTION_TYPES = Object.freeze(['text', 'long', 'yesno']);
const MAX_QUESTIONS = 10;
const MAX_CATEGORIES = 20;

class VendorError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const fail = (code, message) => new VendorError(code, message);

const DB_CODES = Object.freeze({
  VENDOR_NOT_FOUND: ['NOT_FOUND', 'That vendor application does not exist.'],
  VENDOR_BOOTH_NOT_FOUND: ['NOT_FOUND', 'Choose a booth type from this event.'],
  VENDOR_WRONG_STAGE: ['VENDOR_WRONG_STAGE', 'That cannot be done at this stage of the application.'],
  VENDOR_NOT_CONFIRMED: ['VENDOR_WRONG_STAGE', 'The offer has to be accepted before the booth fee is recorded.'],
  VENDOR_BAD_AMOUNT: ['VALIDATION_ERROR', 'That amount does not match the booth fee.'],
  VENDOR_BAD_EXPIRY: ['VALIDATION_ERROR', 'The reply-by date has to be in the future.'],
  VENDOR_BAD_METHOD: ['VALIDATION_ERROR', 'Choose how the payment was made.'],
  VENDOR_SOLD_OUT: ['VENDOR_SOLD_OUT', 'Every booth of this type has been taken. Ask the organizer about another space.'],
  VENDOR_OFFER_EXPIRED: ['VENDOR_OFFER_EXPIRED', 'This offer has expired. Ask the organizer to send it again.'],
  VENDOR_ALREADY_PAID: ['VENDOR_ALREADY_PAID', 'The booth fee has already been recorded.'],
  VENDOR_PAYMENT_MISMATCH: ['FORBIDDEN', 'That payment does not belong to this booking.'],
  VENDOR_BOOTH_TAKEN: ['VENDOR_BOOTH_TAKEN', 'That booth is already offered to or booked by another vendor. Choose another booth.'],
});

function fromDb(error) {
  const text = String(error?.message || '');
  const code = Object.keys(DB_CODES).find((c) => text.includes(c));
  if (!code) return new Error(text || 'database error');
  const [apiCode, message] = DB_CODES[code];
  return Object.assign(fail(apiCode, message), { dbCode: code });
}

/** A list of short strings (categories, what a booth includes): trimmed, no blanks or repeats. */
function cleanList(list, { max = 30, each = 120, what = 'items' } = {}) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail('VALIDATION_ERROR', `List the ${what} one per line.`);
  const out = [...new Set(list.map((x) => String(x ?? '').trim()).filter(Boolean))];
  if (out.length > max) throw fail('VALIDATION_ERROR', `At most ${max} ${what}.`);
  if (out.some((x) => x.length > each)) throw fail('VALIDATION_ERROR', `Each of the ${what} is at most ${each} characters.`);
  return out;
}

/**
 * The organizer's own questions, as stored. Each keeps a stable id so an
 * answer still finds its question after the list is reordered or relabelled.
 */
function cleanQuestions(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail('VALIDATION_ERROR', 'Questions must be a list.');
  if (list.length > MAX_QUESTIONS) throw fail('VALIDATION_ERROR', `At most ${MAX_QUESTIONS} questions.`);
  const seen = new Set();
  return list.map((q, i) => {
    const label = String(q?.label ?? '').trim();
    if (!label) throw fail('VALIDATION_ERROR', `Question ${i + 1} needs some words.`);
    if (label.length > 200) throw fail('VALIDATION_ERROR', `Question ${i + 1} is at most 200 characters.`);
    let id = /^[a-z0-9_-]{1,24}$/i.test(String(q?.id || '')) ? String(q.id) : `q${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    return { id, label, type: QUESTION_TYPES.includes(q?.type) ? q.type : 'text', required: q?.required === true };
  });
}

/**
 * An applicant's answers against the questions they were shown.
 * `answers` is { [questionId]: value }. Returns [{ id, label, answer }], or
 * throws naming the first required question left empty.
 */
function cleanAnswers(questions, answers) {
  const given = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
  return questions.map((q) => {
    let value = given[q.id];
    if (q.type === 'yesno') {
      value = value === true || value === 'yes' || value === 'Yes' ? 'Yes'
        : value === false || value === 'no' || value === 'No' ? 'No' : '';
    } else {
      value = String(value ?? '').trim().slice(0, q.type === 'long' ? 1000 : 200);
    }
    if (q.required && !value) throw fail('VALIDATION_ERROR', `Please answer: ${q.label}`);
    return { id: q.id, label: q.label, answer: value };
  });
}

/** Staff names for the door list, at most what the booth allows. */
function cleanStaff(list, allowed) {
  const names = cleanList(list, { max: 50, each: 80, what: 'names' });
  if (names.length > allowed) {
    throw fail('VALIDATION_ERROR', allowed === 1
      ? 'Your booth includes 1 staff pass.'
      : `Your booth includes ${allowed} staff passes, so list at most ${allowed} people.`);
  }
  return names;
}

/** Where an application stands, in one word the screens share. */
function status(app) {
  if (app.stage !== 'confirmed') return app.stage;
  return app.paid_at || app.paidAt ? 'paid' : 'confirmed';
}

const BOARD = Object.freeze([
  { key: 'submitted', label: 'New' },
  { key: 'waitlisted', label: 'Waitlist' },
  { key: 'offered', label: 'Offer sent' },
  { key: 'confirmed', label: 'Accepted · unpaid' },
  { key: 'paid', label: 'Booked' },
  { key: 'closed', label: 'Closed' },
]);

function boardColumn(app) {
  const s = status(app);
  return ['rejected', 'withdrawn', 'cancelled'].includes(s) ? 'closed' : s;
}

function isExpired(app, now = Date.now()) {
  const at = app.offer_expires_at ?? app.offerExpiresAt;
  return app.stage === 'offered' && !!at && new Date(at).getTime() <= now;
}

/** Applications are open: the program is on and its deadline has not passed. */
function applicationsOpen(program, now = Date.now()) {
  if (!program?.is_open && !program?.isOpen) return false;
  const close = program.applications_close_at ?? program.applicationsCloseAt;
  return !close || new Date(close).getTime() > now;
}

/** A vendor's logo: this event's own `vendor-<16 hex>.<ext>` object. */
function ownVendorLogo(eventId, path) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `events/${eventId}/`;
  return path.startsWith(prefix) && /^vendor-[0-9a-f]{16}\.(jpg|png|webp)$/.test(path.slice(prefix.length));
}

module.exports = {
  STAGES, OPEN_STAGES, OFFLINE_METHODS, QUESTION_TYPES, MAX_QUESTIONS, MAX_CATEGORIES, BOARD, DB_CODES,
  VendorError, fail, fromDb, cleanList, cleanQuestions, cleanAnswers, cleanStaff,
  status, boardColumn, isExpired, applicationsOpen, ownVendorLogo, feeFor,
};
