import { QueryClient } from '@tanstack/react-query';

/**
 * The app's one query cache. Its own module so tests can empty it between runs.
 *
 * Five minutes fresh: going back and forth between Home, an event and Explore
 * shows what was already fetched instead of asking the server again (each
 * public call takes about half a second there). A pull-to-refresh always
 * fetches. Seat availability and the checkout quote set their own, shorter
 * times where staleness would mislead.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5 * 60_000, gcTime: 30 * 60_000, refetchOnWindowFocus: false },
  },
});
