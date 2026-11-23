'use client';

import { useState } from 'react';
import Link from 'next/link';
import { post } from '../../../../../utils/apiClient';
import { messageFor } from '../../../../../utils/errors';
import { useToast } from '../../../../../components/ui/Toast';
import NavIcon from '../../../../../components/shell/NavIcon';
import TemplateDialog from '../../../../../components/templates/TemplateDialog';
import { VENUE_KINDS } from '../../../../../components/venueMaps/venueMapData';

/**
 * Save as template, from the Venue Builder (2026-11-24): this event's SAVED
 * map into the organizer's own maps, to start any later event's map from.
 * The map only — no prices or ticket types — with the event's venue, so it
 * is offered first the next time an event is at the same place.
 *
 * Unsaved changes are not on the server yet, so the template would miss
 * them: the dialog says so and offers Save map first.
 */
export default function SaveMapTemplateDialog({ eventId, venueName, dirty, saving, canSave, onSaveMap, onClose }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const t = await post('/organizer/venue-maps', {
        eventId,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(kind ? { venueKind: kind } : {}),
      }, { noRedirect: true });
      setSaved(t);
      toast.success('Start any event’s map from it.', { title: 'Map saved as a template' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <TemplateDialog id="map-save-tpl" title="Saved to your maps" onClose={onClose}>
        <p className="es-vmdone"><NavIcon name="tick" size={18} /><span><b>{saved.name}</b> is in Your maps{saved.venue?.name ? `, filed under ${saved.venue.name}` : ''}.</span></p>
        <p className="text-sm text-muted">In any event’s Event map, choose <b>A ready-made map</b> to use it. Rename or delete it on Templates → Venue maps.</p>
        <div className="fx-row fx-row--between gap-2">
          <Link href="/organizer/templates?tab=maps" className="es-btn es-btn--ghost">Open Templates</Link>
          <button type="button" className="es-btn es-btn--primary" onClick={onClose}>Done</button>
        </div>
      </TemplateDialog>
    );
  }

  return (
    <TemplateDialog id="map-save-tpl" title="Save this map as a template" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <p className="text-sm text-muted">
          The room only — tables, rows, areas, walls and the look. Prices, ticket types and sales stay with this event.
        </p>
        {dirty && (
          <div className="es-notice es-notice--warning fx-row flex-wrap items-center justify-between gap-2" role="status">
            <span>You have unsaved changes. Save the map first so the template has them.</span>
            <button type="button" className="es-btn es-btn--secondary es-btn--sm" disabled={!canSave} onClick={onSaveMap}>{saving ? 'Saving…' : 'Save map'}</button>
          </div>
        )}
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="mst-name" className="text-sm text-ink">Template name</label>
          <input id="mst-name" className="es-input" maxLength={80} value={name} placeholder={venueName ? `${venueName} — gala rounds` : 'Ballroom — 40 rounds'} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="mst-kind" className="text-sm text-ink">Kind of venue</label>
          <select id="mst-kind" className="es-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">As set in the Studio</option>
            {VENUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="mst-desc" className="text-sm text-ink">Notes (optional)</label>
          <textarea id="mst-desc" className="es-input" rows={2} maxLength={500} value={description} placeholder="Dance floor in the middle, bar by the entrance." onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || dirty}>{busy ? 'Saving…' : 'Save template'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}
