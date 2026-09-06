'use client';

import { useEffect, useState } from 'react';
import { get, post, patch } from '../../../../utils/apiClient';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

/**
 * Discount codes.
 *
 * They are DEACTIVATED, never deleted — orders point at the code they were
 * bought with, and deleting one makes a past receipt unexplainable. So the only
 * control here is a switch.
 *
 * A code is claimed at HOLD time, not at payment. That matters for the "uses"
 * number: a code with a limit is stock the way a seat is, and ten people
 * sitting on the checkout screen with its last use would otherwise all be told
 * they had it and nine be charged the wrong amount.
 */
export default function Promos({ eventId }) {
  const [promos, setPromos] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/events/${eventId}/promos`, { cache: 'no-store' });
        if (!cancelled) { setPromos(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  const refresh = () => setReload((n) => n + 1);

  if (error) return <ErrorNotice error={error} />;
  if (!promos) return <Loading variant="list" />;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Discount codes</h2>
        <p className="max-w-[60ch] text-muted">
          Applied by the buyer at checkout. A code is claimed when they hold their seats,
          so a limited one cannot be spent twice by two people at once.
        </p>
      </div>

      {promos.length === 0 ? (
        <div className="es-empty">
          <p className="text-muted">No codes yet.</p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {promos.map((p) => (
            <PromoRow key={p.id} eventId={eventId} promo={p} onChanged={refresh} />
          ))}
        </ul>
      )}

      {creating ? (
        <PromoForm
          eventId={eventId}
          onDone={() => { setCreating(false); refresh(); }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start rounded-[--es-radius-md] border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-bg-sunken"
        >
          Add a code
        </button>
      )}
    </div>
  );
}

function PromoRow({ eventId, promo, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await patch(`/events/${eventId}/promos/${promo.id}`, { isActive: !promo.isActive }, {
        noRedirect: true,
      });
      onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const used = promo.usedCount ?? promo.timesUsed ?? 0;

  return (
    <li className="fx-stack fx-stack--sm es-card p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="font-mono text-ink">{promo.code}</p>
          <p className="text-sm text-muted">
            {promo.discountType === 'percentage'
              ? `${promo.discountValue}% off`
              : `${promo.discountValue} off`}
            {' · '}
            {promo.maxUses ? `${used} of ${promo.maxUses} used` : `${used} used, no limit`}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`whitespace-nowrap rounded-full px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
            promo.isActive
              ? 'bg-success/15 text-success hover:bg-danger/15 hover:text-danger'
              : 'bg-bg-sunken text-muted hover:text-ink'
          }`}
        >
          {busy ? '…' : promo.isActive ? 'Active' : 'Off'}
        </button>
      </div>
      <FormError error={error} />
    </li>
  );
}

function PromoForm({ eventId, onDone, onCancel }) {
  const [form, setForm] = useState({
    code: '', discountType: 'percentage', discountValue: '', maxUses: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/promos`, {
        code: form.code.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue),
        // Empty means unlimited, which the API takes as null. Zero would mean
        // "no uses left" — a code that exists and can never be used.
        ...(form.maxUses ? { maxUses: Number(form.maxUses) } : {}),
      }, { noRedirect: true });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const valueInvalid = form.discountValue !== '' && !(Number(form.discountValue) > 0);

  return (
    <form onSubmit={submit} className="fx-stack fx-stack--sm es-card p-4">
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
        label={form.discountType === 'percentage' ? 'Percent off' : 'Amount off'}
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

      <FormError error={error} />

      <div className="fx-row fx-row--between">
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <SubmitButton busy={busy} busyLabel="Adding…" disabled={valueInvalid || !form.discountValue}>
          Add
        </SubmitButton>
      </div>
    </form>
  );
}
