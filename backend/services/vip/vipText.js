const crypto = require('node:crypto');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VIP Services — the rules with no database (2026-11-28): references, the
 * WhatsApp links, the words for each status, and WHICH CHANNEL a message to
 * an organizer goes by. Pure, and tested in test/vipServices.test.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// No 0/O, 1/I/L: a reference is read aloud and typed from a phone screen.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const REFERENCE = /\bVIP[-\s]?([2-9A-HJ-NP-Z]{6})\b/gi;

function newReference(bytes = crypto.randomBytes(6)) {
  let out = '';
  for (let i = 0; i < 6; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `VIP-${out}`;
}

/** Every reference quoted in a message, normalised ("vip 7kq2mx" → "VIP-7KQ2MX"). */
function referencesIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(REFERENCE)) out.add(`VIP-${m[1].toUpperCase()}`);
  return [...out];
}

/** A number as typed ("+1 (619) 666-6620", "00 20 100…") → E.164, or null. */
function normalisePhone(input) {
  const s = String(input || '').replace(/[\s().\-/]/g, '');
  const e = s.startsWith('00') ? `+${s.slice(2)}` : s;
  return /^\+[1-9][0-9]{6,14}$/.test(e) ? e : null;
}

/** "+16196666620" → "+1 (619) 666-6620" for North America; spaced otherwise. */
function displayPhone(e164) {
  const d = String(e164 || '').replace(/[^0-9]/g, '');
  if (d.length === 11 && d[0] === '1') return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return e164 ? `+${d}` : '';
}

/** Click-to-chat: opens WhatsApp on the phone or desktop with the text typed in. */
function waLink(e164, text) {
  const d = String(e164 || '').replace(/[^0-9]/g, '');
  if (!d) return null;
  return text ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : `https://wa.me/${d}`;
}

const BUDGETS = {
  under_1k: 'Under $1,000',
  '1k_5k': '$1,000 – $5,000',
  '5k_15k': '$5,000 – $15,000',
  '15k_plus': '$15,000 or more',
  unsure: 'Not sure yet',
};

const STATUS = {
  new: { label: 'Received', notice: 'We have your request and will be in touch shortly.' },
  in_review: { label: 'Reviewing', notice: 'Our team is reviewing your request now.' },
  quoted: { label: 'Proposal sent', notice: 'We have sent you a proposal. Reply here with any questions.' },
  confirmed: { label: 'Confirmed', notice: 'Your VIP service is confirmed. We will keep you posted at every step.' },
  in_progress: { label: 'In progress', notice: 'We are working on your event now.' },
  completed: { label: 'Completed', notice: 'Your VIP service is complete. Thank you for choosing Eventsli.' },
  cancelled: { label: 'Cancelled', notice: 'This request is cancelled.' },
};
const OPEN_STATUSES = ['new', 'in_review', 'quoted', 'confirmed', 'in_progress'];

/**
 * The organizer's first WhatsApp message, typed in for them. The reference
 * is what ties the chat to the request on our side, so it is in the first
 * line, and the rest saves the team asking.
 */
function openingMessage({ reference, contactName, serviceTitles = [], eventLabel = null, eventDate = null }) {
  const lines = [
    `Hi Eventsli, this is ${contactName || 'an organizer'}. I just sent VIP request ${reference}.`,
    serviceTitles.length ? `Services: ${serviceTitles.join(', ')}` : null,
    eventLabel ? `Event: ${eventLabel}${eventDate ? ` (${eventDate})` : ''}` : null,
    'I would like to continue here on WhatsApp.',
  ];
  return lines.filter(Boolean).join('\n');
}

/** The opening for someone with no request yet ("Message us on WhatsApp"). */
function generalOpening({ contactName, organization } = {}) {
  return `Hi Eventsli, this is ${contactName || 'an organizer'}${organization ? ` from ${organization}` : ''}. I would like to ask about your VIP Services.`;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
// A few minutes short of 24 hours: a reply sent at 23:59 can land after it.
const WINDOW_MARGIN_MS = 5 * 60 * 1000;

/** WhatsApp's customer-service window: free-form replies for 24 h after they write. */
function windowOpenUntil(lastInboundAt) {
  const t = Date.parse(lastInboundAt || '');
  return Number.isFinite(t) ? new Date(t + WINDOW_MS - WINDOW_MARGIN_MS).toISOString() : null;
}

/**
 * How a message to the organizer goes:
 *
 *   whatsapp_text       they wrote on WhatsApp in the last 24 h: a normal reply
 *   whatsapp_template   the window is closed, they agreed to WhatsApp messages
 *                       and prefer it: the approved update template
 *   email               otherwise (no number, no agreement, WhatsApp not
 *                       connected, or they prefer email)
 *
 * They are chatting on WhatsApp right now → WhatsApp, whatever they ticked:
 * answering where someone is talking is not starting a conversation.
 */
function decideChannel({ canSend, e164, optIn, preferred, lastInboundAt, now = Date.now() }) {
  if (!canSend) return { via: 'email', reason: 'WhatsApp is not connected yet.' };
  if (!e164) return { via: 'email', reason: 'No WhatsApp number on the request.' };
  const until = windowOpenUntil(lastInboundAt);
  if (until && Date.parse(until) > now) return { via: 'whatsapp_text', reason: 'They wrote on WhatsApp in the last 24 hours.' };
  if (!optIn) return { via: 'email', reason: 'They have not agreed to WhatsApp messages, and have not written in the last 24 hours.' };
  if (preferred === 'email') return { via: 'email', reason: 'They prefer email.' };
  return { via: 'whatsapp_template', reason: 'More than 24 hours since they wrote: the approved update template is sent.' };
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/** The three parameters of the `vip_request_update` template, in order. */
function templateParams({ contactName, reference, text }) {
  return [firstName(contactName), reference, text];
}

module.exports = {
  newReference, referencesIn, normalisePhone, displayPhone, waLink,
  BUDGETS, STATUS, OPEN_STATUSES, openingMessage, generalOpening,
  windowOpenUntil, decideChannel, templateParams, firstName,
};
