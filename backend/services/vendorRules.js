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

// 'draft', 'held' and 'expired' belong to the booking flow (20261204090000):
// the organizer's board never shows them.
const STAGES = Object.freeze(['draft', 'submitted', 'waitlisted', 'offered', 'held', 'confirmed', 'rejected', 'withdrawn', 'cancelled', 'expired']);
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
  VENDOR_HOLD_EXPIRED: ['VENDOR_HOLD_EXPIRED', 'Your booth was held for a limited time and has been released. Choose it again to start over.'],
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

// ── Booking (2026-11-21, migration 20261204090000) ────────────────────────
const BOOKING_MODES = Object.freeze(['apply', 'instant']);
const ADDON_KINDS = Object.freeze(['booth', 'marketing']);
const SOCIALS = Object.freeze(['instagram', 'x', 'youtube', 'facebook', 'whatsapp', 'linkedin']);
const MAX_DOCUMENTS = 8;
const DOC_TYPES = Object.freeze({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' });
const DOC_MAX_BYTES = 10 * 1024 * 1024;

/** The documents an organizer asks for: [{ id, label, hint, required }]. */
function cleanDocumentSpec(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail('VALIDATION_ERROR', 'Documents must be a list.');
  if (list.length > MAX_DOCUMENTS) throw fail('VALIDATION_ERROR', `Ask for at most ${MAX_DOCUMENTS} documents.`);
  const seen = new Set();
  return list.map((d, i) => {
    const label = String(d?.label ?? '').trim();
    if (!label) throw fail('VALIDATION_ERROR', `Document ${i + 1} needs a name.`);
    if (label.length > 80) throw fail('VALIDATION_ERROR', `Document ${i + 1}'s name is at most 80 characters.`);
    let id = /^[a-z0-9_-]{1,24}$/i.test(String(d?.id || '')) ? String(d.id) : `d${i + 1}`;
    while (seen.has(id)) id = `${id}x`;
    seen.add(id);
    const hint = String(d?.hint ?? '').trim().slice(0, 160) || null;
    return { id, label, hint, required: d?.required === true };
  });
}

/** The numbers on the public page: [{ value, label }], at most 3. */
function cleanHighlights(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw fail('VALIDATION_ERROR', 'Highlights must be a list.');
  const out = list
    .map((h) => ({ value: String(h?.value ?? '').trim().slice(0, 12), label: String(h?.label ?? '').trim().slice(0, 160) }))
    .filter((h) => h.value && h.label);
  if (out.length > 3) throw fail('VALIDATION_ERROR', 'At most 3 highlights.');
  return out;
}

/**
 * Social handles or links. A handle stays a handle ("@mybakery" → "mybakery");
 * a link must be http(s). Anything else is refused, so nothing stored here can
 * become a javascript: link on a page.
 */
function cleanSocials(input) {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw fail('VALIDATION_ERROR', 'Social links must be an object.');
  const out = {};
  for (const key of SOCIALS) {
    const raw = String(input[key] ?? '').trim();
    if (!raw) continue;
    if (raw.length > 300) throw fail('VALIDATION_ERROR', `The ${key} link is too long.`);
    if (/^https?:\/\/\S+$/i.test(raw)) out[key] = raw;
    else if (/^@?[\w.+-]{1,100}$/.test(raw)) out[key] = raw.replace(/^@/, '');
    else throw fail('VALIDATION_ERROR', `Enter your ${key === 'x' ? 'X' : key} page name or a full link starting with https://`);
  }
  return out;
}

/** A booking's add-ons: the chosen ids, against the event's active add-ons. */
function pickAddons(available, ids) {
  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) throw fail('VALIDATION_ERROR', 'Add-ons must be a list.');
  const byId = new Map(available.filter((a) => a.is_active !== false).map((a) => [a.id, a]));
  const chosen = [...new Set(ids.map(String))];
  if (chosen.length > 30) throw fail('VALIDATION_ERROR', 'At most 30 add-ons.');
  return chosen.map((id) => {
    const a = byId.get(id);
    if (!a) throw fail('VALIDATION_ERROR', 'One of those add-ons is no longer offered. Reload and choose again.');
    return { id: a.id, name: a.name, kind: a.kind, priceCents: Number(a.price_cents) };
  });
}

/** Whole cents, never floats. */
const addonsTotal = (addons) => (addons || []).reduce((s, a) => s + Number(a.priceCents || 0), 0);

/** A document's storage key: vendor-docs/<event>/<application>/<doc id>-<16 hex>.<ext>. */
function ownDocumentPath(eventId, appId, docId, path) {
  if (typeof path !== 'string' || path.length > 300) return false;
  const prefix = `vendor-docs/${eventId}/${appId}/`;
  if (!path.startsWith(prefix)) return false;
  const m = /^([a-z0-9_-]{1,24})-[0-9a-f]{16}\.(jpg|png|webp|pdf)$/i.exec(path.slice(prefix.length));
  return !!m && m[1] === docId;
}

/** The required documents not yet uploaded (or rejected and not replaced). */
function missingDocuments(spec, docs) {
  const have = new Map((docs || []).map((d) => [d.id, d]));
  return (spec || []).filter((s) => s.required && (!have.get(s.id) || have.get(s.id).status === 'rejected'));
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
  BOOKING_MODES, ADDON_KINDS, SOCIALS, MAX_DOCUMENTS, DOC_TYPES, DOC_MAX_BYTES,
  cleanDocumentSpec, cleanHighlights, cleanSocials, pickAddons, addonsTotal, ownDocumentPath, missingDocuments,
};
