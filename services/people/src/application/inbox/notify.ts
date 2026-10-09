/**
 * Telling somebody, outside the Inbox, that something reached it (INB-050):
 * by email through messaging, which follows their notification settings —
 * a task right away, an update in the daily digest unless they chose
 * otherwise. Said after the write has committed, and a lost notice loses the
 * nudge, never the item: the Inbox has it either way.
 */

export type InboxNotice =
  | {
      readonly kind: 'inbox_task';
      readonly topic: 'document_sign' | 'document_acknowledge' | 'document_countersign';
    }
  | {
      readonly kind: 'inbox_update';
      readonly topic: 'answered' | 'document_shared' | 'document_returned';
    };

/** Whom: a person on file, or the account somebody signs in as. */
export type Recipient = { readonly personId: string } | { readonly accountId: string };

export interface InboxNotifier {
  notify(
    tenantId: string,
    to: Recipient,
    notice: InboxNotice,
    /** The item, as the Inbox addresses it: `/inbox/todo?item=…`. */
    itemPath: string,
    /** What makes a retry the same message. */
    dedupeKey: string,
  ): Promise<void>;
}

/** Fire and forget: the item is already there, so a notice that fails is logged, not thrown. */
export function tell(
  notifier: InboxNotifier | undefined,
  ...args: Parameters<InboxNotifier['notify']>
): void {
  if (notifier === undefined) return;
  void notifier.notify(...args).catch(() => undefined);
}
