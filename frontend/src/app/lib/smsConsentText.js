/**
 * The exact sentences beside each SMS consent box — a mirror of
 * backend/services/sms/consentText.js, which stores the same words as evidence.
 * test/smsConsent.test.js fails if the two drift: a record must hold the words
 * that were on the screen.
 *
 * Pure.
 */
export const CONSENT_TEXT = Object.freeze({
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

/**
 * The opt-in confirmation text, as sent when someone newly agrees to texts
 * about their tickets: optInConfirmation({ transactional: true }) in
 * backend/services/sms/consentText.js. Quoted on /sms-terms and submitted to
 * carriers; test/smsTerms.test.jsx fails if it drifts from the backend.
 */
export const OPT_IN_CONFIRMATION =
  'Eventsli: You are signed up for ticket and event alerts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.';

export function consentText(version, vars = {}) {
  const text = CONSENT_TEXT[version] || '';
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '').trim() || 'the organizer');
}
