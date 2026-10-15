import {
  err,
  failure,
  ok,
  type DomainFailure,
  type PendingEvent,
  type Result,
} from '@kithena/domain-kit';
import type { CalendarDate, Instant } from '@kithena/contracts';

import type { Caller, Deps, Member, Tx } from './ports.js';

/**
 * What every use case starts from (ONB-008): who is asking, today, and the
 * envelope its events share. Recruiting's shape.
 *
 * Roles: an administrator of `module.onboarding` is HR; the people named HR
 * or IT in Onboarding's settings hold those task roles; a manager, a buddy and
 * the new hire are who the plan says they are.
 */

export interface Outgoing {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly dedupeKey: string;
}

export interface Roles {
  readonly hr: readonly string[];
  readonly it: readonly string[];
}

export interface Viewer {
  readonly personId: string | null;
  readonly accountId: string;
  readonly admin: boolean;
  /** HR: an administrator, or a person settings name as HR. */
  readonly hr: boolean;
  readonly it: boolean;
}

export interface Ctx {
  readonly deps: Deps;
  readonly tx: Tx;
  readonly caller: Caller;
  readonly viewer: Viewer;
  readonly member: Member | null;
  readonly today: CalendarDate;
  readonly at: Instant;
  readonly mail: Outgoing[];
}

/** The welcome page's caller: a new hire with no account yet. */
export const PUBLIC_ACCOUNT = 'public';

export async function rolesOf(tx: Tx): Promise<Roles> {
  const held = (await tx.settings.get('roles')) as Partial<Roles> | null;
  return { hr: held?.hr ?? [], it: held?.it ?? [] };
}

export async function contextOf(
  deps: Deps,
  tx: Tx,
  caller: Caller,
  mail: Outgoing[] = [],
): Promise<Ctx> {
  const member = caller.personId === null ? null : await tx.members.get(caller.personId);
  const admin = caller.accountId !== PUBLIC_ACCOUNT && (await tx.admins.has(caller.accountId));
  const roles = await rolesOf(tx);
  const me = caller.personId ?? '';
  return {
    deps,
    tx,
    caller,
    member,
    mail,
    viewer: {
      personId: caller.personId,
      accountId: caller.accountId,
      admin,
      hr: admin || roles.hr.includes(me),
      it: roles.it.includes(me),
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
      ctx.caller.accountId === 'system' || ctx.caller.accountId === PUBLIC_ACCOUNT
        ? { kind: 'system', process: 'onboarding' }
        : { kind: 'user', userId: ctx.caller.accountId },
    correlationId: ctx.caller.correlationId,
    causationId: null,
    payload,
  };
}

export const publish = (ctx: Ctx, ...events: PendingEvent[]): Promise<void> =>
  ctx.tx.outbox.publish(events);

export const notFound = (what = 'that'): DomainFailure => failure('NOT_FOUND', `No such ${what}`);
export const forbidden = (message = 'You cannot do this'): DomainFailure =>
  failure('FORBIDDEN', message);

export const hrOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.hr ? ok(true) : err(forbidden('Only HR can do this'));

export const adminOnly = (ctx: Ctx): Result<true> =>
  ctx.viewer.admin ? ok(true) : err(forbidden('Only an onboarding administrator can do this'));

export async function nameOf(ctx: Ctx, personId: string | null): Promise<string | null> {
  if (personId === null) return null;
  return (await ctx.tx.members.get(personId))?.displayName ?? null;
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
      // ponytail: a lost welcome is retried by nothing; a delivery queue when one is missed.
    }
  }
}
