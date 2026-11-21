'use client';

import { useId, useState } from 'react';
import { countUnpriced } from './MapChrome';
import { keyOf } from './useMapDraft';
import { toCents } from '../tiers/Tiers';
import { centsToInput } from '../../../../lib/moneyInput';
import { useEventContext } from '../EventContext';
import NavIcon from '../../../../components/shell/NavIcon';
import NewTierInline, { NEW_TIER } from './NewTierInline';
import { TABLE_SCALE, tableScale } from '../../../../components/seating/seatingGeometry';
import { Inspector, InspectorSection, InspectorAction, InspectorNote } from '../../../../components/inspector/Inspector';
import { Field, RangeField, SelectField } from '../../../../components/inspector/fields';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The inspector when SEVERAL things are selected.
 *
 * Every operation that applies to a selection has a control HERE, where the
 * selection is what you are looking at: a marquee leaves no single element
 * selected, and bulk rotate and delete were once wired, tested and still
 * unreachable because nothing on screen triggered them.
 *
 * THE PICKERS SHOW WHAT THE SELECTION IS (2026-11-21). They used to be
 * "Assign to ticket type…" lists that snapped back to their placeholder after
 * every choice, so the panel never said what the tables were set to and a
 * screen reader announced a change that then vanished. Now each one reads the
 * selection: one shared value is shown as chosen, different values as
 * "Mixed", and choosing sets every selected table as one undo step.
 *
 * WHY DELETE IS NOT CONFIRMED. Removing a table from the draft is not removing
 * it from the event: the save is a full replace and the API refuses to drop a
 * table with sold or held seats. Until Save, Ctrl+Z is the undo.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MIXED = '__mixed__';

/** The one value every table shares, MIXED when they differ, '' for none. */
function shared(tables, read) {
  if (tables.length === 0) return '';
  const first = read(tables[0]) || '';
  return tables.every((t) => (read(t) || '') === first) ? first : MIXED;
}

export default function SelectionPanel({
  tables = [], zoneCount = 0, onRotate, onDuplicate, onRemove, onClear, tiers = [], onAssign = null, onTierCreated = null,
  categories = [], onAssignCategory = null, onResize = null, purchaseMode = 'seat_only', onAssignTablePrice = null,
}) {
  const tableCount = tables.length;
  const total = tableCount + zoneCount;
  const [creatingTier, setCreatingTier] = useState(false);
  const sizes = tables.map((t) => tableScale(t.style));
  // The slider shows the selection's size when they all share one, else 100%.
  const sharedSize = sizes.length && sizes.every((s) => s === sizes[0]) ? sizes[0] : 1;
  const tierValue = shared(tables, (t) => t.tierId);
  const categoryValue = shared(tables, (t) => t.categoryId);
  const seats = tables.reduce((n, t) => n + (Number(t.seatCount) || 0), 0);
  const unpriced = countUnpriced(tables, purchaseMode);

  return (
    <Inspector
      label="Selection"
      icon={<NavIcon name="multi" size={22} />}
      title={`${total} selected`}
      meta={[describe(tableCount, zoneCount), seats ? `${seats.toLocaleString('en')} seats` : null].filter(Boolean).join(' · ')}
      actions={(
        <>
          <InspectorAction icon="rotate" onClick={() => onRotate(90)} title="Turns each one 90° about its own centre">Rotate</InspectorAction>
          <InspectorAction icon="copy" onClick={onDuplicate}>Duplicate</InspectorAction>
          <InspectorAction icon="trash" tone="danger" onClick={onRemove} label={`Delete ${total} selected`}>Delete</InspectorAction>
          <InspectorAction icon="close" onClick={onClear} label="Deselect all">Deselect</InspectorAction>
        </>
      )}
    >
      {tableCount > 0 && (onAssign || onAssignCategory) && (
        <InspectorSection id="sel-price" title="Tickets & price" summary={unpriced ? `${unpriced} not priced` : 'All priced'}>
          {unpriced > 0 && (
            <InspectorNote tone="warning">
              {unpriced} of {tableCount} {purchaseMode === 'table_only' ? 'have no whole-table price yet.' : 'have no ticket type yet.'}
            </InspectorNote>
          )}
          {onAssignTablePrice && purchaseMode !== 'seat_only' && (
            <BulkTablePrice key={tables.map(keyOf).join(',')} tables={tables} onApply={onAssignTablePrice} />
          )}
          {onAssign && (
            <SelectField
              label={`Ticket type for ${tableCount === 1 ? 'this table' : `all ${tableCount} tables`}`}
              value={tierValue}
              onChange={(v) => {
                if (v === NEW_TIER) setCreatingTier(true);
                else if (v !== MIXED) onAssign(v || null);
              }}
              options={[
                ...(tierValue === MIXED ? [[MIXED, 'Mixed — choose one for all']] : []),
                ['', 'None'],
                ...tiers.map((t) => [t.id, t.name]),
                [NEW_TIER, '+ New ticket type…'],
              ]}
            />
          )}
          {onAssign && creatingTier && (
            <NewTierInline
              onCreated={(tier) => { onTierCreated?.(tier); onAssign(tier.id); setCreatingTier(false); }}
              onCancel={() => setCreatingTier(false)}
            />
          )}
          {onAssignCategory && (
            <SelectField
              label="Category"
              value={categories.length ? categoryValue : ''}
              disabled={categories.length === 0}
              onChange={(v) => { if (v !== MIXED) onAssignCategory(v || null); }}
              options={categories.length
                ? [...(categoryValue === MIXED ? [[MIXED, 'Mixed — choose one for all']] : []), ['', 'None'], ...categories.map((c) => [c.id, c.name])]
                : [['', 'No categories yet']]}
              hint={categories.length === 0 ? 'Create categories on the event’s Tables page.' : null}
            />
          )}
        </InspectorSection>
      )}

      {tableCount > 0 && onResize && (
        <InspectorSection id="sel-look" title="Appearance" summary={`${Math.round(sharedSize * 100)}%`}>
          <RangeField
            label="Table size" min={TABLE_SCALE.min * 100} max={TABLE_SCALE.max * 100} step={5}
            value={Math.round(sharedSize * 100)}
            format={(v) => `${v}%`}
            hint="Resizes them together. Smaller tables fit more in the room."
            onChange={(v) => onResize(v / 100)}
          />
        </InspectorSection>
      )}

      <InspectorNote>
        Drag any one to move the group. Ctrl-click (or Pick several) adds or removes one. Nothing leaves the event until you save — Ctrl+Z undoes.
      </InspectorNote>
    </Inspector>
  );
}

/**
 * One whole-table price for the lot, typed then applied — never committed per
 * keystroke, since "4" on the way to "450" would price forty tables at 4.
 * Shows the shared price when they have one.
 */
function BulkTablePrice({ tables, onApply }) {
  const currency = useEventContext()?.event?.currency;
  const first = tables[0]?.priceCents ?? null;
  const same = tables.every((t) => (t.priceCents ?? null) === first);
  const [text, setText] = useState(same && first != null ? centsToInput(first, currency) : '');
  const cents = text.trim() === '' ? null : toCents(text, currency);
  const invalid = text.trim() !== '' && cents === null;
  const id = useId();
  // Empty over different prices means "nothing typed yet", not "clear them
  // all": Apply waits for an amount. Empty over ONE shared price is a
  // deliberate clear.
  const blank = text.trim() === '';
  const canApply = !invalid && !(blank && !same) && !(blank && first === null);
  const apply = () => { if (canApply) onApply(cents); };
  return (
    <Field
      label={`Whole-table price for all ${tables.length}`} id={id}
      hint={same ? null : 'They have different prices now.'}
      error={invalid ? 'Enter an amount in this currency, like 450.' : null}
      aside={<span className="es-field__muted">{currency || ''}</span>}
    >
      <span className="fx-row items-center gap-2">
        <input
          id={id} className="es-input es-input--dense fx-min0 flex-1" inputMode="decimal" value={text}
          placeholder={same ? '' : 'Mixed'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
        />
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={!canApply} onClick={apply}>{blank && same && first !== null ? 'Clear' : 'Apply'}</button>
      </span>
    </Field>
  );
}

/** "3 tables and 2 areas", with the plurals right and the empty halves left out. */
function describe(tables, zones) {
  const parts = [];
  if (tables > 0) parts.push(`${tables} ${tables === 1 ? 'table' : 'tables'}`);
  if (zones > 0) parts.push(`${zones} ${zones === 1 ? 'area' : 'areas'}`);
  return parts.join(' and ');
}
