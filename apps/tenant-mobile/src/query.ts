import { QueryClient } from '@tanstack/react-query';

/**
 * Every read the app has answered, kept in memory for the session: a screen
 * opened again within half a minute draws the answer it already has and
 * asks nobody; an older one is drawn at once and asked again behind it.
 * Any write drops them all to stale (`ask` in `people/api.ts`), so nothing
 * shown after a change predates it.
 *
 * No retries: a failed read says so, as it did before, and keeps the last
 * answer on screen. Coming back to the app is a focus (`App.tsx`), so what
 * went stale while it was in the background is asked again then. Nothing
 * here imports React Native, so the pure models that read through `api.ts`
 * stay testable on their own.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: false,
    },
  },
});
