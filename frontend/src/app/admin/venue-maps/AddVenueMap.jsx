'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { get, post, put } from '../../utils/apiClient';
import { messageFor } from '../../utils/errors';
import NavIcon from '../../components/shell/NavIcon';
import TemplateDialog from '../../components/templates/TemplateDialog';
import PlaceAutocomplete from '../../components/forms/PlaceAutocomplete';
import { COUNTRY_OPTIONS } from '../../lib/markets';
import { VENUE_KINDS, fromImportedMap } from '../../components/venueMaps/venueMapData';
import ImageImportDialog from '../../organizer/events/[id]/map/style/ImageImportDialog';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Add a venue map (2026-11-24) — three steps, in the order a person thinks:
 *
 *   1 THE VENUE    venue search fills the name, address, city and Google
 *                  place (the key that later says "Eventsli has a map of
 *                  this venue" to an organizer booking it); the country and
 *                  the kind are chosen
 *   2 THE MAP      from an event already held there — found by that place,
 *                  else by name and city — or any event by title; or from
 *                  the venue's seating-chart picture, read by AI and checked
 *                  side by side (the Venue Builder's own import dialog)
 *   3 THE LAYOUT   its name ("Concert — end stage"), notes, the credit, and
 *                  whether it was checked against the real room
 *
 * It is saved as a DRAFT. With `replace`, only step 2: a new map for an
 * existing Eventsli template.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const STEPS = ['Venue', 'Map', 'Layout'];
const LIBRARY = {
  start: '/admin/venue-maps/read-image',
  job: (id) => `/admin/venue-maps/read-image/${id}`,
  applyLabel: 'Use this map',
};

export default function AddVenueMap({ replace = null, fromEventId = null, onClose, onCreated }) {
  const [step, setStep] = useState(replace ? 1 : 0);
  const [venue, setVenue] = useState({ name: '', address: '', city: '', region: '', country: '', placeId: null, lat: null, lng: null, kind: 'arena' });
  const [source, setSource] = useState(null);        // { eventId, title } | { data, report }
  const [details, setDetails] = useState({ name: '', description: '', sourceNote: '', verified: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Where step 2 takes the map from, and whether the picture reader is open.
  // The reader REPLACES this dialog while it is open (one modal at a time:
  // two would both answer Tab and Escape), and everything here is kept.
  const [mode, setMode] = useState('event');
  const [reading, setReading] = useState(false);

  // From an event's admin page (?from=<eventId>): its venue and its map,
  // filled in — the admin checks them and names the layout.
  useEffect(() => {
    if (!fromEventId) return undefined;
    let live = true;
    (async () => {
      try {
        const d = await get('/admin/events/' + fromEventId, { cache: 'no-store', noRedirect: true });
        const e = d?.event;
        if (!live || !e) return;
        setVenue((v) => ({
          ...v, name: e.venue?.name || e.venueName || '', address: e.venueAddress || '', city: e.city || '',
          country: e.country || '', placeId: e.venuePlaceId || null,
        }));
        setSource({ eventId: e.id, title: e.title });
      } catch { /* the admin fills the venue in by hand */ }
    })();
    return () => { live = false; };
  }, [fromEventId]);
  const set = (k) => (e) => setVenue((v) => ({ ...v, [k]: e.target.value }));
  const setD = (k) => (e) => setDetails((d) => ({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const venueReady = venue.name.trim().length >= 2;
  const mapReady = Boolean(source);

  async function submit() {
    setBusy(true);
    setError(null);
    const from = source.eventId ? { eventId: source.eventId } : { data: source.data };
    try {
      const t = replace
        ? await put(`/admin/venue-maps/${replace.id}/map`, from, { noRedirect: true })
        : await post('/admin/venue-maps', {
          ...from,
          venue: {
            name: venue.name.trim(), address: venue.address.trim() || null, city: venue.city.trim() || null,
            region: venue.region?.trim() || null, country: venue.country || null, placeId: venue.placeId,
            lat: venue.lat, lng: venue.lng, kind: venue.kind,
          },
          ...(details.name.trim() ? { name: details.name.trim() } : {}),
          description: details.description.trim() || null,
          sourceNote: details.sourceNote.trim() || null,
          verified: details.verified,
        }, { noRedirect: true });
      onCreated(t);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (reading) {
    return (
      <ImageImportDialog
        library={LIBRARY}
        replacing={false}
        onClose={() => setReading(false)}
        onApply={(map) => { setSource({ data: fromImportedMap(map), report: map.report }); setReading(false); }}
      />
    );
  }

  const title = replace ? `New map for ${replace.venue.name}` : 'Add a venue map';
  return (
    <TemplateDialog id="vm-add" title={title} onClose={onClose} wide>
      {!replace && (
        <ol className="es-vmsteps" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} data-state={i < step ? 'done' : i === step ? 'current' : 'next'} aria-current={i === step ? 'step' : undefined}>
              <span aria-hidden="true">{i < step ? <NavIcon name="tick" size={13} /> : i + 1}</span>{s}
            </li>
          ))}
        </ol>
      )}

      {step === 0 && (
        <div className="fx-stack fx-stack--sm gap-3">
          <PlaceAutocomplete
            label="Venue"
            value={venue.name}
            country={venue.country || undefined}
            hint="Search for it to fill the address and pin, or type the name yourself."
            onChange={(name) => setVenue((v) => ({ ...v, name, placeId: null, lat: null, lng: null }))}
            onPlace={(p) => setVenue((v) => ({
              ...v, name: p.name || v.name, address: p.address || '', city: p.city || v.city, region: p.region || '',
              placeId: p.placeId || null, lat: p.lat ?? null, lng: p.lng ?? null,
            }))}
          />
          <div className="es-tplform-grid">
            <Field id="vm-city" label="City"><input id="vm-city" className="es-input" maxLength={120} value={venue.city} onChange={set('city')} /></Field>
            <Field id="vm-country" label="Country">
              <select id="vm-country" className="es-input" value={venue.country} onChange={set('country')}>
                <option value="">Choose</option>
                {COUNTRY_OPTIONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </Field>
            <Field id="vm-kind" label="Kind of venue">
              <select id="vm-kind" className="es-input" value={venue.kind} onChange={set('kind')}>
                {VENUE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </Field>
          </div>
          <Field id="vm-address" label="Address (optional)"><input id="vm-address" className="es-input" maxLength={300} value={venue.address} onChange={set('address')} /></Field>
          {venue.placeId && <p className="es-vmpinned"><NavIcon name="pin" size={14} /> Linked to the venue on the map — organizers booking it will be offered this layout first.</p>}
        </div>
      )}

      {step === 1 && <MapSource venue={venue} replace={replace} source={source} onSource={setSource} mode={mode} onMode={setMode} onRead={() => setReading(true)} />}

      {step === 2 && (
        <div className="fx-stack fx-stack--sm gap-3">
          <Field id="vm-name" label="Layout name">
            <input id="vm-name" className="es-input" maxLength={80} value={details.name} placeholder="Concert — end stage" onChange={setD('name')} />
          </Field>
          <Field id="vm-desc" label="Notes for organizers (optional)">
            <textarea id="vm-desc" className="es-input" rows={3} maxLength={500} value={details.description} placeholder="Floor standing in front, two tiers of seated sections." onChange={setD('description')} />
          </Field>
          <Field id="vm-credit" label="Source (optional)">
            <input id="vm-credit" className="es-input" maxLength={300} value={details.sourceNote} placeholder="Based on the venue’s published seating chart, 2026" onChange={setD('sourceNote')} />
          </Field>
          <label className="fx-row items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={details.verified} onChange={setD('verified')} /> Checked against the real venue — shows a Verified badge
          </label>
          <p className="text-xs text-subtle">It is saved as a draft only admins see. Preview it, then publish it for every organizer.</p>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
      <div className="fx-row fx-row--between gap-2 border-t border-border-base pt-3">
        {step > (replace ? 1 : 0)
          ? <button type="button" className="es-btn es-btn--ghost" onClick={() => setStep((s) => s - 1)}>Back</button>
          : <button type="button" className="es-btn es-btn--ghost" onClick={onClose}>Cancel</button>}
        {replace || step === 2 ? (
          <button type="button" className="es-btn es-btn--primary" disabled={busy || !mapReady} onClick={submit}>
            {busy ? 'Saving…' : replace ? 'Use this map' : 'Save draft'}
          </button>
        ) : (
          <button type="button" className="es-btn es-btn--primary" disabled={step === 0 ? !venueReady : !mapReady} onClick={() => setStep((s) => s + 1)}>Next</button>
        )}
      </div>
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

/** Step 2: an event's map (held at this venue, or any) or a seating-chart picture. */
function MapSource({ venue, replace, source, onSource, mode, onMode, onRead }) {
  const v = replace?.venue || venue;
  const [search, setSearch] = useState('');
  const here = v.placeId
    ? `/admin/venue-maps/venue-events?placeId=${encodeURIComponent(v.placeId)}`
    : v.name ? `/admin/venue-maps/venue-events?name=${encodeURIComponent(v.name)}${v.city ? `&city=${encodeURIComponent(v.city)}` : ''}` : null;
  const { data: atVenue, loading } = useApi(mode === 'event' ? here : null);
  const { data: found } = useApi(mode === 'event' && search.trim().length >= 2 ? `/admin/events?limit=8&q=${encodeURIComponent(search.trim())}` : null, { raw: true });
  const results = found?.data || [];

  return (
    <div className="fx-stack fx-stack--sm gap-3">
      <div className="es-vmsource" role="radiogroup" aria-label="Where the map comes from">
        <button type="button" role="radio" aria-checked={mode === 'event'} className="es-vmsource__tile" onClick={() => onMode('event')}>
          <NavIcon name="calendar" size={20} /><span><b>An event held here</b><small>Copy a map already drawn on Eventsli</small></span>
        </button>
        <button type="button" role="radio" aria-checked={mode === 'picture'} className="es-vmsource__tile" onClick={() => onMode('picture')}>
          <NavIcon name="image" size={20} /><span><b>A seating-chart picture</b><small>AI rebuilds it; you check it side by side</small></span>
        </button>
      </div>

      {mode === 'event' && (
        <>
          <p className="text-sm text-muted">Events at <b>{v.name}</b>{v.city ? `, ${v.city}` : ''} with a map:</p>
          {loading && !atVenue ? <p className="text-sm text-subtle">Looking…</p>
            : (atVenue || []).length === 0 ? <p className="text-sm text-subtle">None yet. Search any event by title below, or use a picture.</p>
              : <EventPick list={atVenue.map((e) => ({ id: e.id, title: e.title, note: [e.organizerName, e.tables ? `${e.tables} tables or rows` : 'areas only', e.status].filter(Boolean).join(' · ') }))} source={source} onSource={onSource} />}
          <div className="fx-stack fx-stack--sm gap-1.5">
            <label htmlFor="vm-ev-search" className="text-sm text-ink">Any event</label>
            <input id="vm-ev-search" className="es-input" value={search} placeholder="Search events by title" onChange={(e) => setSearch(e.target.value)} />
          </div>
          {results.length > 0 && (
            <EventPick list={results.map((e) => ({ id: e.id, title: e.title, note: [e.organizer?.name, e.city, e.status].filter(Boolean).join(' · ') }))} source={source} onSource={onSource} />
          )}
        </>
      )}

      {mode === 'picture' && (
        <div className="es-vmpicture">
          {source?.data ? (
            <p className="text-sm text-ink"><NavIcon name="tick" size={15} /> Read from the picture: <b className="es-nums">{source.report.tables}</b> tables or rows, <b className="es-nums">{source.report.seats.toLocaleString('en')}</b> seats, <b className="es-nums">{source.report.areas}</b> areas.</p>
          ) : (
            <p className="text-sm text-muted">Upload the venue’s seating chart — from its website or a ticketing page, straight-on and uncropped. Every section, row, table and area is rebuilt, and you compare it with the picture before using it.</p>
          )}
          <button type="button" className="es-btn es-btn--secondary" onClick={onRead}>
            <NavIcon name="sparkle" size={16} />{source?.data ? 'Read another picture' : 'Read a seating chart'}
          </button>
        </div>
      )}

    </div>
  );
}

function EventPick({ list, source, onSource }) {
  return (
    <ul className="es-tplpick" aria-label="Events">
      {list.map((e) => (
        <li key={e.id}>
          <button type="button" className="es-tplpick__item" aria-pressed={source?.eventId === e.id} onClick={() => onSource({ eventId: e.id, title: e.title })}>
            <b className="fx-truncate">{e.title}</b>
            <small>{e.note}</small>
          </button>
        </li>
      ))}
    </ul>
  );
}
