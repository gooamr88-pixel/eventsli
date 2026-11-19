'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { get } from '../utils/apiClient';
import { useSavedCount } from '../hooks/useSavedEvents';
import NavIcon from '../components/shell/NavIcon';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * "Near me" and "This weekend" — the two answers most people actually want.
 *
 * Both are ordinary URLs once applied, because everything else on this page is:
 * a filtered view has to be shareable, and the back button has to walk the
 * filters. "This weekend" is a plain `<Link>` for that reason — it needs no
 * permission and no round trip, so making it a button would be inventing
 * JavaScript for something an anchor already does.
 *
 * "Near me" cannot be a link, because the answer depends on where the reader
 * is, and only the browser can say. It asks for a position, turns it into the
 * NEAREST CITY WITH SOMETHING ON via the API, and then navigates to that
 * ordinary `?city=` URL — so the result is as shareable as any other filter
 * and the reader ends up somewhere they can describe, rather than inside an
 * opaque radius search.
 *
 * The coordinates are sent once, to work out a city name, and nothing is
 * stored. `/public/cities/nearest` is rate-limited for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export default function QuickFilters({ city }) {
  const router = useRouter();
  const params = useSearchParams();
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState(null);
  // From the store, so saving an event in another tab fills this in here.
  // Server-renders as 0, which is why the chip below is absent on first paint
  // rather than flashing a count that localStorage has not been read for yet.
  const savedCount = useSavedCount();

  const weekend = weekendRange();
  const from = params.get('from');
  const weekendActive = from === weekend.from;
  const onSale = params.get('onSale') === 'true';

  /** The current query with some keys replaced, so a quick filter narrows what
   *  is already on screen instead of resetting it. */
  function withParams(changes) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    next.delete('page');
    const qs = next.toString();
    return qs ? `/events?${qs}` : '/events';
  }

  async function nearMe() {
    setLocateError(null);

    if (!('geolocation' in navigator)) {
      setLocateError('This browser cannot share your location. Try typing a city instead.');
      return;
    }

    /**
     * The same guard `NearMeDialog` carries, and it was missing here.
     *
     * Over plain http every browser refuses geolocation outright, with
     * `PERMISSION_DENIED` and no prompt — so this chip answered "location is
     * off for this site" when the site had never been allowed to ask. Naming
     * the real cause is the difference between a setting somebody can go and
     * change and one they will not find, because it is not there.
     */
    if (!window.isSecureContext) {
      setLocateError('Finding you needs a secure (https) connection. Type a city instead.');
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const nearest = await get(
            `/public/cities/nearest?lat=${coords.latitude}&lng=${coords.longitude}`,
            { noRedirect: true },
          );
          if (nearest?.city) {
            router.push(withParams({ city: nearest.city }));
          } else {
            setLocateError('Nothing on near you yet. Try a city, or browse everything.');
          }
        } catch {
          setLocateError('Could not work out where you are. Try typing a city instead.');
        } finally {
          setLocating(false);
        }
      },
      () => {
        // Denied, unavailable, or timed out — all three mean the same thing to
        // the reader, and none of them is worth three different sentences.
        setLocating(false);
        setLocateError('Location is off for this site. Type a city instead.');
      },
      { timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  }

  // Rows in the /events sidebar (2026-11-19), drawn as checkboxes: unlike the
  // categories above, these combine.
  return (
    <section className="es-evx-side__group">
      <h2 className="es-evx-side__heading">Quick filters</h2>
      <ul className="es-evx-radios">
        <li>
          <button
            type="button"
            onClick={nearMe}
            disabled={locating}
            aria-pressed={Boolean(city)}
            className={check(Boolean(city))}
          >
            <span aria-hidden className="es-evx-radio__box" />
            {locating ? 'Finding you…' : city ? `Near me: ${city}` : 'Near me'}
          </button>
        </li>
        <li>
          <Link
            href={withParams(weekendActive ? { from: null, to: null } : weekend)}
            aria-current={weekendActive ? 'true' : undefined}
            className={check(weekendActive)}
          >
            <span aria-hidden className="es-evx-radio__box" />
            This weekend
          </Link>
        </li>
        <li>
          {/* Only events sold here (2026-11-15). */}
          <Link
            href={withParams({ onSale: onSale ? null : 'true' })}
            aria-current={onSale ? 'true' : undefined}
            className={check(onSale)}
          >
            <span aria-hidden className="es-evx-radio__box" />
            Tickets on sale
          </Link>
        </li>
        {/* Only when there is something to show. */}
        {savedCount > 0 && (
          <li>
            <Link href="/events/saved" className="es-evx-radio">
              <NavIcon name="heart" size={18} filled className="es-evx-radio__heart" />
              Saved <span className="es-nums es-evx-radio__count">({savedCount})</span>
            </Link>
          </li>
        )}
      </ul>

      {city && (
        <Link href={withParams({ city: null })} className="es-evx-side__clear">Clear city</Link>
      )}
      {locateError && (
        <p role="status" className="es-evx-side__note">{locateError}</p>
      )}
    </section>
  );
}

function check(active) {
  return `es-evx-radio es-evx-radio--check ${active ? 'is-checked' : ''}`;
}

/**
 * Friday 00:00 to Monday 00:00, in the READER's zone.
 *
 * "This weekend" is a claim about the reader's calendar, not about any one
 * event's timezone — somebody in Toronto means the Toronto weekend, whatever
 * zone the event is filed under. The API compares against `starts_at`, so the
 * bounds are sent as instants and the comparison is exact.
 *
 * On a Saturday it still means THIS weekend rather than the next one: the
 * window starts from the Friday just gone, so an event tonight is in it.
 */
export function weekendRange(now = new Date()) {
  const day = now.getDay();                 // 0 Sun … 6 Sat
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  // Days back to Friday. Sunday counts as part of the weekend that began on
  // the Friday two days earlier, not as the start of the next one.
  const backToFriday = day === 0 ? 2 : day === 6 ? 1 : (day + 2) % 7;
  const daysAhead = day === 0 || day === 6 ? -backToFriday : (5 - day);
  start.setDate(start.getDate() + daysAhead);

  const end = new Date(start);
  end.setDate(end.getDate() + 3);           // Friday 00:00 → Monday 00:00

  return { from: start.toISOString(), to: end.toISOString() };
}

