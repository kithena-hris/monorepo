import type { CalendarDate, PersonId } from '@kithena/contracts';

import { addDays } from '../days.js';

/**
 * Delegation and escalation (PRD §9.7, T19).
 *
 * A delegate covers an approver for a range, or automatically whenever the
 * approver's own time off is approved. Salary-related requests go to HR
 * instead unless the delegate is allowed them. Nothing waits longer than
 * three working days: then it goes to the approver's manager.
 *
 * Working days come in as a function, because the calendar is TOF-010's and
 * a holiday set is per member.
 */

export interface DateRange {
  readonly from: CalendarDate;
  readonly to: CalendarDate;
}

export interface Delegation {
  readonly approverId: PersonId;
  readonly delegateId: PersonId;
  /** A set range, or `null` for none. */
  readonly range: DateRange | null;
  /** Also cover whenever the approver's own time off is approved. */
  readonly automatic: boolean;
  /** The delegate may see salary-related requests. Off by default. */
  readonly salaryRelated: boolean;
}

export type Route =
  | { readonly kind: 'approver'; readonly personId: PersonId }
  | { readonly kind: 'delegate'; readonly personId: PersonId; readonly onBehalfOf: PersonId }
  | { readonly kind: 'hr'; readonly onBehalfOf: PersonId };

const within = (on: CalendarDate, r: DateRange) => r.from <= on && on <= r.to;

/** Who decides a request routed to `approverId` on a date. */
export function routeTo(args: {
  readonly approverId: PersonId;
  readonly on: CalendarDate;
  readonly delegation: Delegation | null;
  /** The approver's approved time off. */
  readonly approverAway: readonly DateRange[];
  readonly salaryRelated: boolean;
}): Route {
  const d = args.delegation;
  const covering =
    d !== null &&
    d.approverId === args.approverId &&
    ((d.range !== null && within(args.on, d.range)) || (d.automatic && args.approverAway.some((r) => within(args.on, r))));
  if (!covering) return { kind: 'approver', personId: args.approverId };
  if (args.salaryRelated && !d.salaryRelated) return { kind: 'hr', onBehalfOf: args.approverId };
  return { kind: 'delegate', personId: d.delegateId, onBehalfOf: args.approverId };
}

/** A year with no working day in it is a broken calendar, not a slow approver. */
const SEARCH_LIMIT = 366;

/** When an undecided request moves up, and to whom. */
export function escalation(args: {
  readonly pendingSince: CalendarDate;
  readonly approverManagerId: PersonId | null;
  readonly isWorkingDay: (date: CalendarDate) => boolean;
  readonly afterWorkingDays?: number;
}): { on: CalendarDate; to: { kind: 'person'; personId: PersonId } | { kind: 'hr' } } {
  const wanted = args.afterWorkingDays ?? 3;
  let on = args.pendingSince;
  let counted = 0;
  for (let i = 0; counted < wanted; i++) {
    if (i >= SEARCH_LIMIT) throw new Error('No working day in a year; the calendar is broken');
    on = addDays(on, 1);
    if (args.isWorkingDay(on)) counted++;
  }
  return {
    on,
    to: args.approverManagerId === null ? { kind: 'hr' } : { kind: 'person', personId: args.approverManagerId },
  };
}
