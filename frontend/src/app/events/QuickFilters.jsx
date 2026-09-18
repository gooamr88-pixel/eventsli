'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { get } from '../utils/apiClient';
import { useSavedCount } from '../hooks/useSavedEvents';

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

  return (
    <div className="fx-stack fx-stack--sm">
      <div className="fx-row flex-wrap gap-2">
        <button
          type="button"
          onClick={nearMe}
          disabled={locating}
          aria-pressed={Boolean(city)}
          className={chip(Boolean(city))}
        >
          <Pin />
          {locating ? 'Finding you…' : city || 'Near me'}
        </button>

        <Link href={withParams(weekendActive ? { from: null, to: null } : weekend)} className={chip(weekendActive)}>
          <Cal />
          This weekend
        </Link>

        {/* Back, now that `/events/saved` exists to receive it.
            Only when there is something to show: a "Saved (0)" chip is a
            control whose only function is to open an empty screen. */}
        {savedCount > 0 && (
          <Link href="/events/saved" className={chip(false)}>
            <Heart />
            Saved <span className="es-nums text-subtle">({savedCount})</span>
          </Link>
        )}

        {city && (
          <Link href={withParams({ city: null })} className={chip(false)}>
            Clear city
          </Link>
        )}
      </div>

      {locateError && (
        <p role="status" className="text-sm text-muted">{locateError}</p>
      )}
    </div>
  );
}

function chip(active) {
  return `fx-row items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
    active
      ? 'border-accent bg-accent/10 text-accent'
      : 'border-border-strong text-ink hover:bg-bg-sunken'
  }`;
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

const Pin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" />
  </svg>
);

const Cal = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

/* Filled rather than stroked, matching `SaveEventButton`'s saved state — this
   chip is about events that are already hearted. */
const Heart = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.7-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
);
