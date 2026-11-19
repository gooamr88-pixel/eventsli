'use client';

import PhoneField from './PhoneField';
import { consentText } from '../../lib/smsConsentText';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Text message consent, on the checkout, both sign-up forms and the demo
 * booking (`mode="demo"`, 2026-11-19: texts about the demo, Eventsli news).
 *
 * SEPARATE BOXES, NEVER PRE-TICKED. "Texts about my tickets" and "offers"
 * are different answers, and so are offers from the organizer and offers
 * from Eventsli. The law in most markets requires an affirmative, unbundled
 * choice for marketing; nothing here is ticked for the person.
 *
 * The sentences come from lib/smsConsentText.js, the mirror of what the server
 * stores as evidence, so the words a person agreed to are the words on record.
 *
 * `showPhone`: the checkout has no phone field of its own, so this adds one;
 * the sign-up forms already ask, and pass `phone` only to say whether one is
 * filled in.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function SmsConsentFields({
  mode, value, onChange, phone = '', onPhone, showPhone = false, organizerName = null, phoneError = null, defaultCountry = null,
}) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.checked });
  const digits = (v) => String(v || '').replace(/[^0-9]/g, '').length;
  const hasPhone = digits(phone) >= 7;
  // THE CHECKOUT SHOWS THE CHOICES ONLY ONCE THERE IS A NUMBER (owner,
  // 2026-11-19: too many things to approve). Three greyed-out boxes nobody
  // could tick were noise on every order. The wording, the separate boxes and
  // the unticked default are unchanged — they appear the moment they can be
  // used. The sign-up forms keep showing them.
  // The demo booking too (2026-11-19): its own phone field comes first.
  const revealOnPhone = mode === 'checkout' || mode === 'demo';
  const showBoxes = !revealOnPhone || hasPhone;
  // Clearing the number clears the choices: hidden boxes must not come back
  // already ticked when a number is typed again.
  const changePhone = (next) => {
    onPhone(next);
    if (digits(next) < 7 && Object.values(value || {}).some(Boolean)) {
      onChange(Object.fromEntries(Object.keys(value).map((k) => [k, false])));
    }
  };
  const boxes = mode === 'demo'
    ? [
      ['transactional', 'demo.transactional.v1'],
      ['marketingPlatform', 'demo.marketing.v1'],
    ]
    : mode === 'checkout'
    ? [
      ['transactional', 'checkout.transactional.v1'],
      ...(organizerName ? [['marketingOrganizer', 'checkout.marketing_organizer.v1']] : []),
      ['marketingPlatform', 'checkout.marketing_platform.v1'],
    ]
    : [
      ['transactional', 'registration.transactional.v1'],
      ['marketing', 'registration.marketing.v1'],
    ];

  return (
    <fieldset className="fx-stack fx-stack--sm">
      <legend className="mb-1 text-sm font-medium text-ink">Text messages <span className="font-normal text-subtle">(optional)</span></legend>
      {showPhone && (
        // The country picker (flag + calling code, 2026-11-19) makes the value
        // international — "+20 100 …" — so the API never has to guess a region.
        <PhoneField
          label="Mobile number"
          name="phone"
          optional
          hint={hasPhone ? null : 'Only if you want texts about your tickets — the choices appear when you add a number.'}
          error={phoneError}
          value={phone}
          onChange={changePhone}
          defaultCountry={defaultCountry}
        />
      )}
      {showBoxes && boxes.map(([key, version]) => (
        <label key={key} className="flex items-start gap-2.5 text-sm text-muted">
          <input
            type="checkbox"
            name={`sms-${key}`}
            className="mt-0.5 shrink-0"
            // Shown unticked without a number: a ticked box that will not be sent would mislead.
            checked={hasPhone && Boolean(value[key])}
            disabled={!hasPhone}
            onChange={set(key)}
          />
          <span>{consentText(version, { organizer: organizerName })}</span>
        </label>
      ))}
      {!hasPhone && !revealOnPhone && <p className="text-xs text-subtle">Add a mobile number to choose text messages.</p>}
      {/* A new tab: leaving the checkout would cost the person their held seats. */}
      <p className="text-xs text-subtle">
        Details in our <a href="/sms-terms" target="_blank" rel="noopener" className="text-accent underline">text message terms</a>
        {' '}and <a href="/privacy" target="_blank" rel="noopener" className="text-accent underline">privacy policy</a>.
      </p>
    </fieldset>
  );
}

/** Only the ticked boxes, and only with a number: what the API expects. */
export function smsPayload(value, phone) {
  const any = Object.values(value || {}).some(Boolean);
  if (!any || String(phone || '').replace(/[^0-9]/g, '').length < 7) return {};
  return { sms: Object.fromEntries(Object.entries(value).filter(([, v]) => v === true)) };
}
