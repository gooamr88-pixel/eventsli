'use client';

import { useState } from 'react';
import { post, patch, del } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { formatMoney } from '../../../../utils/money';
import { centsToInput, moneyPlaceholder, parseMoneyToCents } from '../../../../lib/moneyInput';
import { useToast } from '../../../../components/ui/Toast';
import { useConfirm } from '../../../../components/ui/Confirm';
import { Panel } from '../../../../components/ui/Page';
import Field, { SelectField, TextareaField } from '../../../../components/forms/Field';
import FormError from '../../../../components/forms/FormError';
import SubmitButton from '../../../../components/forms/SubmitButton';
import NavIcon from '../../../../components/shell/NavIcon';
import { Loading, ErrorNotice } from '../../../../components/Feedback';
import { LEVELS, LevelBadge } from '../../../../components/sponsors/sponsorUi';

/**
 * The prospectus (2026-11-20): each package is a tier, a price, how many brands
 * can take it, and what it includes. A signed deal keeps the price and benefits
 * it signed, so a package can be repriced at any time; it cannot offer fewer
 * places than are already signed. A package with deals is taken off sale
 * rather than deleted, so a signed agreement keeps its name.
 */
export default function Packages({ eventId, currency, state, onChange }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null · 'new' · a package

  if (state.error) return <ErrorNotice error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading variant="card" label="Loading packages" />;
  const list = state.data;

  async function toggle(p) {
    try {
      await patch(`/events/${eventId}/sponsorship/packages/${p.id}`, { isActive: !p.isActive }, { noRedirect: true });
      toast.success(p.isActive ? `“${p.name}” is off sale.` : `“${p.name}” is on sale.`);
      onChange();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function remove(p) {
    const ok = await confirm({
      title: `Remove “${p.name}”?`,
      tone: 'danger',
      body: <p>{p.taken + p.pending > 0 ? 'Brands have deals on this package, so it is taken off sale. Their deals are not affected.' : 'It is deleted. You can add it again later.'}</p>,
      confirmLabel: 'Remove package',
    });
    if (!ok) return;
    try {
      const r = await del(`/events/${eventId}/sponsorship/packages/${p.id}`, { noRedirect: true });
      toast.success(r?.removed ? `“${p.name}” was removed.` : `“${p.name}” is off sale.`);
      onChange();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      <div className="fx-row fx-row--between gap-2">
        <p className="text-sm text-muted">Your sponsorship tiers. Public packages are listed on your sponsor page; private ones you offer by proposal only.</p>
        {!editing && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setEditing('new')}>
            <NavIcon name="plus" size={18} />Add a package
          </button>
        )}
      </div>

      {editing && (
        <PackageForm
          key={editing === 'new' ? 'new' : editing.id}
          eventId={eventId}
          currency={currency}
          pkg={editing === 'new' ? null : editing}
          onDone={(m) => { setEditing(null); toast.success(m); onChange(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {list.length === 0 && !editing ? (
        <div className="es-sp-empty">
          <NavIcon name="layers" size={36} />
          <p className="es-sp-empty__title">No packages yet</p>
          <p className="text-sm text-muted">Start with two or three tiers — for example Headline, Gold and Partner — each with what it includes.</p>
        </div>
      ) : (
        <ul className="es-sp-packages">
          {list.map((p) => (
            <li key={p.id} className={`es-sp-package ${p.isActive ? '' : 'is-off'}`} data-level={p.level}>
              <div className="es-sp-package__head">
                <LevelBadge level={p.level} />
                {!p.isActive && <span className="es-pill">Off sale</span>}
                {!p.isPublic && <span className="es-pill">Private</span>}
              </div>
              <p className="es-sp-package__name fx-break">{p.name}</p>
              <p className="es-sp-package__price es-nums">{p.priceCents === 0 ? 'In kind' : formatMoney(p.priceCents, currency)}</p>
              {p.description && <p className="text-sm text-muted fx-break">{p.description}</p>}
              {p.benefits.length > 0 && (
                <ul className="es-sp-benefits">
                  {p.benefits.map((b) => <li key={b}><NavIcon name="check" size={16} />{b}</li>)}
                </ul>
              )}
              <p className="es-sp-package__stock text-sm">
                {p.quantity === null ? `${p.taken} signed · no limit` : `${p.taken} of ${p.quantity} signed`}
                {p.pending > 0 && ` · ${p.pending} in proposal`}
              </p>
              <div className="fx-row gap-1 mt-auto">
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setEditing(p)}>Edit</button>
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => toggle(p)}>{p.isActive ? 'Pause' : 'Resume'}</button>
                {p.isActive && <button type="button" className="es-btn es-btn--ghost es-btn--sm text-danger" onClick={() => remove(p)}>Remove</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PackageForm({ eventId, currency, pkg, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    name: pkg?.name || '',
    level: pkg?.level || 'gold',
    price: pkg ? centsToInput(pkg.priceCents, currency) : '',
    quantity: pkg?.quantity === null || pkg?.quantity === undefined ? '' : String(pkg.quantity),
    description: pkg?.description || '',
    benefits: (pkg?.benefits || []).join('\n'),
    isPublic: pkg ? pkg.isPublic : true,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const cents = form.price === '' ? null : parseMoneyToCents(form.price, currency);
  const priceInvalid = form.price !== '' && (cents === null || cents < 0);
  const quantity = form.quantity === '' ? null : Number(form.quantity);
  const taken = pkg?.taken || 0;
  const belowTaken = quantity !== null && quantity < Math.max(taken, 1);

  async function submit(e) {
    e.preventDefault();
    if (priceInvalid || belowTaken || cents === null) return;
    setBusy(true);
    setError(null);
    const body = {
      name: form.name.trim(),
      level: form.level,
      priceCents: cents,
      quantity,
      description: form.description.trim() || null,
      benefits: form.benefits.split('\n').map((b) => b.trim()).filter(Boolean),
      isPublic: form.isPublic,
    };
    try {
      if (pkg) await patch(`/events/${eventId}/sponsorship/packages/${pkg.id}`, body, { noRedirect: true });
      else await post(`/events/${eventId}/sponsorship/packages`, body, { noRedirect: true });
      onDone(pkg ? `“${body.name}” was updated.` : `“${body.name}” was added.`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Panel title={pkg ? `Edit “${pkg.name}”` : 'New package'}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm">
        <div className="fx-grid fx-grid--2">
          <Field label="Name" name="pk-name" required maxLength={80} autoFocus value={form.name} onChange={set('name')}
            hint="e.g. Gold sponsor, Official drinks partner." />
          <SelectField label="Tier on the event page" name="pk-level" value={form.level} onChange={set('level')} options={LEVELS}
            hint="Headline sponsors are shown first and largest." />
          <Field label={`Price (${currency})`} name="pk-price" inputMode="decimal" required placeholder={moneyPlaceholder(currency)}
            value={form.price} onChange={set('price')} error={priceInvalid ? 'Enter an amount, e.g. 5000.' : null}
            hint="0 for an in-kind sponsorship (goods or services instead of money)." />
          <Field label="How many sponsors" name="pk-quantity" type="number" min={Math.max(taken, 1)} optional value={form.quantity} onChange={set('quantity')}
            error={belowTaken ? `${taken} already signed, so it cannot go lower.` : null}
            hint={taken > 0 ? `${taken} signed so far. Leave empty for no limit.` : 'e.g. 1 for an exclusive headline slot. Leave empty for no limit.'} />
        </div>
        <TextareaField label="Description" name="pk-description" optional rows={2} maxLength={600} value={form.description} onChange={set('description')} />
        <TextareaField label="What is included" name="pk-benefits" optional rows={5} value={form.benefits} onChange={set('benefits')}
          hint="One per line, e.g. Logo on the event page · 10 VIP tickets · Booth at the entrance · Stage mention." />
        <label className="fx-row items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm((f) => ({ ...f, isPublic: e.target.checked }))} />
          Show on my public sponsor page
        </label>
        <FormError error={error} />
        <div className="fx-row">
          <SubmitButton busy={busy} disabled={priceInvalid || belowTaken}>{pkg ? 'Save package' : 'Add package'}</SubmitButton>
          <button type="button" className="es-btn es-btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Panel>
  );
}
