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

module.exports = { CONSENT_TEXT, render };
