'use client';

import { VENUE_TYPES, ACCESS_FEATURES, capacityOf } from './venueModel';
import { zoneLabel } from '../seating/venueZones';
import NavIcon from '../shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The room, in words, beside the map: what kind of venue, how big, where the
 * doors are, what access it has, and the organizer's notes.
 *
 * The questions a buyer asks before choosing a seat, especially one with a
 * wheelchair or a hearing aid, answered where the choosing happens rather than
 * in an email afterwards. Shown only when the organizer said something here
 * that a bare map does not already say.
 *
 * Laid out as in the owner's mockup (2026-11-10): the card's title, the
 * venue's name beside a pin, one line per fact with its icon, and the venue's
 * photo across the foot of the card.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueInfoCard({ venue, tables, zones, fallbackName = '' }) {
  const entrances = zones.filter((z) => z.kind === 'entrance').map(zoneLabel);
  const access = ACCESS_FEATURES.filter((a) => venue.access.includes(a.key));
  const hasSomething = venue.name || venue.notes || venue.photo || access.length || entrances.length;
  if (!hasSomething) return null;
  const cap = capacityOf(tables, venue);
  const kind = VENUE_TYPES.find((t) => t.key === venue.type)?.label;
  const accessibleSeats = zones.some((z) => z.kind === 'accessible');

  return (
    <section className="es-venueinfo" aria-labelledby="venue-info-title">
      <h2 id="venue-info-title" className="es-venueinfo__heading">Venue info</h2>
      <p className="es-venueinfo__name"><NavIcon name="pin" size={20} />{venue.name || fallbackName || 'The venue'}</p>
      <ul className="es-venueinfo__facts">
        {kind && <li><NavIcon name="building" size={18} />{kind}</li>}
        {cap.total > 0 && <li><NavIcon name="users" size={18} />Capacity: {cap.total.toLocaleString('en')}</li>}
        {entrances.length > 0 && <li><NavIcon name="door" size={18} />Entrances: {entrances.join(', ')}</li>}
        {accessibleSeats && <li><NavIcon name="check" size={18} />Accessible seats: available</li>}
      </ul>
      {access.length > 0 && (
        <ul className="fx-row gap-2" aria-label="Accessibility">
          {access.map((a) => <li key={a.key} className="es-venueinfo__tag">{a.label}</li>)}
        </ul>
      )}
      {venue.notes && <p className="text-sm text-ink es-venueinfo__notes">{venue.notes}</p>}
      {venue.photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={venue.photo.url} alt="" className="es-venueinfo__photo" loading="lazy" />
      )}
    </section>
  );
}
