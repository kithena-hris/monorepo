import type { Clock, PendingEvent } from '@kithena/domain-kit';
import type { Actor, CalendarDate, TenantId } from '@kithena/contracts';

/**
 * What a transition needs from outside itself, passed in rather than reached
 * for — People's `EventContext`, plus the zone whose calendar decides "today".
 *
 * Ids come from `newId` for the reason the clock is injected: an assertion
 * about which events and ledger entries were produced should not depend on
 * entropy. The same generator makes event ids and ledger entry ids, both
 * UUIDv7 in production.
 */
export interface EventContext {
  readonly clock: Clock;
  readonly newId: () => string;
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
  /** The member's zone. A leave day is a day on their calendar, not UTC's. */
  readonly timeZone: string;
}

/** Today, on the member's calendar. */
export const today = (ctx: EventContext): CalendarDate => ctx.clock.date(ctx.timeZone);

/** The envelope every Time Off event shares, around a payload. */
export function envelope(
  ctx: EventContext,
  args: {
    tenantId: TenantId;
    eventName: string;
    eventVersion: number;
    effectiveFrom: CalendarDate | null;
    aggregate: { type: string; id: string; version: number };
    payload: unknown;
  },
): PendingEvent {
  return {
    eventId: ctx.newId(),
    eventName: args.eventName,
    eventVersion: args.eventVersion,
    tenantId: args.tenantId,
    occurredAt: ctx.clock.instant(),
    effectiveFrom: args.effectiveFrom,
    aggregate: args.aggregate,
    actor: ctx.actor,
    correlationId: ctx.correlationId,
    causationId: ctx.causationId,
    payload: args.payload,
  };
}
