import { QueryClient } from '@tanstack/react-query';

/** The app's one query cache. Its own module so tests can empty it between runs. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true },
  },
});
