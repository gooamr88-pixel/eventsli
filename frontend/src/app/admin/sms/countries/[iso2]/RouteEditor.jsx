'use client';

import { useState } from 'react';
import { put, post } from '../../../../utils/apiClient';
import { describeError, messageFor } from '../../../../utils/errors';
import { useToast } from '../../../../components/ui/Toast';
import Field, { SelectField } from '../../../../components/forms/Field';
import { formatMicros, parseMicros, microsToInput } from '../../../../lib/smsFormat';

/**
 * One row per provider: priority, pinned sender, cost per segment, and the two
 * switches that matter — VERIFIED (someone checked this provider reaches this
 * country with these senders) and ACTIVE.
 *
 * "Fetch price" asks the provider's pricing API for this one country. A price
 * list is evidence of reach, never verification: the box stays unticked.
 */

function RouteRow({ country, provider, route, senders, canEdit, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(() => ({
    priority: String(route?.priority ?? provider.priority ?? 100),
    senderId: route?.senderId || '',
    cost: microsToInput(route?.costMicros),
    currency: route?.currency || 'USD',
    active: route?.active ?? true,
    verified: route?.verified ?? false,
  }));
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const own = senders.filter((s) => s.providerId === provider.id);

  async function save(e) {
    e.preventDefault();
    const costMicros = f.cost.trim() === '' ? null : parseMicros(f.cost);
    if (f.cost.trim() !== '' && costMicros == null) { toast.error('Cost must be a number like 0.0075.'); return; }
    setBusy(true);
    try {
      await put(`/admin/sms/countries/${country.iso2}/routes/${provider.id}`, {
        priority: Number(f.priority), senderId: f.senderId || null, costMicros, currency: f.currency,
        active: f.active, verified: f.verified,
      }, { noRedirect: true });
      toast.success(`${provider.displayName} route saved.`);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  async function fetchPrice() {
    setBusy(true);
    try {
      const r = await post(`/admin/sms/providers/${provider.id}/sync-pricing`, { country: country.iso2 }, { noRedirect: true });
      toast.success(r.available
        ? `${provider.displayName} prices ${country.name} at ${formatMicros(r.costMicros, r.currency)} per segment.`
        : `${provider.displayName} does not list a price for ${country.name}.`);
      onSaved();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="fx-stack fx-stack--sm rounded-(--es-radius-md) border border-(--es-border) p-4">
      <div className="fx-row fx-row--between items-center gap-2">
        <p className="font-semibold text-ink">{provider.displayName}</p>
        <span className="text-xs text-subtle">
          {!provider.credentials?.configured && 'No credentials on the server · '}
          {!provider.enabled && 'Provider is off · '}
          {route?.available === true && 'Priced by the provider'}
          {route?.available === false && 'Provider lists no price here'}
          {route?.costSyncedAt && ` · synced ${new Date(route.costSyncedAt).toLocaleDateString()}`}
        </span>
      </div>
      <fieldset disabled={!canEdit || busy} className="es-smsform">
        <Field label="Priority" type="number" min={0} max={1000} value={f.priority} onChange={set('priority')} hint="Lower is tried first" />
        <SelectField label="Sender" value={f.senderId} onChange={set('senderId')}
          options={[['', 'Choose automatically'], ...own.map((s) => [s.id, `${s.value} (${s.kind.replace('_', ' ')})`])]} />
        <Field label="Cost per segment" inputMode="decimal" value={f.cost} onChange={set('cost')} optional hint="e.g. 0.0075" />
        <Field label="Currency" value={f.currency} onChange={set('currency')} maxLength={3} />
        <label className="es-smscheck"><input type="checkbox" checked={f.active} onChange={set('active')} /><span>Active</span></label>
        <label className="es-smscheck"><input type="checkbox" checked={f.verified} onChange={set('verified')} />
          <span>Verified: I checked this provider reaches {country.name} with these senders</span></label>
      </fieldset>
      {canEdit && (
        <div className="fx-row gap-2">
          <button type="submit" className="es-btn es-btn--primary es-btn--sm" disabled={busy}>Save route</button>
          {provider.credentials?.configured && (
            <button type="button" className="es-btn es-btn--ghost es-btn--sm" disabled={busy} onClick={fetchPrice}>Fetch price</button>
          )}
        </div>
      )}
    </form>
  );
}

export default function RouteEditor({ country, providers, senders, canEdit, onSaved }) {
  if (!providers.length) return <p className="text-sm text-muted">Loading providers…</p>;
  return (
    <div className="fx-stack fx-stack--sm">
      {providers.map((p) => (
        <RouteRow
          key={`${p.id}:${country.updatedAt}:${country.routes.find((r) => r.providerId === p.id)?.costSyncedAt || ''}`}
          country={country} provider={p} route={country.routes.find((r) => r.providerId === p.id)}
          senders={senders} canEdit={canEdit} onSaved={onSaved}
        />
      ))}
    </div>
  );
}
