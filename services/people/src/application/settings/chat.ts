import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { aiShareable } from '../../domain/schema/draft.js';
import type { Asking } from '../person/person-access.js';
import { run } from '../person/service.js';
import { NOBODY, type ScreenDeps } from '../screens/record.js';
import type { ChatApp, ChatConnection } from './chat-port.js';

/**
 * People in the company's chat apps, as its administrator sets it up:
 * connecting an app (Slack today), which of People's notices go to chat apps,
 * and which fields the assistant may answer about there.
 *
 * A People administrator's, as every integration is. A connection is the
 * company's, whichever module made it; the notices are People's own.
 */

export type { ChatDeps } from './chat-port.js';

/**
 * Every notice People can send to a chat app, in the words the setting shows.
 * `infrastructure/chat-notifier.ts` sends the same six.
 */
export const PEOPLE_NOTICES = [
  {
    key: 'approval_requested',
    label: 'A change needs approval',
    description: 'Each change arrives with Approve and Reject buttons. Deciding there is the same as deciding in Approvals.',
    to: 'Approvers',
    action: 'Approve or reject',
  },
  {
    key: 'details_requested',
    label: 'Someone is asked for their details',
    description: 'When HR or a manager asks for a missing detail, the employee fills it in from a form right in the chat.',
    to: 'The employee',
    action: 'Fill in',
  },
  {
    key: 'profile_reminder',
    label: 'Weekly reminder of missing details',
    description: 'At most once a week, in their working hours, while their profile is incomplete. Fillable in the chat.',
    to: 'The employee',
    action: 'Fill in',
  },
  {
    key: 'approval_decided',
    label: 'A change was approved or rejected',
    description: 'Whoever asked hears the outcome as soon as it is decided.',
    to: 'Whoever asked',
    action: null,
  },
  {
    key: 'approval_expired',
    label: 'A change expired undecided',
    description: 'Nobody decided within seven days, so it lapsed. They can ask again.',
    to: 'Whoever asked',
    action: null,
  },
  {
    key: 'correction_requested',
    label: 'A correction is needed',
    description: 'HR reviewed an identifier the employee gave and asked them to correct it.',
    to: 'The employee',
    action: null,
  },
] as const;

export type PeopleNotice = (typeof PEOPLE_NOTICES)[number]['key'];
export const isPeopleNotice = (key: string): key is PeopleNotice =>
  PEOPLE_NOTICES.some((n) => n.key === key);

export interface ChatNoticeView {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly to: string;
  readonly action: string | null;
  readonly on: boolean;
}

export interface ChatView {
  readonly apps: readonly {
    readonly key: string;
    readonly name: string;
    readonly canConnect: boolean;
    readonly connection: ChatConnection | null;
  }[];
  readonly notices: readonly ChatNoticeView[];
  /** Fields the assistant may answer about, in the app and in chat: chosen per field. */
  readonly fields: {
    readonly on: readonly { readonly key: string; readonly label: string }[];
    readonly shareable: number;
  };
}

async function asAdmin<T>(
  deps: ScreenDeps,
  asking: Asking,
  then: () => Promise<Result<T>>,
): Promise<Result<T>> {
  const allowed = await run(deps.service, asking.tenantId, async (tx) => {
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    return everyone.isAdmin
      ? ok(undefined)
      : err(failure('FORBIDDEN', 'Only a People administrator manages integrations'));
  });
  return allowed.ok ? then() : allowed;
}

const noticesOf = (on: ReadonlySet<string>): ChatNoticeView[] =>
  PEOPLE_NOTICES.map((n) => ({ ...n, on: on.has(n.key) }));

export function chatView(deps: ScreenDeps, asking: Asking): Promise<Result<ChatView>> {
  return asAdmin(deps, asking, async () => {
    const read = await run(deps.service, asking.tenantId, async (tx) => {
      const version = await deps.service.schemas.current(tx, asking.tenantId);
      const live = (version?.document.attributes ?? []).filter((d) => d.deprecatedAt === null);
      const on = deps.chat === undefined ? new Set<string>() : await deps.chat.notices.enabled(tx, asking.tenantId);
      return ok({
        notices: noticesOf(on),
        fields: {
          on: live
            .filter((d) => d.classification.aiEligible)
            .map((d) => ({ key: d.key, label: d.label.default })),
          shareable: live.filter((d) => aiShareable(d)).length,
        },
      });
    });
    if (!read.ok) return read;
    const apps = await Promise.all(
      (deps.chat?.apps ?? []).map(async (app) => ({
        key: app.key,
        name: app.name,
        ...(await app.status(asking.tenantId).catch(() => ({ canConnect: false, connection: null }))),
      })),
    );
    return ok({ apps, ...read.value });
  });
}

function appOf(deps: ScreenDeps, key: string): Result<ChatApp> {
  const app = deps.chat?.apps.find((a) => a.key === key);
  return app === undefined ? err(failure('NOT_FOUND', `No chat app called ${key}`)) : ok(app);
}

/** Where connecting goes, coming back to `origin`. */
export function connectChat(
  deps: ScreenDeps,
  asking: Asking,
  key: string,
  origin: string,
): Promise<Result<{ readonly url: string }>> {
  const app = appOf(deps, key);
  if (!app.ok) return Promise.resolve(app);
  return asAdmin(deps, asking, async () => {
    const url = await app.value.authorize(asking.tenantId, asking.viewer.accountId, origin);
    return url.ok ? ok({ url: url.value }) : err(failure('UNAVAILABLE', url.message));
  });
}

export function completeChat(
  deps: ScreenDeps,
  asking: Asking,
  key: string,
  input: { readonly code: string; readonly state: string },
): Promise<Result<ChatConnection>> {
  const app = appOf(deps, key);
  if (!app.ok) return Promise.resolve(app);
  return asAdmin(deps, asking, async () => {
    const done = await app.value.complete(asking.tenantId, input.code, input.state);
    return done.ok ? ok(done.value) : err(failure('CHAT_NOT_CONNECTED', done.message));
  });
}

export function disconnectChat(deps: ScreenDeps, asking: Asking, key: string): Promise<Result<void>> {
  const app = appOf(deps, key);
  if (!app.ok) return Promise.resolve(app);
  return asAdmin(deps, asking, async () => {
    await app.value.disconnect(asking.tenantId);
    return ok(undefined);
  });
}

export function setChatNotice(
  deps: ScreenDeps,
  asking: Asking,
  key: string,
  on: boolean,
): Promise<Result<readonly ChatNoticeView[]>> {
  const chat = deps.chat;
  if (chat === undefined) {
    return Promise.resolve(err(failure('UNAVAILABLE', 'No chat app is part of this deployment')));
  }
  if (!isPeopleNotice(key)) {
    return Promise.resolve(err(failure('NOT_FOUND', `People sends no notice called ${key}`)));
  }
  return asAdmin(deps, asking, () =>
    run(deps.service, asking.tenantId, async (tx) => {
      await chat.notices.set(tx, asking.tenantId, {
        event: key,
        on,
        by: asking.viewer.accountId,
        at: deps.clock.instant(),
      });
      return ok(noticesOf(await chat.notices.enabled(tx, asking.tenantId)));
    }),
  );
}
