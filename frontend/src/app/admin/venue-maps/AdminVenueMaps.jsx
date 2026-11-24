'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { get, post, patch, del } from '../../utils/apiClient';
import { describeError, messageFor } from '../../utils/errors';
import { useConfirm } from '../../components/ui/Confirm';
import { useToast } from '../../components/ui/Toast';
import { PageHeader, StatCard } from '../../components/ui/Page';
import { Segmented, SearchBox } from '../../components/ui/Filters';
import { Loading, Empty, ErrorNotice } from '../../components/Feedback';
import NavIcon from '../../components/shell/NavIcon';
import TemplateDialog from '../../components/templates/TemplateDialog';
import VenueMapCard from '../../components/venueMaps/VenueMapCard';
import VenueMapPreview from '../../components/venueMaps/VenueMapPreview';
import { VENUE_KINDS } from '../../components/venueMaps/venueMapData';
import AddVenueMap from './AddVenueMap';
import EditVenueMap from './EditVenueMap';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The venue map library, from the console (owner, 2026-11-24): "find seating
 * maps for well-known venues, import or add them, and make them available in
 * our templates library so organizers can find and use them".
 *
 *   Eventsli library   maps of real venues, each a draft until published;
 *                      hidden takes one away without deleting it; featured
 *                      and verified ones lead and carry a badge
 *   Organizers' maps   what organizers saved for themselves — to look at,
 *                      add to the library (as a draft) or remove
 *
 * Add a venue map: find the venue (venue search), take its map from an event
 * already held there or read its seating-chart picture with AI, then name the
 * layout. MAP ONLY — no prices, ticket types or event details (owner's rule).
 *
 * `?from=<eventId>` (the admin event page's Add to venue maps) opens Add a
 * venue map on that event's venue and map.
 *
 * Every admin can look; changes are a super admin's, enforced by the API
 * (routes/admin/venueMapRoutes.js) as well as by hiding the buttons here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STATUS = { draft: ['Draft', 'neutral'], published: ['Published', 'success'], hidden: ['Hidden', 'warning'] };

export default function AdminVenueMaps() {
  const params = useSearchParams();
  const router = useRouter();
  const fromEventId = params?.get('from') || null;
  const { user } = useAuth();
  const canEdit = Boolean(user?.isSuperAdmin);
  const confirm = useConfirm();
  const toast = useToast();
  const [scope, setScope] = useState('platform');
  const [status, setStatus] = useState('all');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const query = `/admin/venue-maps?scope=${scope}${kind ? `&kind=${kind}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data, error, loading, reload } = useApi(query);
  const [adding, setAdding] = useState(Boolean(fromEventId));
  const [replacing, setReplacing] = useState(null);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);

  const all = useMemo(() => data?.templates || [], [data]);
  const list = scope === 'platform' && status !== 'all' ? all.filter((t) => t.status === status) : all;
  const stats = useMemo(() => ({
    published: all.filter((t) => t.status === 'published').length,
    drafts: all.filter((t) => t.status === 'draft').length,
    venues: new Set(all.map((t) => `${t.venue.name}|${t.venue.city}`.toLowerCase())).size,
    uses: all.reduce((n, t) => n + (t.useCount || 0), 0),
  }), [all]);

  async function run(fn, done) {
    try {
      await fn();
      if (done) toast.success(done);
      reload();
    } catch (err) {
      toast.error(messageFor(err), { title: describeError(err).title });
    }
  }

  const setState = (t, next) => run(() => patch(`/admin/venue-maps/${t.id}`, { status: next }, { noRedirect: true }),
    next === 'published' ? 'Published: every organizer can use it now.' : next === 'hidden' ? 'Hidden from organizers.' : 'Moved back to drafts.');

  async function remove(t) {
    const ok = await confirm({
      title: `Delete “${t.venue.name} — ${t.name}”?`,
      body: <p>{t.scope === 'platform' ? 'Organizers stop seeing it. Maps already put into events, and copies organizers saved, stay as they are.' : `It leaves ${t.organizerName || 'the organizer'}’s saved maps.`}</p>,
      confirmLabel: 'Delete map',
      tone: 'danger',
    });
    if (ok) run(() => del(`/admin/venue-maps/${t.id}`, { noRedirect: true }), 'Map deleted.');
  }

  async function openPreview(t) {
    setPreview({ template: t, full: null });
    try {
      setPreview({ template: t, full: await get(`/admin/venue-maps/${t.id}`, { cache: 'no-store', noRedirect: true }) });
    } catch (err) {
      setPreview(null);
      toast.error(messageFor(err));
    }
  }

  const empty = scope === 'platform'
    ? (q || kind || status !== 'all'
      ? <Empty icon="search" title="No maps match" hint="Try another venue name, city or kind." />
      : (
        <Empty
          icon="map"
          title="Start the venue library"
          hint="Add the venues organizers book most: find the venue, take its map from an event held there or read its seating chart, and publish it."
          action={canEdit && <button type="button" className="es-btn es-btn--primary" onClick={() => setAdding(true)}><NavIcon name="plus" size={18} />Add a venue map</button>}
        />
      ))
    : <Empty icon="map" title="No saved maps yet" hint="Maps organizers save from their Venue Builder appear here." />;

  return (
    <div className="fx-stack">
      <PageHeader
        eyebrow="Storefront"
        title="Venue maps"
        lede="Seating maps of real venues that every organizer can drop into an event — the map only, no prices or ticket types — and the maps organizers save for themselves."
        actions={canEdit && (
          <button type="button" className="es-btn es-btn--primary" onClick={() => setAdding(true)}>
            <NavIcon name="plus" size={18} />Add a venue map
          </button>
        )}
      />
      {!canEdit && <p className="es-notice es-notice--info" role="status">You can look at the library. Changing it is for super admins.</p>}
      {data && data.enabled === false && (
        <p className="es-notice es-notice--warning" role="status">The venue map library needs migration 20261214090000 on this database.</p>
      )}

      {scope === 'platform' && all.length > 0 && (
        <div className="es-statgrid">
          <StatCard label="Published" value={stats.published} note="Offered to every organizer" icon="globe" />
          <StatCard label="Drafts" value={stats.drafts} note="Only admins see these" icon="pencil" />
          <StatCard label="Venues" value={stats.venues} note="With at least one map" icon="building" />
          <StatCard label="Times used" value={stats.uses} note="Put into an event map" icon="trend" />
        </div>
      )}

      <div className="es-vmfilters">
        <Segmented
          label="Which maps" value={scope} onChange={(v) => { setScope(v); setStatus('all'); }}
          options={[{ value: 'platform', label: 'Eventsli library' }, { value: 'organizer', label: 'Organizers’ maps' }]}
        />
        {scope === 'platform' && (
          <Segmented
            label="Status" value={status} onChange={setStatus}
            options={[{ value: 'all', label: 'All' }, { value: 'published', label: 'Published' }, { value: 'draft', label: 'Drafts' }, { value: 'hidden', label: 'Hidden' }]}
          />
        )}
        <label className="es-vmfilters__kind">
          <span className="sr-only">Kind of venue</span>
          <select className="es-input" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Every kind of venue</option>
            {VENUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <div className="es-vmfilters__search">
          <SearchBox label="Search venue maps" value={q} onSearch={setQ} placeholder="Venue, city or layout" />
        </div>
      </div>

      {error && !data ? <ErrorNotice error={error} onRetry={reload} />
        : loading && !data ? <Loading variant="list" rows={3} label="Loading venue maps" />
          : list.length === 0 ? empty : (
            <div className="es-tplgrid">
              {list.map((t) => {
                const [label, tone] = STATUS[t.status] || STATUS.draft;
                return (
                  <VenueMapCard
                    key={t.id}
                    template={t}
                    onOpen={() => openPreview(t)}
                    badges={[
                      ...(t.scope === 'platform' ? [{ label, tone }] : [{ label: t.organizerName || 'Organizer' }]),
                      ...(t.verified ? [{ label: 'Verified', tone: 'brand' }] : []),
                      ...(t.featured ? [{ label: 'Featured', tone: 'highlight' }] : []),
                    ]}
                  >
                    <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => openPreview(t)}>Preview</button>
                    {canEdit && t.scope === 'platform' && (
                      <>
                        {/* The map itself, in the Venue Builder (2026-11-24). "Edit"
                            beside it is the name, venue and kind. */}
                        <Link href={`/admin/venue-maps/${t.id}/map`} className="es-btn es-btn--primary es-btn--sm">Edit map</Link>
                        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setEditing(t)}>Edit details</button>
                        {t.status !== 'published'
                          ? <button type="button" className="es-btn es-btn--primary es-btn--sm" onClick={() => setState(t, 'published')}>Publish</button>
                          : <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setState(t, 'hidden')}>Hide</button>}
                        <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => setReplacing(t)}>New map</button>
                      </>
                    )}
                    {canEdit && t.scope === 'organizer' && (
                      <button type="button" className="es-btn es-btn--secondary es-btn--sm"
                        onClick={() => run(() => post(`/admin/venue-maps/${t.id}/promote`, {}, { noRedirect: true }), 'Added to the Eventsli library as a draft.')}>
                        Add to library
                      </button>
                    )}
                    {canEdit && <button type="button" className="es-btn es-btn--ghost es-btn--sm" data-tone="danger" onClick={() => remove(t)}>Delete</button>}
                  </VenueMapCard>
                );
              })}
            </div>
          )}

      {adding && (
        <AddVenueMap
          fromEventId={fromEventId}
          onClose={() => { setAdding(false); if (fromEventId) router.replace('/admin/venue-maps'); }}
          onCreated={(t) => { setAdding(false); if (fromEventId) router.replace('/admin/venue-maps'); setScope('platform'); setStatus('all'); reload(); toast.success('Saved as a draft. Check it, then publish it.', { title: `${t.venue.name} added` }); }}
        />
      )}
      {replacing && (
        <AddVenueMap
          replace={replacing}
          onClose={() => setReplacing(null)}
          onCreated={() => { setReplacing(null); reload(); toast.success('The new map is in place.'); }}
        />
      )}
      {editing && <EditVenueMap template={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {preview && (
        <TemplateDialog id="admin-vm-preview" title={`${preview.template.venue.name} — ${preview.template.name}`} onClose={() => setPreview(null)} wide>
          {preview.full ? (
            <VenueMapPreview template={preview.full}>
              {preview.template.sourceEventId && (
                <Link href={`/admin/events/${preview.template.sourceEventId}`} className="text-sm text-accent">Open the event it was taken from</Link>
              )}
            </VenueMapPreview>
          ) : <Loading variant="card" />}
        </TemplateDialog>
      )}
    </div>
  );
}
