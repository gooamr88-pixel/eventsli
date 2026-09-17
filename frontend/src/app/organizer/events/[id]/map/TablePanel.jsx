'use client';

import { useState } from 'react';
import { SHAPES } from '../../../../components/seating/seatingGeometry';
import { SHAPE_NAMES } from './shapeNames';
import { MAX_SEATS_PER_TABLE, keyOf } from './useMapDraft';
import { toCents } from '../tiers/Tiers';
import Field from '../../../../components/forms/Field';
import { Notice } from '../../../../components/Feedback';
import { useEventContext } from '../EventContext';

/**
 * Everything about one table.
 *
 * Two properties here have consequences a form cannot undo, and both say so:
 *
 * SHRINKING the seat count deletes the seats above the new number, and the API
 * refuses if any of them are booked. Growing is always safe.
 *
 * A PRIVATE table disappears from the buyer's map entirely — not shown with a
 * lock, omitted. Its guests reach it through an invitation link carrying the
 * table id, and the password gates the purchase as well as the view. An
 * organizer who makes a table private without sending that link has made it
 * unreachable, which is worth saying out loud.
 */
export default function TablePanel({
  table, tiers, categories, onChange, onRotate, onDuplicate, onRemove,
}) {
  if (!table) {
    return (
      <aside className="fx-stack fx-stack--sm es-card p-5">
        <p className="text-sm text-muted">Select a table or a zone on the map to edit it.</p>
        <p className="text-xs text-subtle">
          Use Add element, or double-click anywhere on the floor to drop a table. Drag the
          floor to box-select several at once; arrow keys move whatever is selected.
        </p>
      </aside>
    );
  }

  const key = keyOf(table);
  const set = (patch) => onChange(key, patch);

  return (
    <aside className="fx-stack fx-stack--sm es-card p-5">
      <div className="fx-row fx-row--between">
        <h3 className="text-lg">Table {table.label}</h3>
        <button
          type="button"
          onClick={() => onRemove(key)}
          className="es-btn es-btn--ghost es-btn--sm"
        >
          Remove
        </button>
      </div>

      <Field
        label="Name" value={table.label} maxLength={40}
        hint="Unique across the map — buyers see it on their ticket."
        onChange={(e) => set({ label: e.target.value })}
      />

      <Select
        label="Shape" value={table.shape}
        onChange={(v) => set({ shape: v })}
        options={SHAPES.map((s) => [s, SHAPE_NAMES[s] || s])}
        hint={table.shape === 'row' ? 'A straight bank of seats with no table.' : undefined}
      />

      <Field
        label="Seats" type="number" min={1} max={MAX_SEATS_PER_TABLE}
        value={table.seatCount}
        hint="Reducing this removes the highest-numbered seats. Booked ones cannot be removed."
        onChange={(e) => {
          const n = Number(e.target.value);
          // Clamped to the database's own CHECK (1–60), so the field cannot
          // hold a value the save would be refused for.
          if (Number.isFinite(n)) {
            set({ seatCount: Math.min(MAX_SEATS_PER_TABLE, Math.max(1, Math.round(n))) });
          }
        }}
      />

      {/* BRD §25 — a table's price is INDEPENDENT, not the sum of its seats.
          Ten $50 seats may sell as a $450 table or a $550 one; the organizer
          decides. Empty means the table cannot be bought whole at all. */}
      <PriceField
        tableKey={key}
        priceCents={table.priceCents}
        onCommit={(cents) => set({ priceCents: cents })}
      />

      <Select
        label="Category" value={table.categoryId || ''}
        onChange={(v) => set({ categoryId: v || null })}
        options={[['', 'None'], ...(categories || []).map((c) => [c.id, c.name])]}
        hint="Colour on the map. It does not affect price."
      />

      <Select
        label="Seat price band" value={table.tierId || ''}
        onChange={(v) => set({ tierId: v || null })}
        options={[['', 'None'], ...(tiers || []).map((t) => [t.id, t.name])]}
        // The trap this prevents: seat price resolves seat override → table →
        // tier and ends in COALESCE(…, 0). A seat with neither sells for
        // nothing.
        hint="What each seat costs. Without one, these seats need their own price or they sell for nothing."
      />

      <label className="fx-row items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!table.isPrivate}
          onChange={(e) => set({
            isPrivate: e.target.checked,
            // Unticking must actually clear the password, not just hide the
            // field — the API reads `isPrivate: false` as the explicit
            // instruction to remove protection.
            ...(e.target.checked ? {} : { password: '' }),
          })}
          className="mt-0.5"
        />
        <span>
          <span className="block text-ink">Private table</span>
          <span className="block text-xs text-subtle">
            Hidden from the map completely. Guests need an invitation link and the
            password — send them both, or nobody can reach it.
          </span>
        </span>
      </label>

      {table.isPrivate && (
        <Field
          label={table.hasPassword ? 'New password' : 'Password'}
          type="password"
          value={table.password || ''}
          maxLength={64}
          autoComplete="off"
          hint={table.hasPassword
            ? 'Leave empty to keep the current one.'
            : 'Required before this table can be saved.'}
          onChange={(e) => set({ password: e.target.value })}
        />
      )}

      {/* THE ROTATE BUTTON IS NOT A DUPLICATE OF THE CANVAS HANDLE.
          The handle is a drag, which a keyboard cannot perform and a trackpad
          performs badly at a zoomed-out scale. This does the same thing in
          exact 90° steps, from a control that is already in the tab order —
          and it is the only rotate a screen-reader user has. */}
      <div className="fx-row flex-wrap gap-2 border-t border-border-base pt-3">
        <button
          type="button"
          onClick={() => onRotate?.(90)}
          disabled={!onRotate}
          className="es-btn es-btn--secondary es-btn--sm"
        >
          Rotate 90°
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={!onDuplicate}
          className="es-btn es-btn--ghost es-btn--sm"
          // Says what it will NOT copy, because the two omissions are
          // deliberate and both would otherwise look like bugs: a copy is a new
          // table with a new name, and it is never private, because a private
          // table with no password of its own is refused on save and would be
          // unreachable by anyone if it were not.
          title="Adds a copy beside this one — new name, no password, nothing sold"
        >
          Duplicate
        </button>
        <span className="fx-row items-center text-xs text-subtle">
          Turned {Math.round(table.position?.rotation || 0)}°
        </span>
      </div>

      {table.status && table.status !== 'available' && (
        <Notice tone="warning" title={`This table is ${table.status}.`}>
          <p>Seats that have sold cannot be removed, and the table cannot be deleted.</p>
        </Notice>
      )}
    </aside>
  );
}

/**
 * The whole-table price, typed as money.
 *
 * The input used to be derived straight from `priceCents`, committing only text
 * that already parsed — so "25." was refused, the field snapped back to "25",
 * and 25.50 could never be typed at all. It now keeps the organizer's own text
 * as a draft, commits whenever that text is a valid amount, and says so when it
 * is not. The draft is re-seeded only when a DIFFERENT value arrives — another
 * table selected, or an undo — never by its own commits.
 */
function PriceField({ tableKey, priceCents, onCommit }) {
  const currency = useEventContext()?.event?.currency;
  const external = priceCents === null || priceCents === undefined ? '' : (priceCents / 100).toString();
  const signature = `${tableKey}:${priceCents ?? ''}`;

  const [draft, setDraft] = useState(external);
  const [draftFor, setDraftFor] = useState(signature);
  if (signature !== draftFor) {
    setDraftFor(signature);
    // Kept when it already means this amount ("25.50" and 2550), so a commit
    // never rewrites what is being typed.
    if (toCents(draft) !== (priceCents ?? null) || (draft === '') !== (priceCents === null || priceCents === undefined)) {
      setDraft(external);
    }
  }

  const invalid = draft.trim() !== '' && toCents(draft) === null;

  return (
    <Field
      label="Whole-table price"
      value={draft}
      inputMode="decimal"
      hint={`In ${currency || 'the event currency'}. Leave empty to sell this table only seat by seat.`}
      error={invalid ? 'Enter an amount like 25 or 25.50.' : null}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text.trim() === '') { onCommit(null); return; }
        const cents = toCents(text);
        if (cents !== null) onCommit(cents);
      }}
    />
  );
}

function Select({ label, value, onChange, options, hint }) {
  const id = `tp-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      <select
        id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="es-input"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}
