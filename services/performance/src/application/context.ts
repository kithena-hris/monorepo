import {
  err,
  failure,
  ok,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import type { CalendarDate, Instant } from '@kithena/contracts';

import type { AuditEntry, Caller, Deps, Member, Tx } from './ports.js';

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

/**
 * One line of the audit log (§24.1): every action, sensitive read and refused
 * attempt, with what it touched and the fields by name, never a value.
 */
export async function audit(
  ctx: Ctx,
  entry: {
    readonly action: string;
    readonly target: string;
    readonly targetId?: string | null;
    readonly fields?: readonly string[];
    readonly outcome?: 'done' | 'refused';
  },
): Promise<void> {
  const via = ctx.caller.via ?? 'Web';
  const record: AuditEntry = {
    id: ctx.deps.newId(),
    at: ctx.at,
    actorPersonId: ctx.viewer.personId,
    actorAccountId: ctx.caller.accountId,
    as:
      ctx.caller.accountId === SYSTEM
        ? 'Kithena'
        : via === 'Ask Kithena'
          ? `Ask Kithena for ${ctx.viewer.name}`
          : ctx.viewer.name,
    action: entry.action,
    target: entry.target,
    targetId: entry.targetId ?? null,
    where: via,
    outcome: entry.outcome ?? 'done',
    fields: entry.fields ?? [],
    ai: via === 'Ask Kithena',
  };
  await ctx.tx.audit.record(record);
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

/** Send what a transaction queued, after it committed; a failed email never undoes the work. */
export async function deliver(
  deps: Deps,
  tenantId: Caller['tenantId'],
  mail: readonly Outgoing[],
): Promise<void> {
  if (deps.mailer === undefined) return;
  for (const m of mail) {
    try {
      await deps.mailer.send({
        tenantId,
        to: m.to,
        subject: m.subject,
        text: m.text,
        dedupeKey: m.dedupeKey,
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
