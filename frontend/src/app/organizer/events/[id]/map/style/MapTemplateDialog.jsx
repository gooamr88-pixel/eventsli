'use client';

import { useEffect, useRef, useState } from 'react';
import { get, post } from '../../../../../utils/apiClient';
import { messageFor } from '../../../../../utils/errors';
import { useApi } from '../../../../../hooks/useApi';
import { worldOf } from '../../../../../components/seating/seatingGeometry';
import { readZones } from '../../../../../components/seating/layoutZones';
import { readLook, readTableStyles } from '../../../../../components/seating/mapStyle';
import { readStudio } from '../../../../../components/venue/venueModel';
import { Segmented } from '../../../../../components/ui/Filters';
import NavIcon from '../../../../../components/shell/NavIcon';
import TemplateDialog from '../../../../../components/templates/TemplateDialog';
import TemplatePreview from '../../../../../components/templates/TemplatePreview';
import { templateFacts } from '../../../../../components/templates/TemplateCard';
import VenueMapCard from '../../../../../components/venueMaps/VenueMapCard';
import VenueMapPreview from '../../../../../components/venueMaps/VenueMapPreview';
import { toEditorSpec } from '../../../../../components/venueMaps/venueMapData';
import { Loading, Empty } from '../../../../../components/Feedback';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * A ready-made map, inside the Venue Builder (2026-11-19; the venue map
 * library, 2026-11-24).
 *
 *   This venue      Eventsli's maps (and the organizer's) of the venue this
 *                   event is at — matched on the Google place, else the name
 *                   and city — offered first, above everything
 *   Venue library   Eventsli's maps of real venues, searchable by venue,
 *                   city or layout
 *   Your maps       maps the organizer saved with Save as template
 *   Event templates the map inside a whole event template (as before):
 *                   tables keep their ticket type where this event has one
 *                   of the same name
 *
 * A venue map is the MAP ONLY: tables arrive without prices or ticket types.
 * It lands in the unsaved draft — one Ctrl+Z puts the old map back, and
 * nothing is saved until Save map. `initialId` opens one map's preview
 * straight away (the empty map's "Eventsli has a map of this venue", or
 * Templates → Use in an event).
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function MapTemplateDialog({ eventId, initialId = null, tiers = [], categories = [], replacing, blocked = null, onApply, onClose }) {
  const { data, loading } = useApi(`/organizer/venue-maps?eventId=${eventId}`);
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(null);       // { kind: 'venue'|'event', card, full }
  const [error, setError] = useState(null);
  const eventTpl = useApi(tab === 'events' ? '/organizer/templates' : null);

  const forVenue = data?.forVenue || [];
  const library = data?.library || [];
  const mine = data?.mine || [];
  const current = tab || (library.length || !mine.length ? 'library' : 'mine');

  async function openVenueMap(card) {
    setError(null);
    setChosen({ kind: 'venue', card, full: null });
    try {
      setChosen({ kind: 'venue', card, full: await get(`/organizer/venue-maps/${card.id}`, { cache: 'no-store', noRedirect: true }) });
    } catch (err) {
      setChosen(null);
      setError(messageFor(err));
    }
  }

  async function openEventTemplate(card) {
    setError(null);
    setChosen({ kind: 'event', card, full: null });
    try {
      setChosen({ kind: 'event', card, full: await get(`/organizer/templates/${card.id}`, { cache: 'no-store', noRedirect: true }) });
    } catch (err) {
      setChosen(null);
      setError(messageFor(err));
    }
  }

  // Opened on one map: its preview, once the library has loaded (once).
  const opened = useRef(false);
  useEffect(() => {
    if (!initialId || !data || opened.current) return undefined;
    opened.current = true;
    const card = [...(data.forVenue || []), ...(data.library || []), ...(data.mine || [])].find((t) => t.id === initialId);
    if (!card) return undefined;
    let live = true;
    get(`/organizer/venue-maps/${card.id}`, { cache: 'no-store', noRedirect: true }).then(
      (full) => { if (live) setChosen({ kind: 'venue', card, full }); },
      (err) => { if (live) setError(messageFor(err)); },
    );
    return () => { live = false; };
  }, [data, initialId]);

  function use() {
    if (chosen.kind === 'venue') {
      onApply(toEditorSpec(chosen.full.data, categories));
      post(`/organizer/venue-maps/${chosen.card.id}/used`, {}, { noRedirect: true }).catch(() => {});
      return;
    }
    onApply(eventTemplateSpec(chosen.full.data, tiers, categories));
  }

  if (chosen) {
    const title = chosen.kind === 'venue' ? `${chosen.card.venue.name} — ${chosen.card.name}` : chosen.card.name;
    return (
      <TemplateDialog id="map-tpl" title={title} onClose={onClose} wide>
        {!chosen.full ? <Loading variant="card" />
          : chosen.kind === 'venue' ? <VenueMapPreview template={chosen.full} /> : <TemplatePreview template={chosen.full} />}
        {blocked && <p className="es-notice es-notice--warning" role="alert">{blocked}</p>}
        {!blocked && replacing && (
          <p className="es-notice es-notice--warning" role="status">
            This replaces the map you have now. Undo puts it back, and nothing is saved until Save map.
          </p>
        )}
        <div className="fx-row fx-row--between gap-2 border-t border-border-base pt-3">
          <button type="button" className="es-btn es-btn--ghost" onClick={() => setChosen(null)}>Back</button>
          <button type="button" className="es-btn es-btn--primary" disabled={!chosen.full || Boolean(blocked)} onClick={use}>Use this map</button>
        </div>
      </TemplateDialog>
    );
  }

  const term = q.trim().toLowerCase();
  const matches = (t) => !term || [t.venue?.name, t.venue?.city, t.name, t.venue?.country].some((s) => String(s || '').toLowerCase().includes(term));
  const list = (current === 'mine' ? mine : library).filter(matches);
  const eventMaps = (eventTpl.data ? [...(eventTpl.data.mine || []), ...(eventTpl.data.eventsli || [])] : []).filter((t) => t.summary?.hasMap);

  return (
    <TemplateDialog id="map-tpl" title="Start from a ready-made map" onClose={onClose} wide>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data && data.enabled === false && <p className="es-notice es-notice--info" role="status">The venue map library is being switched on. Event templates still work.</p>}

      {forVenue.length > 0 && (
        <section className="es-vmhere" aria-labelledby="vm-here-title">
          <h3 id="vm-here-title" className="es-vmhere__title"><NavIcon name="pin" size={16} /> Ready for {data.venue?.name || 'this venue'}</h3>
          <div className="es-vmpickgrid">
            {forVenue.map((t) => (
              <VenueMapCard key={t.id} template={t} compact onOpen={() => openVenueMap(t)}
                badges={[{ label: t.scope === 'platform' ? 'Eventsli' : 'Yours', tone: t.scope === 'platform' ? 'brand' : 'neutral' }, ...(t.verified ? [{ label: 'Verified', tone: 'success' }] : [])]} />
            ))}
          </div>
        </section>
      )}

      <div className="es-vmfilters">
        <Segmented
          label="Which maps" value={current} onChange={setTab}
          options={[
            { value: 'library', label: 'Venue library', count: library.length },
            { value: 'mine', label: 'Your maps', count: mine.length },
            { value: 'events', label: 'Event templates' },
          ]}
        />
        {current !== 'events' && (
          <label className="es-vmfilters__search">
            <span className="sr-only">Search maps</span>
            <input type="search" className="es-input" value={q} placeholder="Venue, city or layout" onChange={(e) => setQ(e.target.value)} />
          </label>
        )}
      </div>

      {current === 'events' ? (
        eventTpl.loading && !eventTpl.data ? <Loading variant="list" rows={3} /> : eventMaps.length === 0 ? (
          <Empty icon="copy" title="No event templates with a map" hint="Save an event as a template on Templates to reuse its whole setup." />
        ) : (
          <>
            <p className="text-sm text-muted">The map from a whole event template. Tables keep their ticket type when this event has one with the same name.</p>
            <ul className="es-tplpick">
              {eventMaps.map((t) => (
                <li key={t.id}>
                  <button type="button" className="es-tplpick__item" onClick={() => openEventTemplate(t)}>
                    <b className="fx-truncate">{t.name}</b>
                    <small>{[t.scope === 'platform' ? 'Eventsli' : 'Yours', ...templateFacts(t.summary)].join(' · ')}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      ) : loading && !data ? <Loading variant="list" rows={3} /> : list.length === 0 ? (
        term ? <Empty icon="search" title="No maps match" hint="Try the venue’s name or its city." />
          : current === 'mine'
            ? <Empty icon="map" title="No saved maps yet" hint="Draw a map you will use again, save it, then choose Save as template above the canvas." />
            : <Empty icon="building" title="The venue library is on its way" hint="Eventsli is adding maps of popular venues. Your own saved maps are under Your maps." />
      ) : (
        <div className="es-vmpickgrid">
          {list.map((t) => (
            <VenueMapCard key={t.id} template={t} compact onOpen={() => openVenueMap(t)}
              badges={[...(t.verified ? [{ label: 'Verified', tone: 'success' }] : []), ...(t.featured ? [{ label: 'Featured', tone: 'highlight' }] : [])]} />
          ))}
        </div>
      )}
    </TemplateDialog>
  );
}

/** An event template's map, as before: tables keep their ticket type and category by name. */
function eventTemplateSpec(d, tiers, categories) {
  const layout = d.map.layout || {};
  const tierByName = new Map(tiers.map((t) => [String(t.name).trim().toLowerCase(), t.id]));
  const catByName = new Map(categories.map((c) => [String(c.name).trim().toLowerCase(), c.id]));
  const tierName = new Map((d.tiers || []).map((t) => [t.key, String(t.name).trim().toLowerCase()]));
  const catName = new Map((d.categories || []).map((c) => [c.key, String(c.name).trim().toLowerCase()]));
  const styles = readTableStyles(layout);
  return {
    tables: d.map.tables.map((t) => ({
      label: t.label,
      seatCount: t.seatCount,
      priceCents: t.priceCents ?? null,
      shape: t.shape,
      position: t.position,
      tierId: t.tierKey ? tierByName.get(tierName.get(t.tierKey)) || null : null,
      categoryId: t.categoryKey ? catByName.get(catName.get(t.categoryKey)) || null : null,
      seatPriceCents: t.seatPriceCents ?? null,
      style: styles.get(String(t.label).trim().toLowerCase()) || null,
    })),
    zones: readZones(layout),
    world: worldOf(layout),
    look: readLook(layout),
    sections: readStudio(layout).sections,
  };
}
