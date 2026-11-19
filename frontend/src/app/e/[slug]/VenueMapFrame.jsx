'use client';

import { useState } from 'react';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The map in "Getting there" — LOADED ON REQUEST (owner, 2026-11-20).
 *
 * It used to be an OpenStreetMap iframe at 16:9 across the whole column:
 * ~850px of map on a laptop, "very large". And on networks that block
 * openstreetmap.org (the owner's own provider does, as it does Supabase) that
 * whole area was the browser's broken-page icon.
 *
 * Now the page shows a short card — a pin and "Show map" — and nothing from a
 * third party loads until someone asks. Shown, the map is capped at a sensible
 * height. "Open in Maps" beside it (EventSections.VenueMap) works either way.
 *
 * OpenStreetMap's published embed, not Google's: the Maps Embed API needs a
 * key in the client bundle, billing behind it and a quota that fails closed.
 * The attribution link is OSM's licence condition, not decoration. Without a
 * pin (set in the organizer's Page & branding) there is no map, only the
 * address and "Open in Maps".
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueMapFrame({ location, venue }) {
  const [shown, setShown] = useState(false);
  if (!location) return null;
  const { lat, lng } = location;

  if (!shown) {
    return (
      <div className="es-venue__peek">
        <span className="es-venue__pin" aria-hidden="true"><NavIcon name="pin" size={22} /></span>
        <button type="button" className="es-btn es-btn--secondary es-btn--sm" onClick={() => setShown(true)}>
          <NavIcon name="map" size={16} /> Show map
        </button>
      </div>
    );
  }

  // A window of roughly half a kilometre — close enough to see the street the
  // venue is on, wide enough to show the junction somebody is arriving from.
  const d = 0.004;
  const bbox = [lng - d, lat - d, lng + d, lat + d].join(',');
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;

  return (
    <div className="es-venue__map">
      <iframe
        src={src}
        title={venue ? `Map showing ${venue}` : 'Map showing the venue'}
        // Framed and nothing more: no scripts of ours inside, no permissions
        // granted out. `allow=""` withholds every feature policy by default.
        referrerPolicy="no-referrer"
        allow=""
      />
      <a
        className="es-venue__credit"
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
