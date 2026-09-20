'use client';

import { useState } from 'react';
import { post, patch } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import DataTable from '../../../../components/ui/DataTable';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, Empty, ErrorNotice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';

/**
 * Discount codes.
 *
 * DEACTIVATED, never deleted — orders point at the code they were bought with,
 * and deleting one makes a past receipt unexplainable. So the only control on a
 * row is a switch.
 *
 * A code is claimed at HOLD time, not at payment: a limited code is stock the
 * way a seat is, and ten people sitting on its last use must not all be told
 * they have it.
 */
export default function Promos({ eventId }) {
  const currency = useEventContext()?.event?.currency || 'USD';
  const toast = useToast();
  const { data, error, loading, reload } = useApi(`/events/${eventId}/promos`);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function toggle(promo) {
    setBusyId(promo.id);
    try {
      await patch(`/events/${eventId}/promos/${promo.id}`, { isActive: !promo.isActive }, { noRedirect: true });
      toast.success(promo.isActive ? `${promo.code} is switched off.` : `${promo.code} is live again.`);
      reload();
    } catch (err) {
      // The API's own sentence, not the generic recovery line for its code.
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusyId(null);
    }
  }

  const promos = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Discount codes"
        lede="Typed by the buyer at checkout. A limited code is reserved when seats are held, so its last use cannot be spent twice."
        actions={!creating && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setCreating(true)}>
            Add a code
          </button>
        )}
      />

      {creating && (
        <PromoForm
          eventId={eventId}
          currency={currency}
          onDone={(code) => { setCreating(false); toast.success(`${code} was created.`); reload(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={2} label="Loading discount codes" />
      ) : promos.length === 0 ? (
        !creating && <Empty title="No codes yet." hint="Create one for early birds, a partner, or the band's mailing list." />
      ) : (
        <DataTable
          caption="Discount codes"
          rows={promos}
          columns={[
            { key: 'code', label: 'Code', primary: true, render: (p) => <span className="font-mono text-ink">{p.code}</span> },
            {
              key: 'discount',
              label: 'Discount',
              // A fixed discount is shown with its currency. It read "25 off",
              // which leaves a buyer to guess what 25 is.
              render: (p) => (p.discountType === 'percentage'
                ? `${Number(p.discountValue)}% off`
                // Stored in whole currency units (claim_promo_code multiplies by 100).
                : `${formatMoney(Math.round(Number(p.discountValue) * 100), currency)} off`),
            },
            {
              key: 'uses',
              label: 'Used',
              render: (p) => {
                const used = p.usedCount ?? 0;
                return <span className="es-nums">{p.maxUses ? `${used} of ${p.maxUses}` : `${used} · no limit`}</span>;
              },
            },
            {
              key: 'status',
              label: 'Status',
              align: 'end',
              render: (p) => (
                <button
                  type="button"
                  onClick={() => toggle(p)}
                  disabled={busyId === p.id}
                  aria-pressed={p.isActive}
                  className={`es-pill ${p.isActive ? 'es-pill--accent' : ''} cursor-pointer disabled:opacity-50`}
                >
                  {busyId === p.id ? '…' : p.isActive ? 'Live — switch off' : 'Off — switch on'}
                </button>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

function PromoForm({ eventId, currency, onDone, onCancel }) {
  const [form, setForm] = useState({ code: '', discountType: 'percentage', discountValue: '', maxUses: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const valueInvalid = form.discountValue !== '' && !(Number(form.discountValue) > 0);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/promos`, {
        code: form.code.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        // Empty means unlimited (null). Zero would be a code that can never be used.
        ...(form.maxUses ? { maxUses: Number(form.maxUses) } : {}),
      }, { noRedirect: true });
      onDone(form.code.trim());
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title="New discount code">
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field
            label="Code" name="code" required minLength={2} maxLength={40} autoFocus
            hint="What the buyer types. Case does not matter."
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
          />
          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="promo-type" className="text-sm text-ink">Kind</label>
            <select
              id="promo-type" value={form.discountType}
              onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
              className="es-input"
            >
              <option value="percentage">Percentage off</option>
              <option value="fixed">Fixed amount off</option>
            </select>
          </div>
          <Field
            label={form.discountType === 'percentage' ? 'Percent off' : `Amount off (${currency})`}
            name="discountValue" inputMode="decimal" required
            error={valueInvalid ? 'Must be more than zero.' : null}
            value={form.discountValue}
            onChange={(e) => setForm((f) => ({ ...f, discountValue: e.target.value }))}
          />
          <Field
            label="Maximum uses" name="maxUses" type="number" min={1}
            hint="Leave empty for unlimited."
            value={form.maxUses}
            onChange={(e) => setForm((f) => ({ ...f, maxUses: e.target.value }))}
          />
        </div>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} busyLabel="Creating…" disabled={valueInvalid || !form.discountValue}>
            Create code
          </SubmitButton>
          <button type="button" onClick={onCancel} className="es-btn es-btn--ghost">Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
