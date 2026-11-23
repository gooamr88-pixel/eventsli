'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '../../hooks/useApi';
import { get, post, patch, del } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { Segmented } from '../../components/ui/Filters';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import TemplateDialog from '../../components/templates/TemplateDialog';
import VenueMapCard from '../../components/venueMaps/VenueMapCard';
import VenueMapPreview from '../../components/venueMaps/VenueMapPreview';
import { VENUE_KINDS } from '../../components/venueMaps/venueMapData';
import { useOrganizerEvents } from '../nav/OrganizerEvents';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Templates → Venue maps (2026-11-24): Eventsli's library of real venues and
 * the maps the organizer saved — the map only, never prices or ticket types.
 *
 *   Use in an event   opens that event's Event map with the map's preview
 *                     (`?venueMap=<id>`), where Use this map puts it in the
 *                     draft and Save map keeps it
 *   Copy to mine      an Eventsli map into Your maps
 *   Save a map        one of their events' saved map, into Your maps (also
 *                     Save as template in the Venue Builder)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueMapsTab() {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const { data, error, loading, reload } = useApi('/organizer/venue-maps');
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState(null);
  const [using, setUsing] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <Loading variant="list" rows={3} label="Loading venue maps" />;
  if (error && !data) return <ErrorNotice error={error} onRetry={reload} />;

  const library = data?.library || [];
  const mine = data?.mine || [];
  const current = tab || (library.length || !mine.length ? 'library' : 'mine');
  const term = q.trim().toLowerCase();
  const list = (current === 'mine' ? mine : library)
    .filter((t) => !term || [t.venue.name, t.venue.city, t.name].some((s) => String(s || '').toLowerCase().includes(term)));

  async function openPreview(t) {
    setPreview({ template: t, full: null });
    try {
      setPreview({ template: t, full: await get(`/organizer/venue-maps/${t.id}`, { cache: 'no-store', noRedirect: true }) });
    } catch (err) {
      setPreview(null);
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function copy(t) {
    try {
      await post(`/organizer/venue-maps/${t.id}/copy`, {}, { noRedirect: true });
      toast.success('It is in Your maps now, to rename and keep.', { title: 'Map copied' });
      setTab('mine');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  async function remove(t) {
    const ok = await confirm({
      title: `Delete “${t.name}”?`,
      body: <p>Event maps already made from it stay as they are.</p>,
      confirmLabel: 'Delete map',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await del(`/organizer/venue-maps/${t.id}`, { noRedirect: true });
      toast.success('Map deleted.');
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  return (
    <div className="fx-stack">
      {data && data.enabled === false && (
        <p className="es-notice es-notice--info" role="status">The venue map library is being switched on. Check back shortly.</p>
      )}
      <div className="es-vmfilters">
        <Segmented
          label="Which maps" value={current} onChange={setTab}
          options={[
            { value: 'library', label: 'Venue library', count: library.length },
            { value: 'mine', label: 'Your maps', count: mine.length },
          ]}
        />
        <label className="es-vmfilters__search">
          <span className="sr-only">Search venue maps</span>
          <input type="search" className="es-input" value={q} placeholder="Venue, city or layout" onChange={(e) => setQ(e.target.value)} />
        </label>
        <button type="button" className="es-btn es-btn--secondary" onClick={() => setSaving(true)}>
          <NavIcon name="plus" size={18} />Save a map
        </button>
      </div>

      {list.length === 0 ? (
        term ? <Empty icon="search" title="No maps match" hint="Try the venue’s name or its city." />
          : current === 'mine' ? (
            <Empty
              icon="map"
              title="Save your first map"
              hint="Keep a room you use again — your usual ballroom, your theatre — and start any event’s map from it. Or copy one from the venue library."
              action={<button type="button" className="es-btn es-btn--secondary" onClick={() => setSaving(true)}>Save a map</button>}
            />
          ) : <Empty icon="building" title="The venue library is on its way" hint="Eventsli is adding maps of popular venues. They will appear here, ready to use." />
      ) : (
        <div className="es-tplgrid">
          {list.map((t) => (
            <VenueMapCard
              key={t.id}
              template={t}
              onOpen={() => openPreview(t)}
              badges={[
                ...(t.scope === 'platform' ? [{ label: 'Eventsli', tone: 'brand' }] : []),
                ...(t.verified ? [{ label: 'Verified', tone: 'success' }] : []),
                ...(t.featured ? [{ label: 'Featured', tone: 'highlight' }] : []),
              ]}
            >
              <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => setUsing(t)}>Use in an event</button>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => openPreview(t)}>Preview</button>
              {t.scope === 'platform' ? (
                <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => copy(t)}>Copy to mine</button>
              ) : (
                <>
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setRenaming(t)}>Rename</button>
                  <button type="button" className="es-btn es-btn--ghost es-btn--sm" data-tone="danger" onClick={() => remove(t)}>Delete</button>
                </>
              )}
            </VenueMapCard>
          ))}
        </div>
      )}

      {preview && (
        <TemplateDialog id="vm-preview" title={`${preview.template.venue.name} — ${preview.template.name}`} onClose={() => setPreview(null)} wide>
          {preview.full ? <VenueMapPreview template={preview.full} /> : <Loading variant="card" />}
          <div className="fx-row flex-wrap gap-2 border-t border-border-base pt-3">
            <button type="button" className="es-btn es-btn--primary" onClick={() => { setUsing(preview.template); setPreview(null); }}>Use in an event</button>
            {preview.template.scope === 'platform' && (
              <button type="button" className="es-btn es-btn--secondary" onClick={() => { setPreview(null); copy(preview.template); }}>Copy to mine</button>
            )}
          </div>
        </TemplateDialog>
      )}
      {using && <UseDialog template={using} onClose={() => setUsing(null)} onPick={(eventId) => router.push(`/organizer/events/${eventId}/map?venueMap=${using.id}`)} />}
      {renaming && <RenameDialog template={renaming} onClose={() => setRenaming(null)} onSaved={() => { setRenaming(null); reload(); }} />}
      {saving && <SaveDialog onClose={() => setSaving(false)} onSaved={() => { setSaving(false); setTab('mine'); reload(); }} />}
    </div>
  );
}

/** Which event's map to put it in: events that have one (not display-only listings). */
function UseDialog({ template, onClose, onPick }) {
  const { events = [] } = useOrganizerEvents() || {};
  const open = (events || []).filter((e) => e.listingType !== 'display_only' && !['cancelled', 'ended', 'archived'].includes(e.status));
  const [eventId, setEventId] = useState('');
  return (
    <TemplateDialog id="vm-use" title={`Use ${template.venue.name}`} onClose={onClose}>
      <div className="fx-stack fx-stack--sm gap-3">
        <p className="text-sm text-muted">Its Event map opens with this map ready to check. Nothing changes until you choose Use this map and then Save map.</p>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-use-event" className="text-sm text-ink">Event</label>
          <select id="vm-use-event" className="es-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">Choose an event</option>
            {open.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
        </div>
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="es-btn es-btn--primary" disabled={!eventId} onClick={() => onPick(eventId)}>Open its Event map</button>
        </div>
      </div>
    </TemplateDialog>
  );
}

/** One of their events' saved map, into Your maps. */
function SaveDialog({ onClose, onSaved }) {
  const { events = [] } = useOrganizerEvents() || {};
  const toast = useToast();
  const [eventId, setEventId] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/organizer/venue-maps', { eventId, ...(name.trim() ? { name: name.trim() } : {}), ...(kind ? { venueKind: kind } : {}) }, { noRedirect: true });
      toast.success('Start any event’s map from it.', { title: 'Map saved' });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="vm-save" title="Save an event’s map" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-save-event" className="text-sm text-ink">Event</label>
          <select id="vm-save-event" className="es-input" value={eventId} onChange={(e) => setEventId(e.target.value)} required>
            <option value="">Choose an event</option>
            {(events || []).filter((ev) => ev.listingType !== 'display_only').map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
          </select>
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-save-name" className="text-sm text-ink">Name</label>
          <input id="vm-save-name" className="es-input" maxLength={80} value={name} placeholder="Ballroom — 40 rounds" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-save-kind" className="text-sm text-ink">Kind of venue</label>
          <select id="vm-save-kind" className="es-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">As set in the Studio</option>
            {VENUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <p className="text-xs text-subtle">The saved map only: tables, rows, areas, walls and the look. Prices, ticket types and sales stay with the event.</p>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || !eventId}>{busy ? 'Saving…' : 'Save map'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}

function RenameDialog({ template, onClose, onSaved }) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [kind, setKind] = useState(template.venue?.kind || 'other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await patch(`/organizer/venue-maps/${template.id}`, { name: name.trim(), description: description.trim() || null, venueKind: kind }, { noRedirect: true });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <TemplateDialog id="vm-rename" title="Rename map" onClose={onClose}>
      <form onSubmit={submit} className="fx-stack fx-stack--sm gap-3">
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-rename-name" className="text-sm text-ink">Name</label>
          <input id="vm-rename-name" className="es-input" minLength={2} maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-rename-kind" className="text-sm text-ink">Kind of venue</label>
          <select id="vm-rename-kind" className="es-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {VENUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <div className="fx-stack fx-stack--sm gap-1.5">
          <label htmlFor="vm-rename-desc" className="text-sm text-ink">Notes</label>
          <textarea id="vm-rename-desc" className="es-input" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        <div className="fx-row fx-row--between">
          <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="es-btn es-btn--primary" disabled={busy || name.trim().length < 2}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </TemplateDialog>
  );
}
