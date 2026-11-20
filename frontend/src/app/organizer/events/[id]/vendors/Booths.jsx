'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { centsToInput, moneyPlaceholder, parseMoneyToCents } from '../../../../lib/moneyInput';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { Panel } from '../../../../components/ui/Page';
import Field, { TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { BOOTH_COLORS } from '../../../../components/vendors/floorPlan/floorPlanModel';

/**
 * Booth types (2026-11-20): the spaces vendors are offered. An offer copies
 * the price, passes and inclusions, so a type can be repriced at any time; it
 * cannot offer fewer spaces than are already booked. A type with offers is
 * taken off sale rather than deleted.
 */
export default function Booths({ eventId, currency, state, onChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null);
  if (state.error) return <ErrorNotice error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading variant="card" label="Loading booth types" />;
  const list = state.data;

  async function toggle(b) {
    try {
      await patch(`/events/${eventId}/vendors/booths/${b.id}`, { isActive: !b.isActive }, { noRedirect: true });
      toast.success(b.isActive ? `“${b.name}” is off sale.` : `“${b.name}” is on sale.`);
      onChange();
    } catch (err) { toast.error(messageFor(err), { title: describeError(err).title }); }
  }
  async function remove(b) {
    const ok = await confirm({
      title: `Remove “${b.name}”?`, tone: 'danger', confirmLabel: 'Remove booth type',
      body: <p>{b.taken + b.offered > 0 ? 'Vendors have offers or bookings for it, so it is taken off sale. Their bookings are not affected.' : 'It is deleted.'}</p>,
    });
    if (!ok) return;
    try {
      const r = await del(`/events/${eventId}/vendors/booths/${b.id}`, { noRedirect: true });
      toast.success(r?.removed ? `“${b.name}” was removed.` : `“${b.name}” is off sale.`);
      onChange();
    } catch (err) { toast.error(messageFor(err), { title: describeError(err).title }); }
  }

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between gap-2">
        <p className="text-sm text-muted">The spaces you offer vendors. Public ones are listed on your vendor page.</p>
        {!editing && <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing('new')}><NavIcon name="plus" size={18} />Add a booth type</button>}
      </div>
      {editing && (
        <BoothForm key={editing === 'new' ? 'new' : editing.id} eventId={eventId} currency={currency} booth={editing === 'new' ? null : editing}
          onDone={(m) => { setEditing(null); toast.success(m); onChange(); }} onCancel={() => setEditing(null)} />
      )}
      {list.length === 0 && !editing ? (
        <div className="es-sp-empty">
          <NavIcon name="grid" size={36} />
          <p className="es-sp-empty__title">No booth types yet</p>
          <p className="text-sm text-muted">For example: “10×10 stall” at 150, “Food truck pitch” at 300 with power, “Artist table” free.</p>
        </div>
      ) : (
        <ul className="es-sp-packages">
          {list.map((b) => (
            <li key={b.id} className={`es-sp-package ${b.isActive ? '' : 'is-off'}`}>
              <div className="es-sp-package__head">
                <span className="es-fp__swatch" style={{ background: b.color || BOOTH_COLORS[list.indexOf(b) % BOOTH_COLORS.length] }} aria-hidden="true" />
                {b.sizeLabel && <span className="es-pill">{b.sizeLabel}</span>}
                {!b.isActive && <span className="es-pill">Off sale</span>}
                {!b.isPublic && <span className="es-pill">Private</span>}
              </div>
              <p className="es-sp-package__name fx-break">{b.name}</p>
              <p className="es-sp-package__price es-nums">{b.priceCents === 0 ? 'Free' : formatMoney(b.priceCents, currency)}</p>
              {b.description && <p className="text-sm text-muted fx-break">{b.description}</p>}
              <ul className="es-sp-benefits">
                <li><NavIcon name="users" size={16} />{b.staffPasses} staff {b.staffPasses === 1 ? 'pass' : 'passes'}</li>
                {b.includes.map((x) => <li key={x}><NavIcon name="check" size={16} />{x}</li>)}
              </ul>
              <p className="es-sp-package__stock text-sm">
                {b.quantity === null ? `${b.taken} booked · no limit` : `${b.taken} of ${b.quantity} booked`}
                {b.offered > 0 && ` · ${b.offered} offered`}
              </p>
              <div className="fx-row gap-1 mt-auto">
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(b)}>Edit</button>
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle(b)}>{b.isActive ? 'Pause' : 'Resume'}</button>
                {b.isActive && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => remove(b)}>Remove</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BoothForm({ eventId, currency, booth, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: booth?.name || '',
    sizeLabel: booth?.sizeLabel || '',
    price: booth ? centsToInput(booth.priceCents, currency) : '',
    quantity: booth?.quantity === null || booth?.quantity === undefined ? '' : String(booth.quantity),
    staffPasses: String(booth?.staffPasses ?? 2),
    description: booth?.description || '',
    includes: (booth?.includes || []).join('\n'),
    isPublic: booth ? booth.isPublic : true,
    color: booth?.color || '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cents = form.price === '' ? null : parseMoneyToCents(form.price, currency);
  const priceInvalid = form.price !== '' && cents === null;
  const quantity = form.quantity === '' ? null : Number(form.quantity);
  const taken = booth?.taken || 0;
  const belowTaken = quantity !== null && quantity < Math.max(taken, 1);

  async function submit(e) {
    e.preventDefault();
    if (priceInvalid || belowTaken || cents === null) return;
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(), sizeLabel: form.sizeLabel.trim() || null, priceCents: cents, quantity,
      staffPasses: Number(form.staffPasses) || 0, description: form.description.trim() || null,
      includes: form.includes.split('\n').map((x) => x.trim()).filter(Boolean), isPublic: form.isPublic,
      color: form.color || null,
    };
    try {
      if (booth) await patch(`/events/${eventId}/vendors/booths/${booth.id}`, body, { noRedirect: true });
      else await post(`/events/${eventId}/vendors/booths`, body, { noRedirect: true });
      onDone(booth ? `“${body.name}” was updated.` : `“${body.name}” was added.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title={booth ? `Edit “${booth.name}”` : 'New booth type'}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Name" name="bt-name" required maxLength={80} autoFocus value={form.name} onChange={set('name')} hint="e.g. 10×10 stall, Food truck pitch." />
          <Field label="Size" name="bt-size" optional maxLength={40} value={form.sizeLabel} onChange={set('sizeLabel')} placeholder="3 × 3 m" />
          <Field label={`Booth fee (${currency})`} name="bt-price" inputMode="decimal" required placeholder={moneyPlaceholder(currency)}
            value={form.price} onChange={set('price')} error={priceInvalid ? 'Enter an amount, e.g. 150.' : null} hint="0 for a free space." />
          <Field label="How many" name="bt-qty" type="number" min={Math.max(taken, 1)} optional value={form.quantity} onChange={set('quantity')}
            error={belowTaken ? `${taken} already booked, so it cannot go lower.` : null} hint="Leave empty for no limit." />
          <Field label="Staff passes" name="bt-passes" type="number" min={0} max={50} required value={form.staffPasses} onChange={set('staffPasses')}
            hint="People the vendor can name for the door list." />
        </div>
        <TextareaField label="Description" name="bt-desc" optional rows={2} maxLength={600} value={form.description} onChange={set('description')} />
        <TextareaField label="What is included" name="bt-includes" optional rows={4} value={form.includes} onChange={set('includes')}
          hint="One per line, e.g. Table and 2 chairs · Power (1 socket) · Water access." />
        <div className="fx-stack gap-1">
          <span className="es-label"><span>Colour on the floor plan</span></span>
          <span className="es-fpe__colors">
            {BOOTH_COLORS.map((c) => (
              <button key={c} type="button" className="es-fpe__color" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={form.color === c}
                onClick={() => setForm((f) => ({ ...f, color: c }))} />
            ))}
          </span>
          <span className="text-xs text-subtle">Free booths of this type are drawn in it, as DB1 and DB2 in blue.</span>
        </div>
        <label className="fx-row items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))} />
          Show on my public vendor page
        </label>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} disabled={priceInvalid || belowTaken}>{booth ? 'Save booth type' : 'Add booth type'}</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
