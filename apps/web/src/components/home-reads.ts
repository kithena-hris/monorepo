import { inboxItem } from '../app/(app)/inbox/actions';
import { recordGaps } from '../app/(app)/inbox/pane-actions';

/*
 * What Home's modal reads, as kept reads (`lib/query.tsx`): asked for ahead
 * while Home is on screen, shared by whoever asks again, and read again only
 * when stale: after `STALE_MS`, or when a write moves the layout's `drawn`.
 */

/** How long a read, or a page kept in a frame, is shown without asking again. */
export const STALE_MS = 5 * 60_000;

export const taskQuery = (id: string) =>
  ({
    queryKey: ['home', 'task', id],
    // Null when it is gone, or the read failed: its page is shown instead.
    queryFn: () => inboxItem(id).catch(() => null),
    staleTime: STALE_MS,
  }) as const;

export const gapsQuery = (personId: string) =>
  ({
    queryKey: ['home', 'gaps', personId],
    queryFn: () => recordGaps(personId),
    staleTime: STALE_MS,
  }) as const;
