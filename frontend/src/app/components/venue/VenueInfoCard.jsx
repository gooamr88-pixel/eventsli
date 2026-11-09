'use client';

import { VENUE_TYPES, ACCESS_FEATURES, capacityOf } from './venueModel';
import { zoneLabel } from '../seating/venueZones';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The room, in words, under the map: what kind of venue, how big, where the
 * doors are, what access it has, and the organizer's notes.
 *
 * The questions a buyer asks before choosing a seat, especially one with a
 * wheelchair or a hearing aid, answered where the choosing happens rather than
 * in an email afterwards. Shown only when the organizer said something here
 * that a bare map does not already say.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueInfoCard({ venue, tables, zones, fallbackName = '' }) {
  const entrances = zones.filter((z) => z.kind === 'entrance').map(zoneLabel);
  const access = ACCESS_FEATURES.filter((a) => venue.access.includes(a.key));
  const hasSomething = venue.name || venue.notes || venue.photo || access.length || entrances.length;
  if (!hasSomething) return null;
  const cap = capacityOf(tables, venue);
  const kind = VENUE_TYPES.find((t) => t.key === venue.type)?.label;

  return (
    <section className="es-venueinfo" aria-labelledby="venue-info-title">
      {venue.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={venue.photo.url} alt="" className="es-venueinfo__photo" loading="lazy" />
      )}
      <div className="fx-stack gap-2 fx-min0">
        <div>
          <h2 id="venue-info-title" className="es-venueinfo__title">{venue.name || fallbackName || 'The venue'}</h2>
          <p className="text-sm text-muted">
            {kind}{cap.total > 0 && ` · ${cap.total.toLocaleString('en')} capacity`}
            {entrances.length > 0 && ` · Entrances: ${entrances.join(', ')}`}
          </p>
        </div>
        {access.length > 0 && (
          <ul className="fx-row gap-2" aria-label="Accessibility">
            {access.map((a) => <li key={a.key} className="es-venueinfo__tag">{a.label}</li>)}
          </ul>
        )}
        {venue.notes && <p className="text-sm text-ink es-venueinfo__notes">{venue.notes}</p>}
      </div>
    </section>
  );
}
