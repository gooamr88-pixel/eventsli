'use client';

import { useState } from 'react';
import { get, patch } from '../../../utils/apiClient';
import { formatMoney } from '../../../utils/money';
import { useToast } from '../../../components/ui/Toast';
import { useConfirm } from '../../../components/ui/Confirm';
import { Panel } from '../../../components/ui/Page';
import DataTable from '../../../components/ui/DataTable';
import FormError from '../../../components/forms/FormError';
import SubmitButton from '../../../components/forms/SubmitButton';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Commission, tax and payment fee for one event — the admin's alone (BRD §05,
 * §06, §19).
 *
 * PREVIEW BEFORE SAVE is the point of this panel. "2.9% + 30¢" says nothing
 * about what a $20 ticket earns next to a $200 one, or what turning on a 13% tax
 * does to both. `GET /fees/preview` prices the UNSAVED values across a range of
 * ticket prices, and a row where the fee under-recovers the card cost is marked
 * where it happens rather than discovered in next month's total.
 *
 * Every figure in the preview is the API's (utils/money.js on the server);
 * nothing here computes money. Saving applies to tickets sold from now on —
 * orders already placed keep the rates they were sold at — and asks for a
 * reason, which the audit log keeps beside the old and new rates.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const fromEvent = (event) => ({
  commissionPct: String(event.fees.commissionPct),
  commissionTaxPct: String(event.fees.commissionTaxPct),
  eventTaxPct: String(event.fees.eventTaxPct),
  paymentFeeMode: event.fees.paymentFeeMode,
  paymentFeePct: String(event.fees.paymentFeePct),
  paymentFeeFixedCents: String(event.fees.paymentFeeFixedCents),
});

const toPayload = (form) => ({
  commissionPct: Number(form.commissionPct),
  commissionTaxPct: Number(form.commissionTaxPct),
  eventTaxPct: Number(form.eventTaxPct),
  paymentFeeMode: form.paymentFeeMode,
  ...(form.paymentFeeMode === 'manual'
    ? { paymentFeePct: Number(form.paymentFeePct), paymentFeeFixedCents: Number.parseInt(form.paymentFeeFixedCents, 10) || 0 }
    : {}),
});

const PERCENT_FIELDS = [
  ['commissionPct', 'Eventsli commission', 'Of the ticket price, borne by the organizer.'],
  ['commissionTaxPct', 'Tax on the commission', 'Charged on our commission, and remitted by us.'],
  ['eventTaxPct', 'Event tax', 'Added to the buyer’s total; the organizer remits it.'],
];

export default function FeeEditor({ event, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState(() => fromEvent(event));
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [lastEvent, setLastEvent] = useState(event);
  if (event !== lastEvent) {
    setLastEvent(event);
    setForm(fromEvent(event));
    setPreview(null);
  }

  const set = (key) => (e) => { setForm((f) => ({ ...f, [key]: e.target.value })); setPreview(null); };
  const changed = JSON.stringify(toPayload(form)) !== JSON.stringify(toPayload(fromEvent(event)));

  async function runPreview() {
    setPreviewing(true);
    setError(null);
    try {
      const query = new URLSearchParams(Object.entries(toPayload(form)).map(([k, v]) => [k, String(v)]));
      setPreview(await get(`/admin/events/${event.id}/fees/preview?${query}`, { cache: 'no-store' }));
    } catch (err) {
      setError(err);
    } finally {
      setPreviewing(false);
    }
  }

  async function save(e) {
    e.preventDefault();
    const answer = await confirm({
      title: 'Change the fees on this event?',
      body: (
        <p>
          Tickets sold from now on use the new rates. Orders already placed keep the rates they were sold at.
          {!preview && ' You have not previewed what these rates earn.'}
        </p>
      ),
      confirmLabel: 'Save fees',
      reason: { label: 'Why are the fees changing?', minLength: 5, maxLength: 1000, hint: 'Kept in the audit log with the old and new rates.' },
    });
    if (!answer) return;

    setBusy(true);
    setError(null);
    try {
      const result = await patch(`/admin/events/${event.id}/fees`, { ...toPayload(form), reason: answer.reason }, { noRedirect: true });
      toast.success(result?.note || 'Fees saved.');
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const currency = preview?.currency || event.currency;

  return (
    <Panel title="Fees, tax and commission">
      <form onSubmit={save} className="fx-stack fx-stack--sm">
        {PERCENT_FIELDS.map(([key, label, hint]) => (
          <NumberField key={key} id={`fee-${key}`} label={`${label} (%)`} hint={hint} value={form[key]} onChange={set(key)} max={100} step="0.01" />
        ))}

        <fieldset className="fx-stack fx-stack--sm">
          <legend className="text-sm text-ink">Payment fee</legend>
          {[
            ['auto', 'Automatic — matched to what the card costs'],
            ['manual', 'Manual — a fixed rate I set'],
          ].map(([value, label]) => (
            <label key={value} className="fx-row text-sm text-ink">
              <input
                type="radio"
                name={`fee-mode-${event.id}`}
                value={value}
                checked={form.paymentFeeMode === value}
                onChange={set('paymentFeeMode')}
                className="size-4 accent-[var(--es-accent)]"
              />
              {label}
            </label>
          ))}
        </fieldset>

        {form.paymentFeeMode === 'manual' && (
          <div className="fx-grid fx-grid--2">
            <NumberField id="fee-pct" label="Payment fee (%)" value={form.paymentFeePct} onChange={set('paymentFeePct')} max={100} step="0.01" />
            <NumberField id="fee-fixed" label="Fixed per order (cents)" value={form.paymentFeeFixedCents} onChange={set('paymentFeeFixedCents')} step="1" />
          </div>
        )}

        <FormError error={error} />

        <div className="fx-row">
          <button type="button" className="es-btn es-btn--secondary" onClick={runPreview} disabled={previewing}>
            {previewing ? 'Pricing…' : 'Preview what it earns'}
          </button>
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={!changed}>Save fees</SubmitButton>
        </div>
      </form>

      {preview && (
        <div className="fx-stack fx-stack--sm border-t border-border-base pt-3">
          {(preview.anyLossMaking || preview.anyBelowCost) && (
            <p className="es-notice es-notice--warning" role="status">
              <span>
                {preview.anyLossMaking
                  ? 'At some prices this loses money: the card costs more than we collect.'
                  : 'At some prices the payment fee does not cover the card cost, so we earn less than the commission.'}
              </span>
            </p>
          )}
          <DataTable
            caption="What this configuration earns per ticket"
            rowKey={(r) => r.faceCents}
            rows={preview.rows}
            columns={[
              { key: 'face', label: 'Ticket', primary: true, render: (r) => formatMoney(r.faceCents, currency) },
              { key: 'buyer', label: 'Buyer pays', align: 'end', render: (r) => formatMoney(r.buyerTotalCents, currency) },
              { key: 'fee', label: 'Payment fee', align: 'end', render: (r) => formatMoney(r.paymentFeeCents, currency) },
              { key: 'card', label: 'Card cost', align: 'end', render: (r) => formatMoney(r.stripeCostCents, currency) },
              {
                key: 'keep',
                label: 'We keep',
                align: 'end',
                render: (r) => (
                  <span className="fx-row justify-end">
                    <span className="es-nums">{formatMoney(r.platformNetCents, currency)}</span>
                    {r.lossMaking ? <span className="es-pill es-pill--danger">Loss</span>
                      : r.belowCost ? <span className="es-pill es-pill--warning">Below cost</span> : null}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}
    </Panel>
  );
}

function NumberField({ id, label, hint, value, onChange, max, step }) {
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={step}
        required
        value={value}
        onChange={onChange}
        className="es-input"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <p id={`${id}-hint`} className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}
