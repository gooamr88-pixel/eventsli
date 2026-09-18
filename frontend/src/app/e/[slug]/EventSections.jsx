import Image from 'next/image';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * The event page's content sections: highlights, schedule, sponsors, policies,
 * and the venue map.
 *
 * ALL SERVER COMPONENTS. None of them has state, a handler or an effect — they
 * are text and pictures rendered from data the page already has. Marking them
 * `'use client'` would ship their markup twice, once as HTML and again as a
 * hydration payload, for behaviour none of them has. The gallery is the one
 * exception in this folder, because a lightbox genuinely is behaviour.
 *
 * EVERY SECTION RETURNS NULL WHEN EMPTY. A heading over nothing tells the
 * reader the organizer forgot something, when in fact most events have no
 * sponsors and that is unremarkable. The page is built from what exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The facts people scan for before they read anything: doors, age limit,
 * parking. Set as pills rather than a list, because they are read in any order
 * and none is more important than another.
 */
export function EventHighlights({ items = [] }) {
  if (items.length === 0) return null;
  return (
    <ul className="fx-row flex-wrap gap-2" aria-label="Event highlights">
      {items.map((text, i) => (
        <li
          key={`${text}-${i}`}
          className="rounded-full border border-border-base bg-bg-sunken px-3 py-1 text-sm text-ink"
        >
          {text}
        </li>
      ))}
    </ul>
  );
}

/**
 * The running order.
 *
 * Times are formatted in the EVENT's zone, not the reader's, and the zone is
 * named once at the end. A festival's 23:00 set is at 23:00 where the festival
 * is; rendering it in the reader's own zone would show a different number to
 * everyone who travels to it, which is everyone who needs the schedule.
 *
 * Rows without a time keep their place in the order rather than being dropped
 * to the bottom — an organizer who has not fixed the clock yet has still told
 * you what happens after what.
 */
export function EventSchedule({ items = [], timezone }) {
  if (items.length === 0) return null;

  const at = (iso) => {
    if (!iso) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone, weekday: 'short', hour: 'numeric', minute: '2-digit',
      }).format(new Date(iso));
    } catch {
      // An unknown zone must not take the schedule down with it.
      return new Date(iso).toISOString().slice(11, 16);
    }
  };

  return (
    <section className="fx-stack" aria-labelledby="event-schedule">
      <h2 id="event-schedule" className="text-lg">Schedule</h2>
      <ol className="fx-stack fx-stack--sm">
        {items.map((item) => (
          <li
            key={item.id}
            className="fx-row flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-border-base pt-3 first:border-0 first:pt-0"
          >
            <span className="es-nums w-28 shrink-0 text-sm font-medium text-ink">
              {at(item.startsAt) || <span className="text-subtle">—</span>}
            </span>
            <span className="fx-min0 flex-1">
              <span className="block text-ink">{item.title}</span>
              {item.location && <span className="block text-sm text-subtle">{item.location}</span>}
              {item.description && (
                <span className="mt-1 block whitespace-pre-line text-sm text-muted">{item.description}</span>
              )}
            </span>
          </li>
        ))}
      </ol>
      {items.some((i) => i.startsAt) && (
        <p className="text-xs text-subtle">All times are local to the venue ({timezone}).</p>
      )}
    </section>
  );
}

/**
 * Sponsors, grouped by level.
 *
 * The server sorts by level already; this only breaks them into labelled bands
 * and sizes each band by its standing — a headline sponsor's logo is drawn
 * larger than a partner's, which is the whole thing a sponsor is buying.
 *
 * A LOGO IS A LINK ONLY IF THERE IS ONE. A sponsor with no website is a name in
 * clean type, not a dead anchor — and `rel="noreferrer noopener"` on the ones
 * that do have links, because this page sends traffic to addresses an organizer
 * typed and the platform has not vetted.
 */
const SPONSOR_BANDS = [
  ['headline', 'Headline sponsor', 'h-20'],
  ['gold', 'Gold', 'h-16'],
  ['silver', 'Silver', 'h-12'],
  ['bronze', 'Bronze', 'h-12'],
  ['partner', 'Partners', 'h-10'],
];

export function EventSponsors({ items = [] }) {
  if (items.length === 0) return null;

  const bands = SPONSOR_BANDS
    .map(([level, label, height]) => ({
      level, label, height, list: items.filter((s) => s.level === level),
    }))
    .filter((band) => band.list.length > 0);

  return (
    <section className="fx-stack" aria-labelledby="event-sponsors">
      <h2 id="event-sponsors" className="text-lg">Sponsors &amp; partners</h2>
      {bands.map((band) => (
        <div key={band.level} className="fx-stack fx-stack--sm">
          <h3 className="es-eyebrow">
            {band.label}
            {/* "Partners" is already plural; the rest are singular labels that
                read wrong over three logos. */}
            {band.list.length > 1 && band.level !== 'partner' ? 's' : ''}
          </h3>
          <ul className="fx-row flex-wrap items-center gap-x-8 gap-y-4">
            {band.list.map((sponsor) => (
              <li key={sponsor.id}>
                <SponsorMark sponsor={sponsor} height={band.height} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function SponsorMark({ sponsor, height }) {
  const body = sponsor.logoUrl ? (
    <Image
      src={sponsor.logoUrl}
      alt={sponsor.name}
      width={220}
      height={80}
      className={`${height} w-auto object-contain`}
    />
  ) : (
    <span className="text-md font-medium text-ink">{sponsor.name}</span>
  );

  if (!sponsor.linkUrl) return <span className="grid place-items-center">{body}</span>;

  return (
    <a
      href={sponsor.linkUrl}
      target="_blank"
      rel="noreferrer noopener nofollow"
      className="grid place-items-center opacity-90 transition-opacity hover:opacity-100"
      // The logo alone would be announced as the alt text with no clue it
      // leaves the site.
      aria-label={`${sponsor.name} — opens their website in a new tab`}
    >
      {body}
    </a>
  );
}

/**
 * The organizer's policies.
 *
 * `<details>` rather than an accordion component: it opens without JavaScript,
 * it is searchable by the browser's own find-in-page in modern engines, and it
 * is announced correctly with no ARIA at all. A refund policy nobody can find
 * is the one that gets argued about.
 */
export function EventPolicies({ items = [] }) {
  if (items.length === 0) return null;
  return (
    <section className="fx-stack" aria-labelledby="event-policies">
      <h2 id="event-policies" className="text-lg">Good to know</h2>
      <div className="fx-stack fx-stack--sm">
        {items.map((policy) => (
          <details
            key={policy.id}
            className="rounded-(--es-radius-md) border border-border-base px-4 py-3"
          >
            <summary className="cursor-pointer text-ink marker:text-subtle">{policy.title}</summary>
            <div className="fx-break mt-2 max-w-[70ch] whitespace-pre-line text-sm text-muted">
              {policy.body}
            </div>
          </details>
        ))}
      </div>
      <p className="text-xs text-subtle">
        Set by the organizer for this event. Eventsli&apos;s own terms apply to every purchase.
      </p>
    </section>
  );
}

/**
 * Where the venue is.
 *
 * A STATIC LINK, NOT AN EMBEDDED MAP. An embed loads a third party's scripts
 * and cookies into the page for every visitor, needs an API key that would sit
 * in the client, and is the heaviest thing on an otherwise light page — all to
 * show a pin that most readers will open in their own maps app anyway. This
 * hands them straight to that app, with the venue name as the search so the
 * destination reads as a place rather than as two numbers.
 */
export function VenueMap({ venue, address, location }) {
  /**
   * A NAME OR AN ADDRESS IS ENOUGH — coordinates are not required.
   *
   * This returned `null` unless the organizer had pinned the venue on a map,
   * which meant an event with "MTELUS, 59 Rue Sainte-Catherine E" and no pin
   * showed no venue section at all, and the tab holding it disappeared with it.
   * Most organizers type an address and never open the map picker, so the
   * second thing every buyer checks was missing from most events.
   *
   * The link does not need the pin either: Maps resolves a text query at least
   * as well as a coordinate, and usually better — a pin dropped by hand lands
   * in the car park, the name lands on the building.
   */
  const text = `${venue || ''} ${address || ''}`.trim();
  if (!text && !location) return null;

  const query = encodeURIComponent(text || `${location.lat},${location.lng}`);
  const href = `https://www.google.com/maps/search/?api=1&query=${query}`;

  return (
    <section className="es-venue" aria-labelledby="event-map">
      <h2 id="event-map" className="text-lg">Getting there</h2>

      <MapFrame location={location} venue={venue} />

      <div className="es-venue__foot">
        <p className="es-venue__address fx-break">
          {venue && <span className="es-venue__name">{venue}</span>}
          {address && <span className="text-muted">{address}</span>}
        </p>
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="es-btn es-btn--secondary es-btn--sm"
        >
          Open in Maps
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </section>
  );
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MAP ITSELF, when the organizer has pinned the venue.
 *
 * OpenStreetMap's published embed endpoint, framed. Not Google's: the Maps
 * Embed API needs a key, which means a key in the client bundle, a billing
 * account behind it and a quota that fails closed on the one page whose job is
 * to convince somebody to come.
 *
 * `loading="lazy"` so it costs nothing until it is scrolled to — this sits
 * inside a tab most readers never open, and a map loaded for all of them is a
 * third-party request on the platform's most-visited page for no one's benefit.
 *
 * ATTRIBUTION IS REQUIRED by OSM's licence and it is not decoration: the link
 * below is the condition on which this is allowed to be used at all.
 *
 * WITHOUT A PIN there is no map — an embed needs coordinates and there is no
 * geocoder here to invent them. The address card above stands alone, which is
 * the same answer as before rather than a worse one. The pin is set in the
 * organizer's Page & branding screen.
 */
function MapFrame({ location, venue }) {
  if (!location) return null;

  const { lat, lng } = location;
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
        loading="lazy"
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
