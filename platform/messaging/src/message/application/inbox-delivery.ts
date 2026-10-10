import { ok, type Result } from '@kithena/domain-kit';

import { INBOX_TASK_TOPICS, type InboxTaskTopic, type InboxUpdateTopic } from '../domain/notice.js';
import type { SendNotice, SendNoticeRequest } from './send-notice.js';

/**
 * Where an Inbox notice goes (INB-050): by email now, into tomorrow's digest,
 * or nowhere, as the person chose in Settings › Notifications. Tasks default
 * to right away and updates to the digest; a person whose choices cannot be
 * read gets the defaults, never nothing.
 *
 * The digest holds outcomes only, as the delivery log does: who, which
 * company, where the button goes, when. Never what the update said.
 */

export type EmailChannel = 'now' | 'digest' | 'off';

/** What of a person's notification settings this reads (`apps/web/src/lib/inbox/notifications.ts`). */
export interface EmailChoices {
  readonly task: EmailChannel;
  readonly decided: EmailChannel;
  readonly documents: EmailChannel;
  readonly team: EmailChannel;
  readonly calendars: EmailChannel;
}

export const DEFAULT_CHOICES: EmailChoices = {
  task: 'now',
  decided: 'digest',
  documents: 'digest',
  team: 'off',
  calendars: 'off',
};

const channel = (v: unknown, fallback: EmailChannel): EmailChannel =>
  v === 'now' || v === 'digest' || v === 'off' ? v : fallback;

/** The choices out of the stored preference, leniently: a missing or odd value is its default. */
export function choicesOf(value: unknown): EmailChoices {
  const v = (value ?? {}) as {
    tasks?: { asked?: { email?: unknown } };
    updates?: Record<string, { email?: unknown } | undefined>;
  };
  return {
    task: channel(v.tasks?.asked?.email, DEFAULT_CHOICES.task),
    decided: channel(v.updates?.['decided']?.email, DEFAULT_CHOICES.decided),
    documents: channel(v.updates?.['documents']?.email, DEFAULT_CHOICES.documents),
    team: channel(v.updates?.['team']?.email, DEFAULT_CHOICES.team),
    calendars: channel(v.updates?.['calendars']?.email, DEFAULT_CHOICES.calendars),
  };
}

const ROW: Readonly<Record<InboxUpdateTopic, Exclude<keyof EmailChoices, 'task'>>> = {
  decided: 'decided',
  answered: 'decided',
  document_shared: 'documents',
  document_returned: 'documents',
  team_news: 'team',
  calendar: 'calendars',
};

/** The channel for one notice, by its kind and topic. */
export function channelFor(
  choices: EmailChoices,
  notice:
    | { readonly kind: 'inbox_task'; readonly topic: InboxTaskTopic }
    | { readonly kind: 'inbox_update'; readonly topic: InboxUpdateTopic },
): EmailChannel {
  return notice.kind === 'inbox_task' && INBOX_TASK_TOPICS.includes(notice.topic)
    ? choices.task
    : notice.kind === 'inbox_update'
      ? choices[ROW[notice.topic]]
      : 'now';
}

export interface HeldUpdate {
  readonly tenantId: string;
  readonly email: string;
  readonly companyName: string;
  /** The company's Inbox, where the digest's button goes. */
  readonly url: string;
}

export interface DigestStore {
  hold(entry: HeldUpdate): Promise<void>;
  /** Companies with updates held, across every tenant. */
  tenantsWaiting(): Promise<readonly string[]>;
  /** One company's held updates, by person, taken: marked sent as they are read. */
  take(tenantId: string): Promise<readonly (HeldUpdate & { readonly count: number })[]>;
}

export interface InboxDeliveryDeps {
  readonly sendNotice: SendNotice;
  /** The person's notification settings, where identity can be asked; absent, the defaults. */
  readonly choices?: (tenantId: string, accountId: string) => Promise<unknown>;
  /** Where digest updates wait; absent, an update for the digest is sent now. */
  readonly digests?: DigestStore;
}

export type InboxRequest = SendNoticeRequest & {
  readonly notice:
    | { readonly kind: 'inbox_task'; readonly topic: InboxTaskTopic }
    | { readonly kind: 'inbox_update'; readonly topic: InboxUpdateTopic };
  /** Whose settings to follow; absent, the defaults. */
  readonly accountId?: string | undefined;
};

export type InboxOutcome =
  | { readonly outcome: 'sent'; readonly messageId: string | null }
  | { readonly outcome: 'held' }
  | { readonly outcome: 'skipped' };

export function deliverInbox(deps: InboxDeliveryDeps) {
  return async (request: InboxRequest): Promise<Result<InboxOutcome>> => {
    const stored =
      deps.choices === undefined || request.accountId === undefined
        ? null
        : await deps.choices(request.tenantId, request.accountId).catch(() => null);
    const chosen = channelFor(choicesOf(stored), request.notice);
    if (chosen === 'off') return ok({ outcome: 'skipped' as const });
    if (chosen === 'digest' && deps.digests !== undefined) {
      await deps.digests.hold({
        tenantId: request.tenantId,
        email: request.email,
        companyName: request.companyName,
        url: new URL('/inbox/updates', request.url).toString(),
      });
      return ok({ outcome: 'held' as const });
    }
    const sent = await deps.sendNotice(request);
    return sent.ok ? ok({ outcome: 'sent' as const, messageId: sent.value.messageId }) : sent;
  };
}

/** Send every company's held updates, one digest a person: the daily run. */
export function flushDigests(deps: {
  readonly sendNotice: SendNotice;
  readonly digests: DigestStore;
  readonly today: () => string;
}) {
  return async (): Promise<{ readonly sent: number; readonly failed: number }> => {
    let sent = 0;
    let failed = 0;
    for (const tenantId of await deps.digests.tenantsWaiting()) {
      for (const d of await deps.digests.take(tenantId)) {
        const done = await deps.sendNotice({
          tenantId,
          email: d.email,
          url: d.url,
          companyName: d.companyName,
          // One digest a person a day, whatever retries.
          dedupeKey: `digest/${d.email}/${deps.today()}`,
          notice: { kind: 'inbox_digest', count: Math.min(d.count, 1000) },
        });
        if (done.ok) sent += 1;
        else failed += 1;
      }
    }
    return { sent, failed };
  };
}
