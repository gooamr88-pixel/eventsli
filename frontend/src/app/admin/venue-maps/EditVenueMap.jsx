'use client';

import { useState } from 'react';
import { patch } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import TemplateDialog from '../../components/templates/TemplateDialog';
import PlaceAutocomplete from '../../components/forms/PlaceAutocomplete';
import { COUNTRY_OPTIONS } from '../../lib/markets';
import { VENUE_KINDS } from '../../components/venueMaps/venueMapData';

/** Everything an Eventsli venue map carries besides the map itself (2026-11-24). */
export default function EditVenueMap({ template, onClose, onSaved }) {
  const v0 = template.venue || {};
  const [venue, setVenue] = useState({
    name: v0.name || '', address: v0.address || '', city: v0.city || '', region: v0.region || '', country: v0.country || '',
    placeId: v0.placeId || null, lat: v0.lat ?? null, lng: v0.lng ?? null, kind: v0.kind || 'other',
  });
  const [form, setForm] = useState({
    name: template.name, description: template.description || '', sourceNote: template.sourceNote || '',
    status: template.status, featured: Boolean(template.featured), verified: Boolean(template.verified), sortOrder: template.sortOrder || 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setV = (k) => (e) => setVenue((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch(`/admin/venue-maps/${template.id}`, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        sourceNote: form.sourceNote.trim() || null,
        status: form.status,
        featured: form.featured,
        verified: form.verified,
        sortOrder: Number(form.sortOrder) || 0,
        venue: {
          name: venue.name.trim(), address: venue.address.trim() || null, city: venue.city.trim() || null,
          region: venue.region?.trim() || null, country: venue.country || null, placeId: venue.placeId,
          lat: venue.lat, lng: venue.lng, kind: venue.kind,
        },
      }, { noRedirect: true });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="admin-vm-edit" title="Edit venue map" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <PlaceAutocomplete
          label="Venue"
          value={venue.name}
          country={venue.country || undefined}
          required
          onChange={(name) => setVenue((v) => ({ ...v, name, placeId: null, lat: null, lng: null }))}
          onPlace={(p) => setVenue((v) => ({
            ...v, name: p.name || v.name, address: p.address || '', city: p.city || v.city, region: p.region || '',
            placeId: p.placeId || null, lat: p.lat ?? null, lng: p.lng ?? null,
          }))}
        />
        <div className="es-tplform-grid">
          <Field id="evm-city" label="City"><input id="evm-city" className="es-input" maxLength={120} value={venue.city} onChange={setV('city')} /></Field>
          <Field id="evm-country" label="Country">
            <select id="evm-country" className="es-input" value={venue.country} onChange={setV('country')}>
              <option value="">Choose</option>
              {COUNTRY_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </Field>
          <Field id="evm-kind" label="Kind of venue">
            <select id="evm-kind" className="es-input" value={venue.kind} onChange={setV('kind')}>
              {VENUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
        </div>
        <Field id="evm-name" label="Layout name">
          <input id="evm-name" className="es-input" required minLength={2} maxLength={80} value={form.name} onChange={set('name')} />
        </Field>
        <Field id="evm-desc" label="Notes for organizers">
          <textarea id="evm-desc" className="es-input" rows={3} maxLength={500} value={form.description} onChange={set('description')} />
        </Field>
        <Field id="evm-credit" label="Source">
          <input id="evm-credit" className="es-input" maxLength={300} value={form.sourceNote} onChange={set('sourceNote')} />
        </Field>
        <div className="es-tplform-grid">
          <Field id="evm-status" label="Who sees it">
            <select id="evm-status" className="es-input" value={form.status} onChange={set('status')}>
              <option value="draft">Draft — admins only</option>
              <option value="published">Published — every organizer</option>
              <option value="hidden">Hidden — kept, not offered</option>
            </select>
          </Field>
          <Field id="evm-order" label="Order">
            <input id="evm-order" type="number" min={0} max={9999} className="es-input" value={form.sortOrder} onChange={set('sortOrder')} />
          </Field>
        </div>
        <label className="fx-row items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.featured} onChange={set('featured')} /> Featured — shown first, with a badge
        </label>
        <label className="fx-row items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={form.verified} onChange={set('verified')} /> Checked against the real venue (Verified)
        </label>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || form.name.trim().length < 2 || venue.name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}

function Field({ id, label, children }) {
  return (
    <div className="fx-stack fx-stack--sm gap-1.5">
      <label htmlFor={id} className="text-sm text-ink">{label}</label>
      {children}
    </div>
  );
}
