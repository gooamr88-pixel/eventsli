'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { centsToInput, moneyPlaceholder } from '../../../../lib/moneyInput';
import { minorUnits } from '../../../../lib/markets';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { Panel } from '../../../../components/ui/Page';
import Field from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';
import NavIcon from '../../../../components/shell/NavIcon';
import { toCents } from './Tiers';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * ADD-ONS (owner, 2026-11-17) — extras sold with a ticket: a photo with the
 * headliner, a meet & greet, a signed poster.
 *
 *   · the buyer chooses them at checkout, up to one per ticket on the order;
 *   · the price is added to the order and carries the same Eventsli fees as
 *     the tickets;
 *   · they appear on the ticket, the email and the door scanner, so the door
 *     team knows who to send where;
 *   · the ORGANIZER delivers them and is solely responsible for them. This
 *     panel says so before the first one is made.
 *
 * The API's rules: a price is fixed once one has sold; stock cannot go below
 * what has sold; one that was ever held or sold is switched off, not deleted,
 * so past orders keep their name.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function AddonsPanel({ eventId }) {
  const event = useEventContext()?.event;
  const currency = event?.currency || 'USD';
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi(`/events/${eventId}/addons`);
  const [editing, setEditing] = useState(null); // null · 'new' · an add-on

  const addons = Array.isArray(data) ? data : [];

  async function toggle(addon) {
    try {
      await patch(`/events/${eventId}/addons/${addon.id}`, { isActive: !addon.isActive }, { noRedirect: true });
      toast.success(addon.isActive ? `“${addon.name}” is off sale.` : `“${addon.name}” is on sale.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function remove(addon) {
    const ok = await confirm({
      title: `Remove “${addon.name}”?`,
      tone: 'danger',
      body: (
        <p>
          {addon.sold > 0
            ? `${addon.sold} already sold. Those buyers keep it and you still deliver it; it is only taken off sale.`
            : 'Buyers will no longer be offered it.'}
        </p>
      ),
      confirmLabel: 'Remove add-on',
    });
    if (!ok) return;
    try {
      const result = await del(`/events/${eventId}/addons/${addon.id}`, { noRedirect: true });
      toast.success(result?.deleted ? `“${addon.name}” was removed.` : `“${addon.name}” is off sale. Orders that include it keep it.`);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <section className="fx-stack" aria-labelledby="addons-title">
      {/* An h2: the page's h1 is Ticket types, above. */}
      <div className="es-addonhead">
        <div className="fx-min0">
          <h2 id="addons-title" className="es-addonhead__title">
            <NavIcon name="star" size={24} />Add-ons
          </h2>
          <p className="es-addonhead__lede">
            Extras buyers can add at checkout — a photo with the headliner, a meet &amp; greet. Up to one per ticket,
            priced on top of the ticket.
          </p>
        </div>
        {!editing && (
          <button type="button" className="es-btn es-btn--secondary es-btn--lg" onClick={() => setEditing('new')}>
            <NavIcon name="plus" size={20} />Add an add-on
          </button>
        )}
      </div>

      {/* Said before the first one exists: the organizer delivers these. */}
      <section className="es-payintro" data-tone="info" aria-labelledby="addons-duty">
        <span className="es-payintro__icon" aria-hidden="true"><NavIcon name="handshake" size={26} /></span>
        <div className="fx-min0">
          <h3 id="addons-duty" className="es-payintro__title">You deliver every add-on you sell.</h3>
          <p className="es-payintro__text">
            You alone are responsible for providing add-ons at the event, and for any refund if one cannot be
            delivered. Eventsli takes the payment with the tickets, under the same fees, and shows each add-on on
            the buyer’s ticket and on your door scanner.
          </p>
        </div>
      </section>

      {editing && (
        <AddonForm
          key={editing === 'new' ? 'new' : editing.id}
          eventId={eventId}
          currency={currency}
          addon={editing === 'new' ? null : editing}
          onDone={(message) => { setEditing(null); toast.success(message); reload(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {error ? (
        <ErrorNotice error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading variant="card" />
      ) : addons.length === 0 ? (
        !editing && <p className="text-sm text-muted">No add-ons yet. Buyers see none at checkout until you add one.</p>
      ) : (
        <ul className="es-addonlist">
          {addons.map((a) => (
            <li key={a.id} className={`es-addonlist__item ${a.isActive ? '' : 'is-off'}`}>
              <span className="es-addonlist__icon" aria-hidden="true"><NavIcon name="star" size={18} /></span>
              <div className="fx-min0">
                <p className="es-addonlist__name fx-break">
                  {a.name}
                  {!a.isActive && <span className="es-pill ml-2">Off sale</span>}
                </p>
                {a.description && <p className="text-sm text-muted fx-break">{a.description}</p>}
                <p className="es-addonlist__meta es-nums">
                  <b>{a.priceCents === 0 ? 'Free' : formatMoney(a.priceCents, currency)}</b>
                  <span>{a.sold} sold</span>
                  <span>{a.quantity === null ? 'No limit' : `${a.remaining} of ${a.quantity} left`}</span>
                </p>
              </div>
              <div className="es-addonlist__actions">
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(a)}>Edit</button>
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle(a)}>
                  {a.isActive ? 'Pause' : 'Resume'}
                </button>
                {a.isActive && (
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => remove(a)}>Remove</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AddonForm({ eventId, currency, addon, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: addon?.name || '',
    description: addon?.description || '',
    price: addon ? centsToInput(addon.priceCents, currency) : '',
    quantity: addon?.quantity === null || addon?.quantity === undefined ? '' : String(addon.quantity),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const sold = addon?.sold || 0;
  const cents = toCents(form.price, currency);
  const priceInvalid = form.price !== '' && cents === null;
  const quantity = form.quantity === '' ? null : Number(form.quantity);
  const belowSold = quantity !== null && quantity < Math.max(sold, 1);
  const priceLocked = sold > 0;

  async function submit(e) {
    e.preventDefault();
    if (priceInvalid || belowSold) return;
    setBusy(true);
    setError(null);
    try {
      if (addon) {
        const body = {};
        if (form.name.trim() !== addon.name) body.name = form.name.trim();
        if ((form.description.trim() || null) !== (addon.description || null)) body.description = form.description.trim() || null;
        if (!priceLocked && cents !== null && cents !== addon.priceCents) body.priceCents = cents;
        if (quantity !== addon.quantity) body.quantity = quantity;
        if (Object.keys(body).length === 0) { onCancel(); return; }
        await patch(`/events/${eventId}/addons/${addon.id}`, body, { noRedirect: true });
        onDone(`“${form.name.trim()}” was updated.`);
      } else {
        await post(`/events/${eventId}/addons`, {
          name: form.name.trim(),
          priceCents: cents ?? 0,
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(quantity !== null ? { quantity } : {}),
        }, { noRedirect: true });
        onDone(`“${form.name.trim()}” was added.`);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title={addon ? `Edit “${addon.name}”` : 'New add-on'}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field
            label="Name" name="addon-name" required maxLength={80} autoFocus
            hint="What the buyer sees, e.g. Photo with the headliner."
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Field
            label={`Price per ticket (${currency})`} name="addon-price" inputMode="decimal" required
            disabled={priceLocked}
            hint={priceLocked
              ? `${sold} sold at this price, so it is fixed. Add a new add-on for a new price.`
              : 'Added to the ticket price. Eventsli fees apply as on tickets.'}
            error={priceInvalid ? `Enter an amount like ${minorUnits(currency) ? `25 or 25.${'5'.padEnd(minorUnits(currency), '0')}` : '2500 (no decimals)'}.` : null}
            placeholder={moneyPlaceholder(currency)}
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
          />
        </div>
        <Field
          label="Description" name="addon-description" maxLength={300} optional
          hint="When and where it happens, e.g. After the show, at the stage door."
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
        <Field
          label="How many available" name="addon-quantity" type="number" min={Math.max(sold, 1)} optional
          hint={sold > 0 ? `${sold} sold so far. Leave empty for no limit.` : 'Leave empty for no limit — e.g. 50 if the star can only do 50 photos.'}
          error={belowSold ? `${sold} have already sold, so it cannot go lower.` : null}
          value={form.quantity}
          onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
        />
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} disabled={priceInvalid || belowSold}>{addon ? 'Save add-on' : 'Add add-on'}</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
