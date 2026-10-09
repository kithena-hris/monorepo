import * as z from 'zod';

import { asFreeText, asInternal, asPublic, policy } from '../classification.js';
import { CalendarDate, Instant } from '../primitives.js';
import { InboxTone } from './item.js';

/**
 * What each kind's detail pane is drawn from (`InboxItem.detail`), by kind.
 * The module fills it from what it keeps; the shell parses it with the kind's
 * schema and draws the pane. A kind the shell does not know is drawn from the
 * item alone, with "Open in …".
 */

const name = () => z.string().max(200).register(policy, asInternal('identity'));
const words = (max = 2000) => z.string().max(max).register(policy, asFreeText());
const plain = (max = 200) => z.string().max(max).register(policy, asPublic());
const amount = () => z.string().max(20).register(policy, asInternal());

/** A step of a request or a checklist: done, the one now, or still to come. */
export const InboxStep = z.object({
  label: plain(),
  state: z.enum(['done', 'current', 'todo']).register(policy, asPublic()),
  /** "1 Oct, 10:04", "Ada · 2 days so far". */
  note: words(200).nullable(),
});
export type InboxStep = z.infer<typeof InboxStep>;

/** One line of an item's activity (C1's log). */
export const InboxEvent = z.object({
  icon: plain(40),
  text: words(300),
  at: Instant,
});
export type InboxEvent = z.infer<typeof InboxEvent>;

/* ------------------------------------------------------------- Time Off -- */

/** A request's dates and cost, as every Time Off kind shows it. */
const Span = {
  requestId: plain(64),
  leaveTypeName: plain(),
  from: CalendarDate,
  to: CalendarDate,
  workingDays: amount(),
};

/** G1, M:F2: a time-off request waiting on the caller. */
export const TimeOffApprovalDetail = z.object({
  ...Span,
  personName: name(),
  /** The team's name, for "Engineering that week". */
  teamName: plain().nullable(),
  /** Who else is out on each working day of the request. */
  week: z.array(z.object({ date: CalendarDate, out: z.array(name()) })),
  /** "1 of 6 already out". */
  alreadyOut: z.object({ out: z.int(), of: z.int() }).nullable(),
  balanceAfter: amount().nullable(),
  allowance: amount().nullable(),
  /** A declined earlier ask this one replaces: "24 Dec, which you declined". */
  firstAsk: words(200).nullable(),
  note: words().nullable(),
});
export type TimeOffApprovalDetail = z.infer<typeof TimeOffApprovalDetail>;

/** E3, M:D2: the caller's own request, still waiting. */
export const TimeOffRequestDetail = z.object({
  ...Span,
  steps: z.array(InboxStep),
  /** Who has it, and since when; a cover says whose they hold. */
  holder: z.object({ name: name(), covering: name().nullable() }).nullable(),
  since: Instant,
  balanceAfter: amount().nullable(),
  allowance: amount().nullable(),
  instead: words(200).nullable(),
  /** Nudge is offered once, after 48 hours. */
  nudge: z.object({ from: Instant, used: z.boolean() }).nullable(),
});
export type TimeOffRequestDetail = z.infer<typeof TimeOffRequestDetail>;

/** D1, D4, C2, C4: the caller's request, decided. */
export const TimeOffDecidedDetail = z.object({
  ...Span,
  approved: z.boolean(),
  by: name().nullable(),
  note: words().nullable(),
  leftThisYear: amount().nullable(),
  allowance: amount().nullable(),
  /** A request made after this one was declined (D4's follow-up). */
  followUp: z
    .object({ requestId: plain(64), label: words(200), holder: name().nullable() })
    .nullable(),
});
export type TimeOffDecidedDetail = z.infer<typeof TimeOffDecidedDetail>;

/** C9: days that do not carry over, due by the year end. */
export const TimeOffExpiringDetail = z.object({
  leaveTypeKey: plain(64),
  leaveTypeName: plain(),
  days: amount(),
  by: CalendarDate,
});
export type TimeOffExpiringDetail = z.infer<typeof TimeOffExpiringDetail>;

/** D6: a holiday calendar published. */
export const TimeOffHolidaysDetail = z.object({
  calendar: plain(),
  year: z.int(),
  count: z.int(),
  first: z.object({ date: CalendarDate, name: plain() }).nullable(),
});
export type TimeOffHolidaysDetail = z.infer<typeof TimeOffHolidaysDetail>;

/* --------------------------------------------------------------- shared -- */

/** A status chip a detail can carry beside its parts. */
export const InboxBadge = z.object({ label: plain(120), tone: InboxTone });
export type InboxBadge = z.infer<typeof InboxBadge>;
