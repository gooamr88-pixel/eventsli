'use client';

import { useEffect, useState } from 'react';
import { get, post, patch, del } from '../../../../utils/apiClient';
import { describeError } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';

/**
 * Ticket types — the named price bands.
 *
 * These are load-bearing in a way the name hides. `seat_price_cents` resolves
 * seat override → table → TIER, and ends in `COALESCE(…, …, 0)`. Until tiers
 * existed, a seat with no override and no tier sold for NOTHING. So an event
 * with a seat map and no tier is not "unconfigured", it is dangerous.
 *
 * Prices are entered in dollars and sent in CENTS. The conversion is the one
 * piece of money arithmetic in the whole frontend, and it is here rather than
 * in `utils/money.js` on purpose: that module formats and does not compute, and
 * this is an input parse, not a calculation on a total.
 */
export default function Tiers({ eventId }) {
  const [tiers, setTiers] = useState(null);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await get(`/events/${eventId}/tiers`, { cache: 'no-store' });
        if (!cancelled) { setTiers(Array.isArray(data) ? data : []); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => { cancelled = true; };
  }, [eventId, reload]);

  const refresh = () => setReload((n) => n + 1);

  if (error) return <p className="text-sm text-muted">{describeError(error).recovery}</p>;
  if (!tiers) return <p className="text-sm text-subtle">Loading…</p>;

  return (
    <div className="fx-stack">
      <div className="fx-stack fx-stack--sm">
        <h2 className="text-xl">Ticket types</h2>
        <p className="max-w-[60ch] text-muted">
          Every seat needs a price. A seat with no ticket type and no override sells for
          nothing — so an event with a seat map needs at least one of these.
        </p>
      </div>

      {tiers.length === 0 ? (
        <div className="rounded-[--es-radius-lg] border border-dashed border-border-strong p-8 text-center">
          <p className="text-muted">No ticket types yet.</p>
        </div>
      ) : (
        <ul className="fx-stack fx-stack--sm">
          {tiers.map((tier) => (
            <TierRow key={tier.id} eventId={eventId} tier={tier} onChanged={refresh} />
          ))}
        </ul>
      )}

      {creating ? (
        <TierForm
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
          Add a ticket type
        </button>
      )}
    </div>
  );
}

function TierRow({ eventId, tier, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await del(`/events/${eventId}/tiers/${tier.id}`, { noRedirect: true });
      onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <li className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4">
      <div className="fx-row fx-row--between">
        <div className="fx-min0">
          <p className="fx-break text-ink">{tier.name}</p>
          {tier.description && <p className="text-sm text-muted">{tier.description}</p>}
          <p className="text-xs text-subtle">
            {tier.soldCount} sold
            {/* null is not "none left" — it is "bounded by the seat map".
                Rendering it as 0 shows an event as sold out. */}
            {tier.quantity === null
              ? ' · limited by the seat map'
              : ` · ${tier.remaining} of ${tier.quantity} left`}
          </p>
        </div>
        <div className="fx-row">
          <span className="es-nums whitespace-nowrap text-ink">
            {formatMoney(tier.priceCents, 'USD')}
          </span>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-sm text-muted hover:text-danger"
          >
            Delete
          </button>
        </div>
      </div>

      {confirming && (
        <div className="fx-stack fx-stack--sm rounded-[--es-radius-md] bg-bg-sunken p-3">
          <p className="text-sm text-ink">Delete “{tier.name}”?</p>
          {/* The API refuses while seats point at it, and the reason is worth
              stating: `seats.tier_id` is ON DELETE SET NULL and the price
              resolution ends in COALESCE(…, 0), so the database would accept
              the delete and silently reprice every one of those seats to zero. */}
          <p className="text-sm text-muted">
            If any seats are priced by it, this is refused — they would otherwise fall
            back to costing nothing.
          </p>
          <FormError error={error} />
          <div className="fx-row fx-row--between">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm text-muted hover:text-ink"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="rounded-[--es-radius-md] bg-danger px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function TierForm({ eventId, onDone, onCancel }) {
  const [form, setForm] = useState({ name: '', description: '', price: '', quantity: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const cents = toCents(form.price);
  const priceInvalid = form.price !== '' && cents === null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(`/events/${eventId}/tiers`, {
        name: form.name,
        priceCents: cents ?? 0,
        ...(form.description ? { description: form.description } : {}),
        // Empty means "no fixed quantity", which the API takes as null — NOT
        // zero, which would mean sold out.
        ...(form.quantity ? { quantity: Number(form.quantity) } : {}),
      }, { noRedirect: true });
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="fx-stack fx-stack--sm rounded-[--es-radius-lg] border border-border-base bg-surface p-4"
    >
      <Field
        label="Name" name="name" required maxLength={80} autoFocus
        hint="What a buyer sees, e.g. General Admission."
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />
      <Field
        label="Description" name="description" maxLength={500}
        value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
      />
      <Field
        label="Price" name="price" inputMode="decimal" required
        hint="In dollars. 0 is allowed — that makes it free."
        error={priceInvalid ? 'Enter an amount like 25 or 25.50.' : null}
        value={form.price}
        onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
      />
      <Field
        label="How many" name="quantity" type="number" min={1}
        hint="Leave empty to let the seat map decide."
        value={form.quantity}
        onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
      />

      <FormError error={error} />

      <div className="fx-row fx-row--between">
        <button type="button" onClick={onCancel} className="text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <SubmitButton busy={busy} busyLabel="Adding…" disabled={priceInvalid || !form.price}>
          Add
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * "25.50" → 2550. Returns null for anything that is not money.
 *
 * `Math.round(Number(x) * 100)` is the trap in the other direction:
 * `19.99 * 100` is 1998.9999999999998, which truncates to 1998 — a cent short
 * on every ticket. Rounding fixes that case, and the string is parsed rather
 * than trusted so "25.999" and "abc" are refused instead of silently accepted.
 */
export function toCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}
