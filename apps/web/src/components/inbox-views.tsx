'use client';

import { SegmentedControl, SegmentedControlItem } from '@reach/ui';
import { useRouter } from 'next/navigation';
import type { JSX } from 'react';

import { inboxView, type InboxView } from '../lib/inbox';

/**
 * To do · Flagged · Updates (design MA6): which of the Inbox's views is open,
 * in the address, moved between without a reload.
 */
export function InboxViews({
  view,
  todo,
  flagged,
}: {
  readonly view: InboxView;
  readonly todo: number;
  /** Null where the viewer decides nothing: no Flagged view. */
  readonly flagged: number | null;
}): JSX.Element {
  const router = useRouter();
  return (
    <SegmentedControl
      aria-label="Show"
      fullWidth
      value={view}
      onValueChange={(next) => {
        if (next === '') return;
        const chosen = inboxView(next);
        router.push(chosen === 'todo' ? '/inbox' : `/inbox?view=${chosen}`);
      }}
    >
      <SegmentedControlItem value="todo">To do · {todo}</SegmentedControlItem>
      {flagged === null ? null : (
        <SegmentedControlItem value="flagged">Flagged · {flagged}</SegmentedControlItem>
      )}
      <SegmentedControlItem value="updates">Updates</SegmentedControlItem>
    </SegmentedControl>
  );
}
