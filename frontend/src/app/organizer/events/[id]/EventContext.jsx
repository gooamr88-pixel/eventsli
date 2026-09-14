'use client';

import { createContext, useContext } from 'react';

/**
 * The event every page under /organizer/events/[id] is about, fetched ONCE by
 * the event layout. Before this the header and the overview each asked for the
 * same event on the same page load.
 *
 * `{ eventId, event, error, refresh }` — `refresh` after anything that changes
 * the event, so the header's status pill follows the page.
 */
const EventContext = createContext(null);

export const EventProvider = EventContext.Provider;

export function useEventContext() {
  return useContext(EventContext);
}
