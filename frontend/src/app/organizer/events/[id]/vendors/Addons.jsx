'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { centsToInput, moneyPlaceholder, parseMoneyToCents } from '../../../../lib/moneyInput';
import { useApi } from '../../../../hooks/useApi';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { Panel } from '../../../../components/ui/Page';
import Field, { SelectField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';

const KINDS = [['booth', 'Booth add-ons', 'Things for the space: an extra chair, a table cover, a clothes rack, power.'],
  ['marketing', 'Marketing add-ons', 'Promotion: a social media post, a logo in the programme, a flyer in the bags.']];

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Vendor add-ons (owner's reference, 2026-11-21): extras a vendor ticks on
 * the booth page, in two steps — booth add-ons, then marketing add-ons. The
 * price joins the booth fee. Each booking keeps its own copy of what it
 * bought, so an add-on can be repriced, paused or removed at any time without
 * touching bookings already made. You deliver them.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function Addons({ eventId, currency }) {
  const toast = useToast();
  const confirm = useConfirm();
  const state = useApi(`/events/${eventId}/vendors/addons`);
  const [editing, setEditing] = useState(null);
  if (state.error) return <ErrorNotice error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading variant="card" label="Loading add-ons" />;
  const list = state.data;

  async function toggle(a) {
    try {
      await patch(`/events/${eventId}/vendors/addons/${a.id}`, { isActive: !a.isActive }, { noRedirect: true });
      toast.success(a.isActive ? `“${a.name}” is paused.` : `“${a.name}” is offered again.`);
      state.reload();
    } catch (err) { toast.error(messageFor(err), { title: describeError(err).title }); }
  }
  async function remove(a) {
    const ok = await confirm({ title: `Remove “${a.name}”?`, tone: 'danger', confirmLabel: 'Remove add-on',
      body: <p>Vendors who already added it keep it on their booking.</p> });
    if (!ok) return;
    try {
      await del(`/events/${eventId}/vendors/addons/${a.id}`, { noRedirect: true });
      toast.success(`“${a.name}” was removed.`);
      state.reload();
    } catch (err) { toast.error(messageFor(err), { title: describeError(err).title }); }
  }

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between gap-2">
        <p className="text-sm text-muted">Extras vendors add on the booth page. The price joins their booth fee; you provide them.</p>
        {!editing && <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing('new')}><NavIcon name="plus" size={18} />Add an add-on</button>}
      </div>
      {editing && (
        <AddonForm key={editing === 'new' ? 'new' : editing.id} eventId={eventId} currency={currency} addon={editing === 'new' ? null : editing}
          onDone={(m) => { setEditing(null); toast.success(m); state.reload(); }} onCancel={() => setEditing(null)} />
      )}
      {KINDS.map(([kind, title, hint]) => {
        const items = list.filter((a) => a.kind === kind);
        return (
          <Panel key={kind} icon={kind === 'booth' ? 'store' : 'sparkle'} title={title} description={hint}>
            {items.length === 0 ? (
              <p className="text-sm text-muted">None yet.</p>
            ) : (
              <ul className="es-vb-orgaddons es-vb-orgaddons--edit">
                {items.map((a) => (
                  <li key={a.id} className={a.isActive ? '' : 'is-off'}>
                    <span className="fx-min0">
                      <b className="fx-break">{a.name}</b>
                      {!a.isActive && <span className="es-pill ml-2">Paused</span>}
                      {a.description && <span className="block text-xs text-subtle fx-break">{a.description}</span>}
                    </span>
                    <b className="es-nums">{a.priceCents === 0 ? 'Free' : formatMoney(a.priceCents, currency)}</b>
                    <span className="fx-row gap-1">
                      <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(a)}>Edit</button>
                      <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle(a)}>{a.isActive ? 'Pause' : 'Resume'}</button>
                      <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => remove(a)} aria-label={`Remove ${a.name}`}><NavIcon name="trash" size={16} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function AddonForm({ eventId, currency, addon, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: addon?.name || '', kind: addon?.kind || 'booth', description: addon?.description || '',
    price: addon ? centsToInput(addon.priceCents, currency) : '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const cents = form.price === '' ? null : parseMoneyToCents(form.price, currency);
  const bad = form.price !== '' && cents === null;

  async function submit(e) {
    e.preventDefault();
    if (bad || cents === null) return;
    setBusy(true);
    setError(null);
    const body = { name: form.name.trim(), kind: form.kind, description: form.description.trim() || null, priceCents: cents };
    try {
      if (addon) await patch(`/events/${eventId}/vendors/addons/${addon.id}`, body, { noRedirect: true });
      else await post(`/events/${eventId}/vendors/addons`, body, { noRedirect: true });
      onDone(addon ? `“${body.name}” was updated.` : `“${body.name}” was added.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title={addon ? `Edit “${addon.name}”` : 'New add-on'}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Name" name="ad-name" required maxLength={80} autoFocus value={form.name} onChange={set('name')} placeholder="Rent extra chair" />
          <SelectField label="Kind" name="ad-kind" value={form.kind} onChange={set('kind')} options={KINDS.map(([k, t]) => [k, t])} />
          <Field label={`Price (${currency})`} name="ad-price" inputMode="decimal" required placeholder={moneyPlaceholder(currency)}
            value={form.price} onChange={set('price')} error={bad ? 'Enter an amount, e.g. 25.' : null} hint="0 for free." />
          <Field label="Short description" name="ad-desc" optional maxLength={300} value={form.description} onChange={set('description')} placeholder="Black, 6 ft" />
        </div>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} disabled={bad}>{addon ? 'Save add-on' : 'Add add-on'}</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
