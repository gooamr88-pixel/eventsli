'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { SectionHeader, Panel } from '../../../../components/ui/Page';
import DataTable from '../../../../components/ui/DataTable';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, Empty, ErrorNotice, Notice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';

/**
 * Ticket types — the named price bands.
 *
 * These are load-bearing in a way the name hides. `seat_price_cents` resolves
 * seat override → table → TIER, and ends in `COALESCE(…, …, 0)`. Until tiers
 * existed, a seat with no override and no tier sold for NOTHING. So an event
 * with a seat map and no tier is not "unconfigured", it is dangerous.
 *
 * EDITABLE, not only add-and-delete. The API always allowed a PATCH; the page
 * never offered one, so a typo or a wrong price on a type that seats already use
 * could not be corrected at all — and the refusals told organizers to "set its
 * allocation", which nothing on the page could do. The API's own rules stand:
 * a price freezes once a ticket has sold at it, and an allocation cannot go
 * below what has sold. Its sentence is shown when it refuses.
 *
 * Prices are entered in the event's currency and sent in CENTS.
 */
export default function Tiers({ eventId }) {
  const currency = useEventContext()?.event?.currency || 'USD';
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(`/events/${eventId}/tiers`);
  const [editing, setEditing] = useState(null);   // null · 'new' · a tier

  async function remove(tier) {
    const ok = await confirm({
      title: `Delete “${tier.name}”?`,
      tone: 'danger',
      body: (
        <p>
          If any seats are priced by it, this is refused — they would otherwise fall back to costing
          nothing. A type that has sold tickets cannot be deleted either.
        </p>
      ),
      confirmLabel: 'Delete ticket type',
    });
    if (!ok) return;
    try {
      await del(`/events/${eventId}/tiers/${tier.id}`, { noRedirect: true });
      toast.success(`“${tier.name}” was deleted.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  const tiers = Array.isArray(data) ? data : [];

  return (
    <div className="fx-stack">
      <SectionHeader
        title="Ticket types"
        lede="The prices seats are sold at. A price locks once a ticket of that type has sold."
        actions={!editing && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing('new')}>
            Add a ticket type
          </button>
        )}
      />

      {editing && (
        <TierForm
          key={editing === 'new' ? 'new' : editing.id}
          eventId={eventId}
          currency={currency}
          tier={editing === 'new' ? null : editing}
          onDone={(message) => { setEditing(null); toast.success(message); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="list" rows={3} label="Loading ticket types" />
      ) : tiers.length === 0 ? (
        <>
          <Notice tone="warning" title="Every seat needs a price.">
            <p>A seat with no ticket type and no override sells for nothing, so an event with a seat map needs at least one.</p>
          </Notice>
          {!editing && <Empty title="No ticket types yet." hint="Add General Admission, VIP, Early bird — whatever this event sells." />}
        </>
      ) : (
        <DataTable
          caption="Ticket types"
          rows={tiers}
          columns={[
            {
              key: 'name',
              label: 'Ticket type',
              primary: true,
              render: (t) => (
                <span className="fx-stack fx-stack--sm gap-0.5">
                  <span className="fx-break font-medium text-ink">{t.name}</span>
                  {t.description && <span className="text-sm text-muted">{t.description}</span>}
                </span>
              ),
            },
            { key: 'price', label: 'Price', align: 'end', render: (t) => <span className="es-nums">{formatMoney(t.priceCents, currency)}</span> },
            {
              key: 'sold',
              label: 'Sold',
              render: (t) => (
                t.quantity === null ? (
                  // null is not "none left" — it is "bounded by the seat map".
                  <span className="text-muted">{t.soldCount} sold · limited by the seat map</span>
                ) : (
                  <span className="fx-stack fx-stack--sm gap-1">
                    <span className="es-nums text-sm">{t.soldCount} of {t.quantity}</span>
                    <progress className="es-progress" max={Math.max(t.quantity, 1)} value={Math.min(t.soldCount, t.quantity)} aria-label={`${t.soldCount} of ${t.quantity} sold`} />
                  </span>
                )
              ),
            },
            {
              key: 'actions',
              label: 'Actions',
              hideLabel: true,
              align: 'end',
              render: (t) => (
                <span className="fx-row justify-end">
                  <button type="button" onClick={() => setEditing(t)} className="es-btn es-btn--ghost es-btn--sm">Edit</button>
                  <button type="button" onClick={() => remove(t)} className="es-btn es-btn--ghost es-btn--sm">Delete</button>
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE KINDS, and what each one is a shortcut FOR.
 *
 * Every one of these is expressible with the fields below it — a kind sets no
 * rule that cannot be set by hand, and nothing in the money path branches on
 * it. That is deliberate: the day a price depends on a label, renaming a ticket
 * type changes what somebody is charged.
 *
 * What a kind IS: a badge the buyer recognises, and a set of defaults that
 * describe how that kind of ticket is normally sold. An organizer adding
 * "Early bird" almost always wants an end date, and one adding "Complimentary"
 * almost always wants it free and off the public list — the defaults save them
 * finding that out after publishing.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const KINDS = [
  ['standard', 'Standard', 'The usual ticket.'],
  ['general', 'General admission', 'Unreserved entry.'],
  ['vip', 'VIP', 'Premium — priced higher, usually limited.'],
  ['early_bird', 'Early bird', 'Cheaper, and stops selling on a date.'],
  ['complimentary', 'Complimentary', 'Guest list and press. Free and hidden from the public page.'],
];

/** What choosing a kind fills in. Only ever applied to a NEW type, and never
 *  on top of something the organizer already typed. */
const KIND_DEFAULTS = {
  complimentary: { price: '0', isHidden: true },
};

function TierForm({ eventId, currency, tier, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: tier?.name || '',
    description: tier?.description || '',
    price: tier ? (tier.priceCents / 100).toString() : '',
    quantity: tier?.quantity === null || tier?.quantity === undefined ? '' : String(tier.quantity),
    kind: tier?.kind || 'standard',
    salesStartAt: toLocalInput(tier?.salesStartAt),
    salesEndAt: toLocalInput(tier?.salesEndAt),
    maxPerOrder: tier?.maxPerOrder === null || tier?.maxPerOrder === undefined ? '' : String(tier.maxPerOrder),
    isHidden: Boolean(tier?.isHidden),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const cents = toCents(form.price);
  const priceInvalid = form.price !== '' && cents === null;
  const quantity = form.quantity === '' ? null : Number(form.quantity);
  const belowSold = tier && quantity !== null && quantity < tier.soldCount;
  const maxPerOrder = form.maxPerOrder === '' ? null : Number(form.maxPerOrder);
  const windowBackwards = Boolean(
    form.salesStartAt && form.salesEndAt && new Date(form.salesEndAt) <= new Date(form.salesStartAt),
  );

  /** Applies a kind's defaults, without overwriting anything already typed. */
  function chooseKind(kind) {
    setForm((f) => {
      const next = { ...f, kind };
      if (tier) return next;
      const defaults = KIND_DEFAULTS[kind] || {};
      for (const [key, value] of Object.entries(defaults)) {
        if (f[key] === '' || f[key] === false) next[key] = value;
      }
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tier) {
        // Only what changed, so a refusal is about the field that was touched.
        const body = {};
        if (form.name.trim() !== tier.name) body.name = form.name.trim();
        if ((form.description.trim() || null) !== (tier.description || null)) body.description = form.description.trim() || null;
        if (cents !== null && cents !== tier.priceCents) body.priceCents = cents;
        if (quantity !== tier.quantity) body.quantity = quantity;
        if (form.kind !== (tier.kind || 'standard')) body.kind = form.kind;
        if (toIso(form.salesStartAt) !== (tier.salesStartAt || null)) body.salesStartAt = toIso(form.salesStartAt);
        if (toIso(form.salesEndAt) !== (tier.salesEndAt || null)) body.salesEndAt = toIso(form.salesEndAt);
        if (maxPerOrder !== (tier.maxPerOrder ?? null)) body.maxPerOrder = maxPerOrder;
        if (form.isHidden !== Boolean(tier.isHidden)) body.isHidden = form.isHidden;
        if (Object.keys(body).length === 0) { onCancel(); return; }
        await patch(`/events/${eventId}/tiers/${tier.id}`, body, { noRedirect: true });
        onDone(`“${form.name.trim()}” was updated.`);
      } else {
        await post(`/events/${eventId}/tiers`, {
          name: form.name.trim(),
          priceCents: cents ?? 0,
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          // Empty means "no fixed quantity", which the API takes as null — NOT
          // zero, which would mean sold out.
          ...(quantity !== null ? { quantity } : {}),
          kind: form.kind,
          ...(toIso(form.salesStartAt) ? { salesStartAt: toIso(form.salesStartAt) } : {}),
          ...(toIso(form.salesEndAt) ? { salesEndAt: toIso(form.salesEndAt) } : {}),
          ...(maxPerOrder !== null ? { maxPerOrder } : {}),
          ...(form.isHidden ? { isHidden: true } : {}),
        }, { noRedirect: true });
        onDone(`“${form.name.trim()}” was added.`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title={tier ? `Edit “${tier.name}”` : 'New ticket type'}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field
            label="Name" name="name" required maxLength={80} autoFocus
            hint="What a buyer sees, e.g. General Admission."
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Field
            label={`Price (${currency})`} name="price" inputMode="decimal" required
            hint={tier && tier.soldCount > 0
              ? 'Tickets have sold at this price, so it can no longer change.'
              : '0 is allowed — that makes it free.'}
            disabled={Boolean(tier && tier.soldCount > 0)}
            error={priceInvalid ? 'Enter an amount like 25 or 25.50.' : null}
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </div>
        <Field
          label="Description" name="description" maxLength={500}
          hint="Optional — what is included."
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <Field
          label="How many" name="quantity" type="number" min={tier ? Math.max(tier.soldCount, 1) : 1}
          hint={tier && tier.soldCount > 0
            ? `${tier.soldCount} sold so far — set it to ${tier.soldCount} to stop further sales. Empty lets the seat map decide.`
            : 'Leave empty to let the seat map decide.'}
          error={belowSold ? `${tier.soldCount} have already sold, so it cannot go lower.` : null}
          value={form.quantity}
          onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
        />

        <fieldset className="fx-stack fx-stack--sm gap-2 border-t border-border-base pt-4">
          <legend className="es-label mb-1.5"><span>Kind</span></legend>
          <div className="fx-grid" style={{ '--fx-col': '230px', '--fx-gap': '8px' }}>
            {KINDS.map(([value, label, detail]) => (
              <label key={value} className="es-check">
                <input
                  type="radio"
                  name="tier-kind"
                  className="es-check__box"
                  value={value}
                  checked={form.kind === value}
                  onChange={() => chooseKind(value)}
                />
                <span className="text-sm">
                  <span className="block text-ink">{label}</span>
                  <span className="block text-muted">{detail}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-subtle">
            A label and a set of starting points. Everything it fills in can be changed below.
          </p>
        </fieldset>

        <fieldset className="fx-stack fx-stack--sm gap-2 border-t border-border-base pt-4">
          <legend className="es-label mb-1.5"><span>When it sells</span></legend>
          <div className="fx-grid fx-grid--2">
            <Field
              label="On sale from" name="salesStartAt" type="datetime-local"
              hint="Empty means as soon as the event is published."
              value={form.salesStartAt}
              onChange={(e) => setForm((f) => ({ ...f, salesStartAt: e.target.value }))}
            />
            <Field
              label="Stops selling" name="salesEndAt" type="datetime-local"
              hint="Empty means it sells until the event starts."
              error={windowBackwards ? 'It has to stop after it starts.' : null}
              value={form.salesEndAt}
              onChange={(e) => setForm((f) => ({ ...f, salesEndAt: e.target.value }))}
            />
          </div>
          {/* Times are entered and shown in the BROWSER's zone here, unlike the
              event's own dates, which are in the venue's. That is the honest
              reading of what these are: a moment a sale opens, not a time on a
              programme — and the buyer in another country meets the same
              instant whatever their clock says. */}
          <p className="text-xs text-subtle">
            Times are in your own time zone. Buyers everywhere see this type appear and
            disappear at the same moment.
          </p>
        </fieldset>

        <Field
          label="Most of this type in one order" name="maxPerOrder" type="number" min={1} max={100}
          inputMode="numeric"
          hint="Empty uses the event's own limit. A number here can only be stricter, never looser."
          value={form.maxPerOrder}
          onChange={(e) => setForm((f) => ({ ...f, maxPerOrder: e.target.value }))}
        />

        <label className="es-check">
          <input
            type="checkbox"
            className="es-check__box"
            checked={form.isHidden}
            onChange={(e) => setForm((f) => ({ ...f, isHidden: e.target.checked }))}
          />
          <span className="text-sm">
            <span className="block text-ink">Hide this from the event page</span>
            <span className="block text-muted">
              Still buyable by anyone with the direct link from Share &amp; QR — that is how guest
              list and press tickets work. It is hidden, not locked.
            </span>
          </span>
        </label>

        <FormError error={error} />

        <div className="fx-row">
          <SubmitButton busy={busy} busyLabel="Saving…" disabled={priceInvalid || !form.price || belowSold || windowBackwards}>
            {tier ? 'Save changes' : 'Add ticket type'}
          </SubmitButton>
          <button type="button" onClick={onCancel} className="es-btn es-btn--ghost">Cancel</button>
        </div>
      </form>
    </Panel>
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
/**
 * An ISO instant → the value a `datetime-local` input wants, in the BROWSER's
 * zone. Empty for no date, which is what "no limit at this end" looks like.
 *
 * Deliberately the browser's zone rather than the event's, unlike the event's
 * own start and end. Those are a time on a programme — "doors at 7" means seven
 * o'clock at the venue. This is the moment a sale opens, which is one instant
 * for everybody, and showing it in the venue's zone would mean an organizer in
 * another country typing a number that is not the time they meant.
 */
function toLocalInput(iso) {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  const offset = when.getTimezoneOffset() * 60000;
  return new Date(when.getTime() - offset).toISOString().slice(0, 16);
}

/** The inverse. Null for empty, which is how a sale window is re-opened. */
function toIso(value) {
  if (!value) return null;
  const when = new Date(value);
  return Number.isNaN(when.getTime()) ? null : when.toISOString();
}

export function toCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}
