'use client';

import { useState } from 'react';
import { post } from '../../../../utils/apiClient';
import { messageFor } from '../../../../utils/errors';
import Field from '../../../../components/forms/Field';
import { useEventContext } from '../EventContext';
import { toCents } from '../tiers/Tiers';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A NEW TICKET TYPE, WITHOUT LEAVING THE MAP (2026-11-10).
 *
 * Pricing a table needs a ticket type, and the only place to make one was the
 * Ticket types page: leave the editor (with an unsaved-changes prompt in the
 * way), create it, come back, find the table again. This is the two fields
 * that matter — a name and a price — right where the type is being chosen.
 * Everything else about it (sale window, limits, hidden) stays on the Ticket
 * types page, where its own form lives.
 *
 * Created IMMEDIATELY, unlike the map: a ticket type is its own record, and
 * one nobody uses yet changes nothing. Assigning it is a map change and waits
 * for Save map like every other.
 *
 * Inline rather than a dialog, because one of its three hosts — the section
 * dialog — is a dialog already.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const NEW_TIER = '__new_ticket_type__';

export default function NewTierInline({ onCreated, onCancel }) {
  const ctx = useEventContext();
  const eventId = ctx?.eventId || ctx?.event?.id;
  const currency = ctx?.event?.currency || 'USD';
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const cents = toCents(price);
  const priceInvalid = price !== '' && cents === null;
  const ready = name.trim() !== '' && cents !== null && !busy;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const tier = await post(`/events/${eventId}/tiers`, { name: name.trim(), priceCents: cents }, { noRedirect: true });
      onCreated(tier);
    } catch (err) {
      setError(messageFor(err));
      setBusy(false);
    }
  }

  // Enter creates — and never reaches a form around this one (the section
  // dialog's), which would submit that dialog with half a ticket type typed.
  const onEnter = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (ready) create();
  };

  // Not a <form>: one host is inside a dialog's form, and forms cannot nest.
  return (
    <div className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-border-base p-3" role="group" aria-label="New ticket type">
      <Field label="Ticket type name" value={name} maxLength={80} autoFocus
        hint="What a buyer sees, e.g. VIP."
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onEnter} />
      <Field label={`Price (${currency})`} value={price} inputMode="decimal"
        hint="0 makes it free."
        error={priceInvalid ? 'Enter an amount like 25 or 25.50.' : null}
        onChange={(e) => setPrice(e.target.value)}
        onKeyDown={onEnter} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="fx-row gap-2">
        <button type="button" className="es-btn es-btn--primary es-btn--sm" disabled={!ready} onClick={create}>
          {busy ? 'Creating…' : 'Create ticket type'}
        </button>
        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={onCancel}>Cancel</button>
      </div>
      <p className="text-xs text-subtle">Sale dates, limits and hiding are on the Ticket types page.</p>
    </div>
  );
}
