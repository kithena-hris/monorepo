import {
  err,
  failure,
  ok,
  type DomainFailure,
  type PendingEvent,
  type Result,
  wordsIn,
} from '@kithena/domain-kit';
import {
  PerformanceActivityRecorded,
  type ActivityArea,
  type CalendarDate,
  type Instant,
  type ModuleActivity,
} from '@kithena/contracts';

import type { Caller, ChatButton, Deps, Member, Tx, MailWords } from './ports.js';

/**
 * What every use case starts from (PRF-004): who is asking, what they are to
 * the people around them, today, and the envelope events share.
 *
 * Roles: an administrator of `module.performance` is HR and owns settings;
 * the people settings name as HR are HR; a manager is whoever the member
 * projection says manages someone; a calibrator is named per session. The
 * org chart is read from Performance's own projection, never People's.
 */

export interface Outgoing {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly dedupeKey: string;
  /** A session's calendar invitation (`invite.ics`). */
  readonly attachments?: readonly { readonly filename: string; readonly base64: string }[];
  /**
   * In the company's chat app too, by default; `false` for a cycle whose
   * reminders keep out of it, `only` for a notice with buttons and no email.
   */
  readonly chat?:
    false | 'only' | { readonly buttons: readonly ChatButton[]; readonly only?: boolean };
}

export interface Viewer {
  readonly personId: string | null;
  readonly accountId: string;
  readonly name: string;
  readonly admin: boolean;
  readonly hr: boolean;
  /** Direct reports. */
  readonly reports: ReadonlySet<string>;
  /** Everyone below, at any depth. */
  readonly org: ReadonlySet<string>;
}

const ENGLISH: MailWords = { language: 'en-US', t: wordsIn('en-US', {}) };

/**
 * The words an email is written in: the company's language, as messaging
 * answers it. US English with no mailer, or when it cannot be asked.
 */
export async function mailWords(ctx: Pick<Ctx, 'deps' | 'caller'>): Promise<MailWords> {
  return (await ctx.deps.mailer?.words?.(ctx.caller.tenantId).catch(() => null)) ?? ENGLISH;
}

export interface Ctx {
  readonly deps: Deps;
  readonly tx: Tx;
  readonly caller: Caller;
  readonly viewer: Viewer;
  readonly today: CalendarDate;
  readonly at: Instant;
  readonly mail: Outgoing[];
  /** Cycles a write changed, told to the live stream once it commits. */
  readonly touched: Set<string>;
  /** Every member, read once per request. */
  readonly members: () => Promise<readonly Member[]>;
}

export const SYSTEM = 'system';

export async function contextOf(
  deps: Deps,
  tx: Tx,
  caller: Caller,
  mail: Outgoing[] = [],
): Promise<Ctx> {
  let all: Promise<readonly Member[]> | undefined;
  const members = (): Promise<readonly Member[]> => (all ??= tx.members.list());
  const admin = caller.accountId !== SYSTEM && (await tx.admins.has(caller.accountId));
  const roles = ((await tx.settings.get('roles')) as { hr?: string[] } | null) ?? {};
  const me = caller.personId;
  const list = me === null ? [] : await members();
  const reports = new Set(
    list.filter((m) => m.managerPersonId === me).map((m) => m.personId as string),
  );
  const org = new Set<string>(reports);
  for (let grew = true; grew;) {
    grew = false;
    for (const m of list)
      if (m.managerPersonId !== null && org.has(m.managerPersonId) && !org.has(m.personId)) {
        org.add(m.personId);
        grew = true;
      }
  }
  const self = me === null ? undefined : list.find((m) => m.personId === me);
  return {
    deps,
    tx,
    caller,
    mail,
    touched: new Set(),
    members,
    viewer: {
      personId: me,
      accountId: caller.accountId,
      name: self?.displayName ?? (admin ? 'An administrator' : 'Someone'),
      admin: admin || caller.accountId === SYSTEM,
      hr: admin || caller.accountId === SYSTEM || (me !== null && (roles.hr ?? []).includes(me)),
      reports,
      org,
    },
    today: deps.clock.date('UTC'),
    at: deps.clock.instant(),
  };
}

export function event(
  ctx: Pick<Ctx, 'deps' | 'caller' | 'at' | 'today'>,
  name: string,
  aggregate: { type: string; id: string },
  payload: unknown,
  effectiveFrom?: CalendarDate,
): PendingEvent {
  return {
    eventId: ctx.deps.newId(),
    eventName: name,
    eventVersion: 1,
    tenantId: ctx.caller.tenantId,
    occurredAt: ctx.at,
    effectiveFrom: effectiveFrom ?? ctx.today,
    aggregate: { ...aggregate, version: 0 },
    actor:
      ctx.caller.accountId === SYSTEM
        ? { kind: 'system', process: 'performance' }
        : { kind: 'user', userId: ctx.caller.accountId },
    correlationId: ctx.caller.correlationId,
    causationId: null,
    payload,
  };
}

export const publish = (ctx: Ctx, ...events: PendingEvent[]): Promise<void> =>
  ctx.tx.outbox.publish(events);

/** Where an act falls in the activity log, from how it is worded, unless the call says. */
function areaOf(action: string): ActivityArea {
  if (/^(Read |Tried to read|Downloaded|Exported)/u.test(action)) return 'access';
  if (action.startsWith('Used AI')) return 'ai';
  if (action.includes('connected tool')) return 'integrations';
  if (action === 'Changed settings') return 'settings';
  return 'records';
}

/**
 * One line of the company's activity log (§24.1, `docs/audit.md`): every
 * action, sensitive read and refused attempt, with what it touched and the
 * fields by name, never a value. Raised as `performance.activity.recorded` in
 * the act's own transaction, so a retried command is one line and a rolled
 * back one none; `platform/audit` keeps it under Performance's name, and
 * Settings › Performance › Activity log reads it there.
 */
export async function audit(
  ctx: Ctx,
  entry: {
    readonly action: string;
    readonly target: string;
    readonly targetId?: string | null;
    /** What `targetId` is: `cycle`, `review`, `goal` … */
    readonly kind?: string;
    readonly fields?: readonly string[];
    readonly outcome?: 'done' | 'refused';
    readonly reason?: string | null;
    readonly area?: ActivityArea;
  },
): Promise<void> {
  const via = ctx.caller.via ?? 'Web';
  const fields = entry.fields ?? [];
  const id = entry.targetId ?? null;
  const payload: ModuleActivity = {
    area: entry.area ?? areaOf(entry.action),
    action: entry.action.slice(0, 200),
    detail:
      fields.length === 0
        ? null
        : `${entry.outcome === 'refused' ? 'Why' : 'Fields'}: ${fields.join(', ')}.`.slice(0, 500),
    subjectKind: id === null ? null : (entry.kind ?? null),
    subjectId: id === null ? null : id.slice(0, 64),
    subjectLabel: entry.target.slice(0, 300),
    reason: entry.reason?.slice(0, 500) ?? null,
    outcome: entry.outcome ?? 'done',
    via: ctx.caller.accountId === SYSTEM ? 'Kithena' : via.slice(0, 40),
    ai: via === 'Ask Kithena',
  };
  await publish(
    ctx,
    event(
      ctx,
      PerformanceActivityRecorded.name,
      { type: 'activity', id: ctx.deps.newId() },
      payload,
    ),
  );
}

export const notFound = (what = 'that'): DomainFailure => failure('NOT_FOUND', `No such ${what}`);
export const forbidden = (message = 'You cannot do this'): DomainFailure =>
  failure('FORBIDDEN', message);

export const hrOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.hr ? ok(true) : err(forbidden('Only HR can do this'));

export const adminOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.admin ? ok(true) : err(forbidden('Only a Performance administrator can do this'));

/** The caller as a member: most of Performance is somebody's own. */
export function me(ctx: Ctx): Result<string> {
  return ctx.viewer.personId === null
    ? err(failure('NO_MEMBER', 'Your account is not linked to a person in Performance yet'))
    : ok(ctx.viewer.personId);
}

/** Names by person id, for every screen that lists people. */
export async function names(ctx: Ctx): Promise<(id: string | null) => string> {
  const byId = new Map((await ctx.members()).map((m) => [m.personId as string, m.displayName]));
  return (id) => (id === null ? '—' : (byId.get(id) ?? 'Someone who left'));
}

/**
 * A button that runs one of Performance's routes as `accountId` when they
 * press it in the chat app, good for a week; null without a chat app or an
 * account to run it as.
 */
export function chatButton(
  ctx: Pick<Ctx, 'deps' | 'caller' | 'at'>,
  accountId: string | null,
  button: {
    readonly label: string;
    readonly route: string;
    readonly params?: Readonly<Record<string, unknown>>;
    readonly body?: unknown;
    readonly style?: 'primary' | 'danger';
  },
): ChatButton | null {
  const chat = ctx.deps.chat;
  if (chat === undefined || accountId === null) return null;
  const until = new Date(Date.parse(ctx.at) + 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    label: button.label,
    ...(button.style === undefined ? {} : { style: button.style }),
    value: chat.seal({
      kind: 'route',
      tenantId: ctx.caller.tenantId,
      accountId,
      route: button.route,
      params: button.params ?? {},
      body: button.body ?? {},
      until,
    }),
  };
}

/** Send what a transaction queued, after it committed; a failed send never undoes the work. */
export async function deliver(
  deps: Deps,
  tenantId: Caller['tenantId'],
  mail: readonly Outgoing[],
): Promise<void> {
  // The chat app hears what email does (PRF-164), with any buttons it carries.
  if (deps.chat !== undefined)
    for (const m of mail) {
      if (m.chat === false) continue;
      const buttons = typeof m.chat === 'object' ? m.chat.buttons : [];
      try {
        await deps.chat.send(tenantId, { email: m.to, text: `${m.subject}\n${m.text}`, buttons });
      } catch {
        // ponytail: a chat message lost is not retried; the email and the Inbox still have it.
      }
    }
  if (deps.mailer === undefined) return;
  for (const m of mail) {
    if (m.chat === 'only' || (typeof m.chat === 'object' && m.chat.only === true)) continue;
    try {
      await deps.mailer.send({
        tenantId,
        to: m.to,
        subject: m.subject,
        text: m.text,
        dedupeKey: m.dedupeKey,
        ...(m.attachments === undefined ? {} : { attachments: m.attachments }),
      });
    } catch {
      // ponytail: a lost reminder is not retried; the Inbox still has it. A delivery queue when one is missed.
    }
  }
}

/** A person's work email, for a reminder; null when the projection has none. */
export async function emailOf(ctx: Ctx, personId: string): Promise<string | null> {
  return (await ctx.members()).find((m) => m.personId === personId)?.workEmail ?? null;
}
