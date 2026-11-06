import { QueryClient } from '@tanstack/react-query';

/** Defaults for the app's server state; `staleTime` is short because other users change the same data. */
export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30 * 1000,
        refetchOnWindowFocus: false,
      },
    },
  });
