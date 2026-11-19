/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The exact words a person agreed to, versioned.
 *
 * Consent is only as good as the evidence of what was shown. Every consent row
 * stores the version id AND the rendered sentence; changing a sentence means
 * adding a new version, never editing one — a record must keep pointing at the
 * words that were actually on the screen that day.
 *
 * Mirrored for the forms in frontend/src/app/lib/smsConsentText.js, and a test
 * fails if the two drift.
 *
 * Pure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CONSENT_TEXT = Object.freeze({
  'checkout.transactional.v1':
    'Text me my ticket confirmation, reminders and important changes to this event. Msg & data rates may apply. Reply STOP to opt out.',
  'checkout.marketing_organizer.v1':
    'Send me news and offers from {organizer} by text. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.',
  'checkout.marketing_platform.v1':
    'Send me event news and offers from Eventsli by text. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.',
  'registration.transactional.v1':
    'Text me important notices about my account, my tickets and my events. Msg & data rates may apply. Reply STOP to opt out.',
  'registration.marketing.v1':
    'Send me Eventsli news and offers by text. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.',
  // Book a demo (2026-11-19): asked once a phone number is entered.
  'demo.transactional.v1':
    'Text me reminders and changes about my Eventsli demo. Msg & data rates may apply. Reply STOP to opt out.',
  'demo.marketing.v1':
    'Send me Eventsli news and offers by text. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.',
  'account.transactional.v1':
    'Text me about my tickets and events: confirmations, reminders and changes.',
  'account.marketing.v1':
    'Send me Eventsli news and offers by text.',
});

function render(version, vars = {}) {
  const text = CONSENT_TEXT[version];
  if (!text) throw new Error(`unknown consent text ${version}`);
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '').trim() || 'the organizer');
}

/**
 * The opt-in confirmation: the first text after someone newly agrees to texts.
 *
 * Carriers (CTIA, and every toll-free / 10DLC review) expect it to name the
 * program and carry four disclosures: frequency, rates, HELP and STOP. One
 * text per form, whatever was ticked, so a buyer who ticks three boxes gets one
 * confirmation, not three.
 *
 * The plain sentence for ticket texts alone is the one submitted to carriers as
 * the "opt-in confirmation message" — /sms-terms quotes it from here. GSM-7
 * only (no curly quotes), so it fits one 160-character segment.
 *
 * @param {{ transactional?: boolean, senders?: string[], brand?: string }} what
 *   senders: who the person newly agreed to get news and offers from.
 */
const OPT_IN_TAIL = 'Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.';
const SENDER_MAX = 30;

function optInConfirmation({ transactional = false, senders = [], brand = 'Eventsli' } = {}) {
  const names = [...new Set(senders.map((s) => String(s || '').trim()).filter(Boolean))]
    // A long name is cut at a word, with no ellipsis: the sentence ends in a full stop right after it.
    .map((s) => {
      if (s.length <= SENDER_MAX) return s;
      const atWord = s.slice(0, SENDER_MAX + 1).match(/^(.*\S)\s/);
      return atWord ? atWord[1] : s.slice(0, SENDER_MAX);
    });
  const parts = [];
  if (transactional) parts.push('ticket and event alerts');
  if (names.length) parts.push(`news and offers from ${names.join(' and ')}`);
  if (!parts.length) return null;
  return `${brand}: You are signed up for ${parts.join(', plus ')}. ${OPT_IN_TAIL}`;
}

module.exports = { CONSENT_TEXT, render, optInConfirmation, OPT_IN_TAIL };
