import { QueryClient } from "@tanstack/react-query";

/**
 * One QueryClient for the whole app. Lists stay fresh for a minute so returning to a screen
 * renders cached data at once, and background refetches only fill in changes. Window-focus
 * refetching is off: these screens are used through long shifts, and focus events would refetch
 * every list.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
