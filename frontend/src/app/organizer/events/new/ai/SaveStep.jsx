'use client';

import Link from 'next/link';
import NavIcon from '../../../../components/shell/NavIcon';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import { Notice } from '../../../../components/Feedback';
import { FEE_BEARERS, PAYMENT_OPTIONS } from '../wizardModel';
import { AiStepper, ActionBar } from './AiParts';

/**
 * STEP 3 — how buyers pay, then save.
 *
 * THE ORGANIZER'S, ALWAYS. Payment channels and who carries the booking fee
 * are money settings (BRD §04); the AI schema has no field for either, and
 * this is the only screen that sets them. Eventsli's own commission and
 * payment fee are not shown as choices because they are not choices — the
 * full breakdown is in the pre-submit dialog on the event, as for any event.
 *
 * SAVING MAKES A PRIVATE DRAFT. Never submitted, never published: the
 * organizer submits it later from the event, after the terms, and Eventsli
 * reviews it (BRD §16, §21).
 */
function Option({ name, value, current, onChange, icon, title, desc }) {
  return (
    <label className={`es-ai-opt${current === value ? ' is-on' : ''}`}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={onChange} />
      {icon && <span className="es-ai-opt__icon" aria-hidden="true"><NavIcon name={icon} size={18} /></span>}
      <span className="es-ai-opt__body"><span className="es-ai-opt__title">{title}</span><span className="es-ai-opt__desc">{desc}</span></span>
      <span className="es-ai-radio" aria-hidden="true" />
    </label>
  );
}

export default function SaveStep({ form, set, organizer, summary, busy, error, partial, onBack, onSave, onRetryPartial }) {
  const ticketed = form.listingType !== 'display_only';
  const choices = organizer.payments?.choices || [];
  const perOrder = Number(form.maxTicketsPerOrder);
  const perOrderBad = ticketed && !(Number.isInteger(perOrder) && perOrder >= 1 && perOrder <= 100);

  if (partial) {
    return (
      <div className="es-ai es-ai--narrow">
        <AiStepper index={2} />
        <header className="es-ai-head">
          <h1 className="es-ai-title">Saved, with {partial.failed.length === 1 ? 'one thing' : `${partial.failed.length} things`} to add</h1>
          <p className="es-ai-lede">Your event is saved as a private draft. These did not save:</p>
        </header>
        <ul className="es-ai-panel es-ai-faillist">
          {partial.failed.map((f) => (
            <li key={f.key}><NavIcon name="alert" size={16} /> <b>{f.label || 'Untitled'}</b> — {f.error?.message || 'could not be saved'}</li>
          ))}
        </ul>
        <ActionBar
          actions={(
            <>
              <Link href={`/organizer/events/${partial.eventId}?created=1`} className="es-btn es-btn--ghost">Open the event</Link>
              <button type="button" className="es-btn es-btn--primary es-btn--lg" onClick={onRetryPartial} disabled={busy}>
                {busy ? 'Adding…' : 'Try adding them again'}
              </button>
            </>
          )}
        />
      </div>
    );
  }

  return (
    <form className="es-ai es-ai--narrow" onSubmit={(e) => { e.preventDefault(); if (!perOrderBad) onSave(); }} noValidate>
      <AiStepper index={2} />
      <header className="es-ai-head">
        <h1 className="es-ai-title">{ticketed ? 'How buyers pay' : 'Save your listing'}</h1>
        <p className="es-ai-lede es-ai-lede--icon">
          <NavIcon name="shield" size={16} />
          <span>{ticketed ? 'Always your choice. AI never sets payments or fees.' : 'A listing sells nothing, so there is nothing to pay for.'}</span>
        </p>
      </header>

      {ticketed && (
        <div className="es-ai-panel">
          <fieldset className="es-ai-group">
            <legend className="es-ai-label">Payment options</legend>
            {choices.length === 0 ? (
              <Notice tone="warning" title="You have no payment method yet.">
                <p>You can still save this draft. It cannot go on sale until you connect Stripe or add a manual payment method.</p>
              </Notice>
            ) : (
              <div className="es-ai-opts">
                {choices.map((c) => (
                  <Option
                    key={c} name="paymentOption" value={c} current={form.paymentOption}
                    onChange={() => set({ paymentOption: c })}
                    icon={PAYMENT_OPTIONS[c][2]} title={PAYMENT_OPTIONS[c][0]} desc={PAYMENT_OPTIONS[c][1]}
                  />
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="es-ai-group">
            <legend className="es-ai-label">Booking fees</legend>
            <div className="es-ai-opts">
              {FEE_BEARERS.map(([value, title, desc]) => (
                <Option key={value} name="feeBearer" value={value} current={form.feeBearer} onChange={() => set({ feeBearer: value })} icon="receipt" title={title} desc={desc} />
              ))}
            </div>
          </fieldset>
          <Field
            label="Most tickets in one order" type="number" name="maxTicketsPerOrder" required min={1} max={100} inputMode="numeric"
            value={form.maxTicketsPerOrder} onChange={(e) => set({ maxTicketsPerOrder: e.target.value })}
            error={perOrderBad ? 'Between 1 and 100.' : null}
          />
          <label className="es-check">
            <input type="checkbox" className="es-check__box" checked={form.allowTicketTransfer} onChange={(e) => set({ allowTicketTransfer: e.target.checked })} />
            <span className="text-sm">
              <span className="text-ink">Let buyers pass a ticket on</span>
              <span className="block text-muted">Once per ticket. The old QR code stops working.</span>
            </span>
          </label>
        </div>
      )}

      <div className="es-ai-summary">
        <p className="es-ai-summary__title">Saved as a private draft</p>
        <p className="es-ai-summary__sub">{summary}</p>
        <p className="es-ai-summary__next">
          Next: {ticketed ? (form.admissionType === 'reserved' ? 'add a cover, draw the seating map, then submit for review.' : 'add a cover, then submit for review.') : 'add a cover, then submit for review.'}{' '}
          Eventsli approves every event before it goes live.
        </p>
      </div>

      <FormError error={error} />

      <ActionBar
        actions={(
          <>
            <button type="button" className="es-btn es-btn--ghost" onClick={onBack} disabled={busy}>Back</button>
            <button type="submit" className="es-btn es-btn--primary es-btn--lg" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>
          </>
        )}
      />
    </form>
  );
}
