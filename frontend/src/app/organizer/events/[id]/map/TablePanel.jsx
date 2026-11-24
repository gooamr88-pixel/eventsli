'use client';

import { useState } from 'react';
import { ShapePicker, SeatsPerSide, TableAppearance, appearanceSummary } from './style/TableStyleSection';
import ShapeArt from './style/ShapeArt';
import NavIcon from '../../../../components/shell/NavIcon';
import { SHAPE_NAMES } from './shapeNames';
import { MAX_SEATS_PER_TABLE, keyOf } from './useMapDraft';
import { toCents } from '../tiers/Tiers';
import { centsToInput } from '../../../../lib/moneyInput';
import { formatMoney } from '../../../../utils/money';
import { useEventContext } from '../EventContext';
import NewTierInline, { NEW_TIER } from './NewTierInline';
import { Inspector, InspectorSection, InspectorAction, InspectorNote } from '../../../../components/inspector/Inspector';
import { Field, NumberField, SelectField, TextField, Toggle } from '../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything about one table, in the order an organizer needs it (2026-11-21):
 *
 *   TABLE            name, seats, shape — what it is.
 *   TICKETS & PRICE  what it sells as, and for. Before 2026-11-21 this sat
 *                    BELOW twelve shape tiles and five colour pickers, so the
 *                    one section with money in it was the one a reader had
 *                    to scroll for.
 *   AVAILABILITY     "Unavailable": sold or reserved outside Eventsli.
 *   PRIVATE ACCESS   behind a password; the password and invitation link.
 *   APPEARANCE       size and colours, folded by default.
 *
 * Two properties here have consequences a form cannot undo, and both say so:
 *
 * SHRINKING the seat count deletes the seats above the new number, and the API
 * refuses if any of them are booked. Growing is always safe.
 *
 * A PRIVATE table is on the buyer's map for everyone, marked Private with a
 * lock (owner, 2026-11-24 — until then it was omitted entirely). Pressing it
 * asks for the password, and the password gates the purchase: the hold
 * refuses the table and its seats without it. The invitation link still opens
 * the password prompt for exactly this table.
 *
 * AN UNAVAILABLE table (2026-11-24) is every open seat at it blocked — the
 * Preview's seat holds, applied to the whole table and saved with the map.
 * Buyers see it, faded, and cannot choose anything at it.
 *
 * WHICH PRICES ARE SHOWN FOLLOWS HOW THE EVENT SELLS (`purchaseMode`). Seats
 * only: a whole-table price is never charged, so it is not offered. Whole
 * tables only: the table price is the product and comes first, and a seat
 * price would never be charged. Both: everything, seat first.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function TablePanel({
  table, tiers, categories, onChange, onRotate, onDuplicate, onRemove, onTierCreated, purchaseMode = 'seat_only',
  // This table's seats after pending blocks ({ total, open, blocked, booked },
  // useStudioDraft.tableStock) and the switch that blocks or releases them.
  stock = null, onSetUnavailable = null,
}) {
  // "New ticket type…" open under the picker (NewTierInline).
  const [creatingTier, setCreatingTier] = useState(false);
  const currency = useEventContext()?.event?.currency;

  const key = keyOf(table);
  const set = (patch) => onChange(key, patch);
  const sold = Number(table.soldSeats) || 0;
  const tier = (tiers || []).find((t) => t.id === table.tierId) || null;
  const sellsSeats = purchaseMode !== 'table_only';
  const sellsTables = purchaseMode !== 'seat_only';
  const hasExtras = (sellsSeats && table.seatPriceCents != null)
    || (sellsSeats && sellsTables && table.priceCents != null)
    || !!table.categoryId;
  const [morePricing, setMorePricing] = useState(hasExtras);

  const priceSummary = sellsSeats
    ? (tier ? `${tier.name}${table.seatPriceCents != null ? ' · own seat price' : ''}` : table.seatPriceCents != null ? 'Seat price set' : 'Not priced')
    : (table.priceCents != null ? formatMoney(table.priceCents, currency) : 'Not priced');
  const unpriced = sellsSeats ? !tier && table.seatPriceCents == null : table.priceCents == null;

  const tierField = (
    <>
      <SelectField
        label="Ticket type" value={table.tierId || ''}
        onChange={(v) => {
          if (v === NEW_TIER) { setCreatingTier(true); return; }
          set({ tierId: v || null });
        }}
        options={[['', 'None'], ...(tiers || []).map((t) => [t.id, t.name]), [NEW_TIER, '+ New ticket type…']]}
        hint={sellsSeats ? 'What each seat sells as, and for.' : 'Shown on each guest’s ticket.'}
      />
      {creatingTier && (
        <NewTierInline
          onCreated={(created) => { onTierCreated?.(created); set({ tierId: created.id }); setCreatingTier(false); }}
          onCancel={() => setCreatingTier(false)}
        />
      )}
    </>
  );

  const wholeTable = (
    // BRD §25 — a table's price is INDEPENDENT, not the sum of its seats.
    <PriceField
      tableKey={key}
      priceCents={table.priceCents}
      onCommit={(cents) => set({ priceCents: cents })}
      label="Whole-table price"
      hint={sellsSeats ? 'What booking the whole table costs. Empty: sold seat by seat only.' : 'What a buyer pays for the whole table.'}
    />
  );

  return (
    <Inspector
      label="Table"
      icon={<ShapeArt shape={table.shape} size={26} />}
      title={table.label || 'Untitled table'}
      meta={`${SHAPE_NAMES[table.shape] || 'Table'} · ${table.seatCount} seat${table.seatCount === 1 ? '' : 's'}${sold ? ` · ${sold} sold or held` : ''}`}
      status={sold > 0 ? (
        <InspectorNote tone="warning">{sold} of these seats {sold === 1 ? 'is' : 'are'} sold or held. They can’t be removed, and the table can’t be deleted.</InspectorNote>
      ) : null}
      actions={(
        <>
          <InspectorAction icon="rotate" onClick={() => onRotate?.(90)} disabled={!onRotate} title={`Turn 90° (now ${Math.round(table.position?.rotation || 0)}°)`}>Rotate</InspectorAction>
          {/* A copy is a new table with a new name, never private and with
              nothing sold — said in the title so the omissions are not bugs. */}
          <InspectorAction icon="copy" onClick={onDuplicate} disabled={!onDuplicate} title="Adds a copy beside this one — new name, not private, nothing sold">Duplicate</InspectorAction>
          <InspectorAction icon="trash" tone="danger" onClick={() => onRemove(key)}>Delete</InspectorAction>
        </>
      )}
    >
      <InspectorSection id="table-basics" title="Table" summary={`${table.seatCount} seats`}>
        <TextField
          label="Name" value={table.label} maxLength={40}
          hint="Unique on this map. Buyers see it on their ticket."
          onChange={(label) => set({ label })}
        />
        <SeatCountField table={table} onChange={set} sold={sold} />
        <ShapePicker table={table} onChange={set} />
        <SeatsPerSide table={table} onChange={set} sold={sold} />
      </InspectorSection>

      <InspectorSection id="table-price" title="Tickets & price" summary={priceSummary}>
        {unpriced && (
          <InspectorNote tone="warning">
            {sellsSeats ? 'These seats aren’t on sale yet — choose a ticket type.' : 'Not on sale yet — set a whole-table price.'}
          </InspectorNote>
        )}
        {!sellsSeats && wholeTable}
        {tierField}
        {/* The ticket type is the one choice most tables need. The rest —
            an override price, an optional whole-table price, a colour
            category — wait behind one fold, open by itself when any of them
            is already set (2026-11-21). */}
        <button
          type="button" className="es-insp__sub" aria-expanded={morePricing}
          onClick={() => setMorePricing((v) => !v)}
        >
          <span>More pricing options</span>
          {hasExtras && <span className="es-insp__subtag">Set</span>}
          <NavIcon name="chevronDown" size={15} className="es-insp__subchev" />
        </button>
        {morePricing && (
          <div className="es-insp__subbody">
            {sellsSeats && (
              // The per-seat override (S-04). Empty means the ticket type's price.
              <PriceField
                tableKey={`${key}:seat`}
                priceCents={table.seatPriceCents}
                onCommit={(cents) => set({ seatPriceCents: cents })}
                label="Seat price"
                optional
                hint={tier ? `Empty uses ${tier.name}’s price.` : 'Overrides the ticket type for every seat here.'}
              />
            )}
            {sellsSeats && sellsTables && wholeTable}
            <SelectField
              label="Category" value={table.categoryId || ''}
              onChange={(v) => set({ categoryId: v || null })}
              options={[['', 'None'], ...(categories || []).map((c) => [c.id, c.name])]}
              hint="A colour on the map. It doesn’t change the price."
            />
          </div>
        )}
      </InspectorSection>

      <AvailabilitySection table={table} stock={stock} onSetUnavailable={onSetUnavailable} />

      <InspectorSection id="table-access" title="Private access" summary={table.isPrivate ? 'Private' : 'Public'} defaultOpen={false} forceOpen={!!table.isPrivate}>
        <Toggle
          label="Private table"
          hint="Everyone sees it on the map, marked Private. Only guests with the password can book it."
          checked={!!table.isPrivate}
          onChange={(on) => set({
            isPrivate: on,
            // Unticking must actually clear the password, not just hide the
            // field — the API reads `isPrivate: false` as the explicit
            // instruction to remove protection.
            ...(on ? {} : { password: '' }),
          })}
        />
        {table.isPrivate && (
          <TextField
            label={table.hasPassword ? 'New password' : 'Password'}
            type="password"
            value={table.password || ''}
            maxLength={64}
            autoComplete="off"
            hint={table.hasPassword ? 'Leave empty to keep the current one.' : 'Required before the map can be saved.'}
            onChange={(password) => set({ password })}
          />
        )}
        {table.isPrivate && <InviteLink table={table} />}
      </InspectorSection>

      <InspectorSection id="table-look" title="Appearance" summary={appearanceSummary(table)} defaultOpen={false}>
        <TableAppearance table={table} onChange={set} />
      </InspectorSection>
    </Inspector>
  );
}

/**
 * AVAILABILITY (owner, 2026-11-24): "mark an entire table as Unavailable when
 * the organizer has sold or reserved it outside Eventsli". One switch; the
 * seats it blocks are saved with the map (useStudioDraft.setTablesUnavailable).
 */
function AvailabilitySection({ table, stock, onSetUnavailable }) {
  const state = tableAvailability(table, stock);
  const summary = { unsaved: 'Save first', unavailable: 'Unavailable', partly: 'Some blocked', sold: 'Sold', available: 'On sale' }[state];
  return (
    <InspectorSection
      id="table-availability" title="Availability" summary={summary}
      defaultOpen={false} forceOpen={state === 'unavailable' || state === 'partly'}
    >
      {state === 'unsaved' ? (
        <InspectorNote>Save the map first: a new table has no seats to mark yet.</InspectorNote>
      ) : (
        <>
          <Toggle
            label="Unavailable"
            hint="Sold or reserved outside Eventsli. Buyers see the table, faded, and can’t book it or any seat at it."
            checked={state === 'unavailable'}
            disabled={!onSetUnavailable || state === 'sold'}
            onChange={(on) => onSetUnavailable?.(on)}
          />
          {state === 'partly' && (
            <InspectorNote>
              {stock.blocked} of {stock.total} seats are blocked. Switch on to block the other {stock.open} too.
            </InspectorNote>
          )}
          {stock?.booked > 0 && state !== 'sold' && (
            <InspectorNote>
              {stock.booked} {stock.booked === 1 ? 'seat is' : 'seats are'} already a buyer’s and stay theirs.
            </InspectorNote>
          )}
          {state === 'sold' && <InspectorNote>Every seat here is sold or held on Eventsli.</InspectorNote>}
          <p className="es-field__hint">Applied when you save the map.</p>
        </>
      )}
    </InspectorSection>
  );
}

/**
 * Where a table stands, from its seats after pending changes:
 * 'unsaved' (no seat rows yet), 'sold' (every seat a buyer's), 'unavailable'
 * (nothing open, at least one blocked), 'partly' (some blocked, some open) or
 * 'available'.
 */
export function tableAvailability(table, stock) {
  if (!table?.id || !stock || stock.total === 0) return 'unsaved';
  if (stock.open === 0 && stock.blocked === 0) return 'sold';
  if (stock.open === 0) return 'unavailable';
  if (stock.blocked > 0) return 'partly';
  return 'available';
}

/**
 * Seats, as a number. Clamped to the database's own CHECK (1–60), so the field
 * cannot hold a value the save would be refused for; a typed count goes back
 * to the shape's own spread, since seats per side that no longer add up would
 * be ignored anyway.
 */
function SeatCountField({ table, onChange, sold }) {
  return (
    <NumberField
      // Applied when the number is finished (blur or Enter): typed over
      // live, "12" went through a 1-seat table and lost its seats per side.
      live={false}
      label="Seats" min={Math.max(1, sold)} max={MAX_SEATS_PER_TABLE}
      value={table.seatCount}
      hint={sold ? `Can’t go below ${sold}: those seats are sold or held.` : 'Fewer seats removes the highest-numbered ones.'}
      onChange={(n) => {
        const { sides, ...rest } = table.style || {};
        onChange({
          seatCount: n,
          ...(sides ? { style: Object.keys(rest).length ? rest : null } : {}),
        });
      }}
    />
  );
}

/**
 * A price, typed as money.
 *
 * It keeps the organizer's own text as a draft, commits whenever that text is
 * a valid amount, and says so when it is not — so "25." is not refused and
 * 25.50 can be typed. The draft is re-seeded only when a DIFFERENT value
 * arrives (another table selected, or an undo), never by its own commits.
 */
function PriceField({ tableKey, priceCents, onCommit, label, hint, optional = false }) {
  const currency = useEventContext()?.event?.currency;
  const external = centsToInput(priceCents, currency);
  const signature = `${tableKey}:${priceCents ?? ''}`;

  const [draft, setDraft] = useState(external);
  const [draftFor, setDraftFor] = useState(signature);
  if (signature !== draftFor) {
    setDraftFor(signature);
    if (toCents(draft, currency) !== (priceCents ?? null) || (draft === '') !== (priceCents === null || priceCents === undefined)) {
      setDraft(external);
    }
  }

  const invalid = draft.trim() !== '' && toCents(draft, currency) === null;
  const id = `price-${tableKey.replace(/\W+/g, '-')}`;

  return (
    <Field
      label={label} id={id} hint={hint}
      error={invalid ? 'Enter an amount in this currency, like 25.' : null}
      aside={<span className="es-field__muted">{optional ? 'Optional · ' : ''}{currency || ''}</span>}
    >
      <input
        id={id} className="es-input es-input--dense" value={draft} inputMode="decimal" aria-invalid={invalid || undefined}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (text.trim() === '') { onCommit(null); return; }
          const cents = toCents(text, currency);
          if (cents !== null) onCommit(cents);
        }}
      />
    </Field>
  );
}

/**
 * The private table's invitation link: the seat page with `?table=<id>`,
 * which opens the password prompt for exactly this table (SeatPicker,
 * useTableAccess). A table gets its id when the map is saved.
 */
function InviteLink({ table }) {
  const slug = useEventContext()?.event?.slug;
  const [copied, setCopied] = useState(false);
  if (!table.id || !slug) {
    return <InspectorNote>Save the map and this table’s invitation link appears here.</InspectorNote>;
  }
  const path = `/e/${slug}/seats?table=${encodeURIComponent(table.id)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked: the link is on screen to copy by hand */ }
  };
  return (
    <div className="es-field">
      <span className="es-field__label">Invitation link</span>
      <div className="fx-row items-center gap-2">
        <code className="fx-min0 fx-break flex-1 rounded-(--es-radius-md) bg-bg-sunken px-2 py-1.5 text-xs">{path}</code>
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <p className="es-field__hint">Send it with the password. It works once the map is saved{table.hasPassword ? '' : ' with a password'}.</p>
    </div>
  );
}
