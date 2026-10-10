'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

/**
 * The reads the browser asks for itself — a person picker's search, the next
 * page of a list, a profile's documents — kept for this tab, so asking the
 * same question again within half a minute asks nobody, and two parts of the
 * page asking at once share one request. Pages themselves are kept by the
 * router (`staleTimes` in `next.config.mjs`).
 *
 * `drawn` is when the server last drew the layout: the first page of a visit
 * and again after every write (`changed` in `lib/people.ts`). When it moves,
 * everything kept is stale, so nothing shown after a save predates it.
 */
export function QueryProvider({
  drawn,
  children,
}: {
  readonly drawn: number;
  readonly children: ReactNode;
}): JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: false },
        },
      }),
  );
  const seen = useRef(drawn);
  useEffect(() => {
    if (seen.current === drawn) return;
    seen.current = drawn;
    void client.invalidateQueries();
  }, [client, drawn]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** An answer that says it failed (or a read that answers null when it does), never kept. */
const refused = (answer: unknown): boolean =>
  answer === null || (typeof answer === 'object' && (answer as { ok?: unknown }).ok === false);

/**
 * `read` as a function of the same shape whose answers are kept, by `name`
 * and its arguments: for a callback the shell hands a screen, which awaits it
 * as it would the server action itself.
 */
export function useCachedRead(): <A extends readonly unknown[], T>(
  name: string,
  read: (...args: A) => Promise<T>,
) => (...args: A) => Promise<T> {
  const client = useQueryClient();
  return useCallback(
    <A extends readonly unknown[], T>(name: string, read: (...args: A) => Promise<T>) =>
      async (...args: A): Promise<T> => {
        const queryKey = [name, ...args];
        // Boxed: a read may answer `undefined`, which a query may not hold.
        const { answer } = await client.query({
          queryKey,
          queryFn: async () => ({ answer: await read(...args) }),
        });
        if (refused(answer)) client.removeQueries({ queryKey, exact: true });
        return answer;
      },
    [client],
  );
}
