'use client';

import Field from './Field';
import { consentText } from '../../lib/smsConsentText';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Text message consent, on the checkout and on both sign-up forms.
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
  mode, value, onChange, phone = '', onPhone, showPhone = false, organizerName = null, phoneError = null,
}) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.checked });
  const hasPhone = String(phone || '').replace(/[^0-9]/g, '').length >= 7;
  const boxes = mode === 'checkout'
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
        <Field
          label="Mobile number"
          name="phone"
          type="tel"
          optional
          autoComplete="tel"
          inputMode="tel"
          hint="Only needed if you want texts. Include the country code if it is not this event’s country."
          // The same shape the API accepts, so a typo is caught here rather than
          // refusing the whole checkout after the button is pressed.
          // Parentheses escaped: browsers compile `pattern` with the v flag,
          // where a bare ( or ) in a class is invalid and the check is dropped.
          pattern="[0-9+\-\(\) ]{7,20}"
          maxLength={20}
          error={phoneError}
          value={phone}
          onChange={(e) => onPhone(e.target.value)}
        />
      )}
      {boxes.map(([key, version]) => (
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
      {!hasPhone && <p className="text-xs text-subtle">Add a mobile number to choose text messages.</p>}
      {hasPhone && mode === 'registration' && Object.values(value).some(Boolean) && (
        <p className="text-xs text-subtle">Enter the number with its country code, starting with + (for example +1 416 555 0199).</p>
      )}
    </fieldset>
  );
}

/** Only the ticked boxes, and only with a number: what the API expects. */
export function smsPayload(value, phone) {
  const any = Object.values(value || {}).some(Boolean);
  if (!any || String(phone || '').replace(/[^0-9]/g, '').length < 7) return {};
  return { sms: Object.fromEntries(Object.entries(value).filter(([, v]) => v === true)) };
}
