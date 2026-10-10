import type { InboxNotifier } from './ports.js';

export type { InboxNotice, InboxNotifier, Recipient } from './ports.js';

/**
 * Telling somebody, outside the Inbox, that something reached it (INB-050):
 * by email through messaging, which follows their notification settings —
 * a task right away, an update in the daily digest unless they chose
 * otherwise. Said after the write has committed, and a lost notice loses the
 * nudge, never the item: the Inbox has it either way.
 */

/** Fire and forget: the item is already there, so a notice that fails is logged, not thrown. */
export function tell(
  notifier: InboxNotifier | undefined,
  ...args: Parameters<InboxNotifier['notify']>
): void {
  if (notifier === undefined) return;
  void notifier.notify(...args).catch(() => undefined);
}
