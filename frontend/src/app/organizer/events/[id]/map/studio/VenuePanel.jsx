'use client';

import { useRef, useState } from 'react';
import NavIcon from '../../../../../components/shell/NavIcon';
import { messageFor } from '../../../../../utils/errors';
import { useEventContext } from '../../EventContext';
import { VENUE_TYPES, ACCESS_FEATURES, capacityOf } from '../../../../../components/venue/venueModel';
import { zoneLabel } from '../../../../../components/seating/venueZones';
import { uploadStudioImage } from './uploadStudioImage';
import { TextField, NumberField, SelectField } from './fields';
import VenueSizeCard from './VenueSizeCard';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Step one: the venue itself. Its name, kind, photo, standing room and what a
 * guest with a wheelchair or a hearing aid should know before they buy.
 *
 * WHAT CAN BE COUNTED IS COUNTED, NOT ASKED. Seated capacity is the sum of the
 * seats drawn; entrances are the entrance areas on the map. Typing either here
 * would be a second copy of a fact that already lives on the map, and the
 * copies would disagree by the first edit.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenuePanel({
  eventId, venue, onChange, tables, zones, sections, world, onResizeWorld,
}) {
  const event = useEventContext()?.event;
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const cap = capacityOf(tables, venue);
  const entrances = zones.filter((z) => z.kind === 'entrance').map(zoneLabel);
  const accessibleAreas = zones.filter((z) => z.kind === 'accessible').length;

  async function onFile(file) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const asset = await uploadStudioImage(eventId, file, 'venue');
      onChange({ photo: { path: asset.path, url: asset.url } });
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const toggleAccess = (key) => onChange({
    access: venue.access.includes(key) ? venue.access.filter((k) => k !== key) : [...venue.access, key],
  });

  return (
    <div className="es-studio-split">
      <section className="es-dcard fx-stack" aria-labelledby="venue-details">
        <div>
          <h2 id="venue-details" className="es-dcard__title">Venue details</h2>
          <p className="es-ovcard__desc">Shown to buyers beside the seat map, so they know the room before choosing in it.</p>
        </div>
        <div className="fx-grid" style={{ '--fx-col': '220px', '--fx-gap': '14px' }}>
          <TextField
            label="Venue name" value={venue.name} onChange={(name) => onChange({ name })} maxLength={120}
            placeholder={event?.venue?.name || 'e.g. Riverside Arena'}
            hint={event?.venue?.name && !venue.name ? `Left empty, it uses the event's venue: ${event.venue.name}.` : null}
          />
          <SelectField
            label="Kind of venue" value={venue.type} onChange={(type) => onChange({ type })}
            options={VENUE_TYPES.map((t) => [t.key, t.label])}
          />
          <NumberField
            label="Standing capacity" value={venue.standingCapacity} min={0} max={200000}
            onChange={(v) => onChange({ standingCapacity: v === '' ? 0 : v })}
            hint="People in standing areas, on top of the seats drawn."
          />
        </div>

        <fieldset className="fx-stack gap-2">
          <legend className="mb-1 text-sm text-ink">Accessibility</legend>
          <div className="fx-row gap-2">
            {ACCESS_FEATURES.map((a) => {
              const on = venue.access.includes(a.key);
              return (
                <label key={a.key} className={`es-chip ${on ? 'es-chip--on' : ''}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleAccess(a.key)} />
                  {on && <NavIcon name="tick" size={14} />}
                  {a.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="fx-stack gap-1.5">
          <label htmlFor="venue-notes" className="text-sm text-ink">Notes for buyers</label>
          <textarea
            id="venue-notes" className="es-input" rows={3} maxLength={600} value={venue.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
            placeholder="Doors open an hour before. Bags are checked at Entrance A. Lifts to every level."
          />
          <p className="text-xs text-subtle">{600 - venue.notes.length} characters left</p>
        </div>
      </section>

      <div className="fx-stack">
        <section className="es-dcard fx-stack" aria-labelledby="venue-photo">
          <h2 id="venue-photo" className="es-dcard__title">Venue photo</h2>
          {venue.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={venue.photo.url} alt="" className="es-studio-photo" />
          ) : (
            <button type="button" className="es-studio-drop" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <NavIcon name="image" size={28} />
              <b>{uploading ? 'Uploading…' : 'Add a photo of the venue'}</b>
              <small>JPEG, PNG or WebP. Resized for you.</small>
            </button>
          )}
          <input
            ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only"
            aria-label="Venue photo" onChange={(e) => onFile(e.target.files?.[0])}
          />
          {venue.photo && (
            <div className="fx-row gap-2">
              <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Replace'}
              </button>
              <button type="button" className="es-btn es-btn--ghost es-btn--sm" onClick={() => onChange({ photo: null })}>Remove</button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-danger">{messageFor(error)}</p>}
        </section>

        <VenueSizeCard world={world} onResize={onResizeWorld} />

        <section className="es-dcard fx-stack" aria-labelledby="venue-facts">
          <h2 id="venue-facts" className="es-dcard__title">From your map</h2>
          <dl className="es-studio-facts">
            <div><dt>Capacity</dt><dd className="es-nums">{cap.total.toLocaleString('en')}</dd></div>
            <div><dt>Seats</dt><dd className="es-nums">{cap.seated.toLocaleString('en')}</dd></div>
            <div><dt>Sections</dt><dd className="es-nums">{sections.length}</dd></div>
            <div><dt>Accessible areas</dt><dd className="es-nums">{accessibleAreas}</dd></div>
          </dl>
          <p className="text-sm text-muted">
            <NavIcon name="door" size={16} />{' '}
            {entrances.length ? `Entrances: ${entrances.join(', ')}` : 'No entrances on the map yet. Add them as areas in Layout.'}
          </p>
        </section>
      </div>
    </div>
  );
}
