'use client';

import { createContext, useContext } from 'react';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS ORGANIZER'S EVENTS, FETCHED ONCE FOR THE WHOLE SHELL.
 *
 * The organizer layout already loads the full list on every page: the event
 * switcher needs the titles, and the sidebar needs each event's `listingType`
 * and `admissionType` to know whether this event has a seating map at all.
 *
 * "Your events" then asked for the same 200 rows again, with the same query
 * string, on the one page where the list is already on screen — two identical
 * requests racing each other, and a list that could briefly disagree with the
 * switcher above it. It reads the layout's copy instead.
 *
 * THE ERROR IS CARRIED, NOT SWALLOWED. The switcher treats a failure as "no
 * events" on purpose — an account with no organizer profile answers 403, and a
 * broken switcher above a working page helps nobody. A page whose entire job is
 * to list the events has to say when it could not, so both facts travel and
 * each reader decides.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const OrganizerEventsContext = createContext(null);

export const OrganizerEventsProvider = OrganizerEventsContext.Provider;

/**
 * `{ events, error, loading }` — `events` is null until the first answer.
 *
 * Outside the organizer layout (a test rendering one screen on its own) there
 * is no provider, and the caller gets a permanent "still loading" rather than a
 * crash.
 */
export function useOrganizerEvents() {
  const value = useContext(OrganizerEventsContext);
  const events = value?.events ?? null;
  const error = value?.error ?? null;
  return { events, error, loading: events === null && !error, reload: value?.reload };
}
