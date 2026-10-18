'use client';

import { useId } from 'react';
import NavIcon from '../../../../components/shell/NavIcon';
import { RadioCards } from '../WizardParts';
import { ADMISSION_TYPES, PURCHASE_MODES } from '../wizardModel';
import { TIER_KINDS, newTier, priceToCents } from './aiDraftModel';

/**
 * Ticket types, as the AI suggested them and as the organizer fixes them.
 *
 * A PRICE IS NEVER INVENTED (D-006) AND NEVER SKIPPED (D-018). A suggested
 * type the description gave no price for arrives with an empty price box. To
 * save, the organizer enters one, switches on "This ticket is free", or
 * removes the type — the save is blocked until one of the three happens,
 * because the API cannot create a ticket type without a price and silently
 * dropping it would lose something the organizer can see on screen.
 *
 * Where a price came from is shown as the organizer's own words under it.
 */
function TierRow({ tier, index, total, admissionType, currency, update, remove, move, errorFor }) {
  const id = useId();
  const priceError = errorFor(`tier-${tier.key}-price`);
  const nameError = errorFor(`tier-${tier.key}-name`);
  const qtyError = errorFor(`tier-${tier.key}-quantity`);
  const needs = Boolean(priceError);

  return (
    <li className={`es-ai-tierform${needs ? ' is-need' : ''}`}>
      <div className="es-ai-tierform__row">
        <div className="fx-stack gap-1">
          <label htmlFor={`${id}-name`} className="sr-only">Ticket type name</label>
          <input
            id={`${id}-name`} className="es-input" value={tier.name} maxLength={80} placeholder="Name, e.g. General"
            aria-invalid={nameError ? 'true' : undefined} onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className={`es-ai-money${needs ? ' is-need' : ''}`}>
          <span aria-hidden="true">$</span>
          <label htmlFor={`${id}-price`} className="sr-only">Price for {tier.name || 'this ticket type'}, {currency}</label>
          <input
            id={`${id}-price`} className="es-ai-money__input es-nums" inputMode="decimal" placeholder="Price"
            value={tier.free ? '0.00' : tier.price} disabled={tier.free}
            aria-invalid={needs ? 'true' : undefined} aria-describedby={`${id}-price-note`}
            onChange={(e) => update({ price: e.target.value })}
          />
          <span className="es-ai-money__cur">{currency}</span>
        </div>
      </div>

      <p id={`${id}-price-note`} className={`es-ai-src${needs ? ' es-ai-src--need' : ''}`}>
        {needs
          ? <><NavIcon name="alert" size={13} /> {tier.priceEvidence || priceToCents(tier.price) !== null ? priceError : 'Your description has no price for this one. Enter one, mark it free, or remove it.'}</>
          : tier.priceEvidence
            ? <><NavIcon name="list" size={13} /> You wrote: &ldquo;{tier.priceEvidence}&rdquo;</>
            : tier.free ? 'Free ticket' : 'Price set by you'}
      </p>

      <div className="es-ai-tierform__more">
        <label className="es-ai-field">
          <span className="text-xs text-subtle">Type</span>
          <select className="es-input es-input--sm" value={tier.kind} onChange={(e) => update({ kind: e.target.value })}>
            {TIER_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {admissionType === 'general' && (
          <label className="es-ai-field">
            <span className="text-xs text-subtle">How many</span>
            <input
              className="es-input es-input--sm es-nums" inputMode="numeric" value={tier.quantity} placeholder="No limit"
              aria-invalid={qtyError ? 'true' : undefined} onChange={(e) => update({ quantity: e.target.value })}
            />
          </label>
        )}
        <label className="es-ai-field es-ai-field--wide">
          <span className="text-xs text-subtle">What it includes (optional)</span>
          <input
            className="es-input es-input--sm" value={tier.description} maxLength={500}
            placeholder="e.g. Reserved seat and dinner" onChange={(e) => update({ description: e.target.value })}
          />
        </label>
      </div>
      {(nameError || qtyError) && <p className="text-xs text-danger">{nameError || qtyError}</p>}

      <div className="es-ai-tierform__opts">
        <label className="es-ai-toggle">
          <input type="checkbox" checked={tier.free} onChange={(e) => update({ free: e.target.checked, ...(e.target.checked ? {} : { price: '' }) })} />
          <span className="es-ai-toggle__track" aria-hidden="true" />
          This ticket is free
        </label>
        <span className="es-ai-tierform__tools">
          <button type="button" className="es-ai-iconbtn es-ai-iconbtn--sm" onClick={() => move(-1)} disabled={index === 0} aria-label={`Move ${tier.name || 'ticket type'} up`}><NavIcon name="chevronUp" size={16} /></button>
          <button type="button" className="es-ai-iconbtn es-ai-iconbtn--sm" onClick={() => move(1)} disabled={index === total - 1} aria-label={`Move ${tier.name || 'ticket type'} down`}><NavIcon name="chevronDown" size={16} /></button>
          <button type="button" className="es-ai-link es-ai-link--muted" onClick={remove} aria-label={`Remove ${tier.name || 'this ticket type'}`}>Remove</button>
        </span>
      </div>
    </li>
  );
}

export default function EditTickets({ form, set, errorFor }) {
  const tiers = form.tiers;
  const update = (k) => (patch) => set({ tiers: tiers.map((t) => (t.key === k ? { ...t, ...patch } : t)) });
  const remove = (k) => () => set({ tiers: tiers.filter((t) => t.key !== k) });
  const move = (i) => (delta) => {
    const next = [...tiers];
    const [row] = next.splice(i, 1);
    next.splice(i + delta, 0, row);
    set({ tiers: next });
  };

  return (
    <div className="fx-stack fx-stack--sm">
      <RadioCards
        legend="How do tickets work?" name="ai-admissionType" required columns={2}
        value={form.admissionType} onChange={(e) => set({ admissionType: e.target.value })}
        options={ADMISSION_TYPES.map(([value, title, desc, icon]) => ({ value, title, desc, icon }))}
      />
      {form.admissionType === 'reserved' && (
        <RadioCards
          legend="How do buyers choose their place?" name="ai-purchaseMode" required columns={3}
          value={form.purchaseMode} onChange={(e) => set({ purchaseMode: e.target.value })}
          options={PURCHASE_MODES.map(([value, title, desc, icon]) => ({ value, title, desc, icon }))}
        />
      )}

      <ul className="es-ai-tierlist" aria-label="Ticket types">
        {tiers.map((t, i) => (
          <TierRow
            key={t.key} tier={t} index={i} total={tiers.length} admissionType={form.admissionType}
            currency={form.currency} update={update(t.key)} remove={remove(t.key)} move={move(i)} errorFor={errorFor}
          />
        ))}
      </ul>
      <button type="button" className="es-ai-add" onClick={() => set({ tiers: [...tiers, newTier()] })} disabled={tiers.length >= 20}>
        <NavIcon name="plus" size={16} /> Add a ticket type
      </button>
      <p className="fx-row items-start text-sm text-muted">
        <span className="text-accent"><NavIcon name="info" size={18} /></span>
        <span className="fx-min0 flex-1">
          {form.admissionType === 'reserved'
            ? 'How many of each comes from the seating map, which you draw after saving.'
            : 'Leave “How many” empty for no limit.'}
        </span>
      </p>
    </div>
  );
}
