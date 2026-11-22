'use client';

import { useState } from 'react';
import NavIcon from '../../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "GETTING THERE" (owner, 2026-11-22: "make this part very amazing and
 * professional"). It was a heading, two lines of text and one button.
 *
 * Now one card: a map panel beside the venue's details on a laptop, stacked
 * on a phone. The details lead with the venue's name, then the address and
 * the city; under them "Get directions", "Copy address", and the three map
 * apps people actually use.
 *
 * THE MAP PANEL LOADS NOTHING FROM A THIRD PARTY until it is asked to (owner,
 * 2026-11-20; the owner's own network blocks openstreetmap.org). Until then it
 * is our own drawing — streets, a park, a river, and the pin — which is
 * decoration, hidden from screen readers. With a pin set by the organizer,
 * "Show live map" swaps in OpenStreetMap's published embed (no key, no
 * billing; the attribution is its licence condition). Without a pin there is
 * no live map, and the drawing stays.
 *
 * Every link is built from the venue's NAME and address, not the pin, when
 * there is text: a pin dropped by hand lands in the car park, the name lands
 * on the building.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function VenueCard({ venue, address, city, country, location }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  const place = [city, regionName(country)].filter(Boolean).join(', ');
  // The address line, with the city added when the address does not already say it.
  const full = [venue, address, city && !String(address || '').toLowerCase().includes(city.toLowerCase()) ? city : null]
    .filter(Boolean).join(', ');
  const text = full || (location ? `${location.lat},${location.lng}` : '');
  if (!text) return null;
  const q = encodeURIComponent(text);
  const ll = location ? `${location.lat},${location.lng}` : null;

  const links = {
    directions: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    apple: `https://maps.apple.com/?q=${q}${ll ? `&ll=${ll}` : ''}`,
    waze: ll ? `https://waze.com/ul?ll=${ll}&navigate=yes` : `https://waze.com/ul?q=${q}&navigate=yes`,
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText([venue, address, place].filter(Boolean).join(', '));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard (an old browser, or permission refused): the address is
      // on the screen to select by hand, so there is nothing to recover.
    }
  }

  return (
    <section className="es-vcard" aria-labelledby="event-map">
      <header className="es-vcard__head">
        <p className="es-vcard__eyebrow"><NavIcon name="pin" size={15} />Venue</p>
        <h2 id="event-map" className="es-vcard__title">Getting there</h2>
      </header>

      <div className="es-vcard__body">
        <div className={`es-vcard__map${shown && location ? ' is-live' : ''}`}>
          {shown && location ? (
            <LiveMap location={location} venue={venue} />
          ) : (
            <>
              <MapArt />
              <span className="es-vcard__pin" aria-hidden="true">
                <span className="es-vcard__pulse" />
                <NavIcon name="pin" size={24} />
              </span>
              {location && (
                <button type="button" className="es-vcard__show" onClick={() => setShown(true)}>
                  <NavIcon name="map" size={16} />Show live map
                </button>
              )}
            </>
          )}
        </div>

        <div className="es-vcard__info">
          {place && <p className="es-vcard__place"><NavIcon name="globe" size={14} />{place}</p>}
          {venue && <h3 className="es-vcard__name fx-break">{venue}</h3>}
          {address && (
            <p className="es-vcard__addr fx-break">
              <NavIcon name="pin" size={16} />
              <span>{address}</span>
            </p>
          )}

          <div className="es-vcard__actions">
            <a href={links.directions} target="_blank" rel="noreferrer noopener" className="es-btn es-btn--primary es-vcard__go">
              <NavIcon name="send" size={17} />Get directions
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <button type="button" onClick={copy} className="es-btn es-btn--secondary es-vcard__copy" aria-live="polite">
              <NavIcon name={copied ? 'check' : 'copy'} size={17} />{copied ? 'Copied' : 'Copy address'}
            </button>
          </div>

          <div className="es-vcard__apps">
            <span className="es-vcard__apps-label">Open in</span>
            <ul>
              <li><a href={links.google} target="_blank" rel="noreferrer noopener">Google Maps<NavIcon name="arrowUpRight" size={13} /></a></li>
              <li><a href={links.apple} target="_blank" rel="noreferrer noopener">Apple Maps<NavIcon name="arrowUpRight" size={13} /></a></li>
              <li><a href={links.waze} target="_blank" rel="noreferrer noopener">Waze<NavIcon name="arrowUpRight" size={13} /></a></li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/** "CA" → "Canada"; anything unreadable is left out rather than shown raw. */
function regionName(code) {
  if (!code || String(code).length !== 2) return null;
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(String(code).toUpperCase()) || null; } catch { return null; }
}

/** OpenStreetMap's embed — about half a kilometre around the pin. */
function LiveMap({ location, venue }) {
  const { lat, lng } = location;
  const d = 0.004;
  const bbox = [lng - d, lat - d, lng + d, lat + d].join(',');
  return (
    <>
      <iframe
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`}
        title={venue ? `Map showing ${venue}` : 'Map showing the venue'}
        // Framed and nothing more: `allow=""` withholds every feature policy.
        referrerPolicy="no-referrer"
        allow=""
      />
      <a
        className="es-vcard__credit"
        href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        © OpenStreetMap contributors
      </a>
    </>
  );
}

/** Our own street drawing — decoration only, never a real map. */
function MapArt() {
  return (
    <svg className="es-vcard__art" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="400" height="260" className="es-vcard__land" />
      <path d="M250 -10 C 290 60, 230 120, 300 170 S 360 260, 420 280 L 420 -10 Z" className="es-vcard__water" />
      <rect x="78" y="212" width="106" height="44" rx="12" className="es-vcard__park" />
      <rect x="10" y="145" width="38" height="44" rx="8" className="es-vcard__park" />
      <rect x="78" y="12" width="106" height="26" rx="8" className="es-vcard__block" />
      <rect x="78" y="86" width="106" height="32" rx="8" className="es-vcard__block" />
      <rect x="78" y="145" width="106" height="44" rx="8" className="es-vcard__block" />
      <rect x="10" y="80" width="38" height="38" rx="8" className="es-vcard__block" />
      <rect x="10" y="212" width="38" height="40" rx="8" className="es-vcard__block" />
      <rect x="214" y="145" width="36" height="44" rx="8" className="es-vcard__block" />
      <g className="es-vcard__street">
        <path d="M-10 62 C 80 72, 160 44, 240 82" />
        <path d="M-10 200 H 262" />
        <path d="M62 -10 V 270" />
      </g>
      <g className="es-vcard__road">
        <path d="M-10 130 H 410" />
        <path d="M200 -10 V 270" />
      </g>
    </svg>
  );
}
