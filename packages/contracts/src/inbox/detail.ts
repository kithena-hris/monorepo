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

/* --------------------------------------------------------------- People -- */

/** A field asked for, drawn as People draws it (`dataType` picks the input). */
export const InboxField = z.object({
  key: plain(120),
  label: plain(),
  description: words(400).nullable(),
  dataType: plain(40),
  options: z.array(z.object({ value: plain(), label: plain() })),
  required: z.boolean(),
  /** What it holds now, as this viewer may read it; null when empty. */
  value: z.unknown().register(policy, asFreeText()),
  /** A change to it goes to HR first (PEO-077). */
  sensitive: z.boolean(),
});
export type InboxField = z.infer<typeof InboxField>;

/** One message on a task's thread (C7). */
export const InboxMessage = z.object({
  author: name(),
  mine: z.boolean(),
  body: words(4000),
  at: Instant,
});
export type InboxMessage = z.infer<typeof InboxMessage>;

/** C1, C7, C8, Z2, M:B1: details somebody asked the caller for. */
export const PeopleDetailsDetail = z.object({
  askId: plain(64),
  personId: plain(64),
  fields: z.array(InboxField),
  state: z.enum(['open', 'done', 'sent_back', 'cancelled']).register(policy, asPublic()),
  /** Sent back: why, and what they wrote. Cancelled: the sender's note. */
  reason: z
    .enum(['no_information', 'not_applicable', 'other'])
    .nullable()
    .register(policy, asPublic()),
  note: words().nullable(),
  closedBy: name().nullable(),
  closedAt: Instant.nullable(),
  thread: z.array(InboxMessage),
  events: z.array(InboxEvent),
});
export type PeopleDetailsDetail = z.infer<typeof PeopleDetailsDetail>;

/** H4: what the caller asked of one person or many, as one row with progress. */
export const PeopleAskedDetail = z.object({
  batchId: plain(64),
  labels: z.array(plain()),
  total: z.int(),
  done: z.int(),
  people: z.array(
    z.object({
      askId: plain(64),
      personId: plain(64),
      name: name(),
      state: z.enum(['open', 'done', 'sent_back', 'cancelled']).register(policy, asPublic()),
      note: words().nullable(),
      replies: z.int(),
    }),
  ),
});
export type PeopleAskedDetail = z.infer<typeof PeopleAskedDetail>;

/** C2, M:B2: a value HR sent back, to correct. Never the value itself. */
export const PeopleCorrectDetail = z.object({
  personId: plain(64),
  field: InboxField,
  findings: z.array(z.object({ level: plain(20), code: plain(80), message: words(400) })),
  note: words().nullable(),
});
export type PeopleCorrectDetail = z.infer<typeof PeopleCorrectDetail>;

/** E1, E2, D3, M:D2: a change the caller asked for, waiting or decided. */
export const PeopleChangeDetail = z.object({
  changeId: plain(64),
  personId: plain(64),
  personName: name(),
  label: plain(),
  /** On the record, and asked for: null where the caller may not read them. */
  before: z.unknown().register(policy, asFreeText()),
  after: z.unknown().register(policy, asFreeText()),
  effectiveFrom: CalendarDate,
  state: z
    .enum(['pending', 'approved', 'rejected', 'lapsed', 'withdrawn'])
    .register(policy, asPublic()),
  steps: z.array(InboxStep),
  by: name().nullable(),
  note: words().nullable(),
  /** Nudge is offered once, after 48 hours. */
  nudge: z.object({ from: Instant, used: z.boolean() }).nullable(),
});
export type PeopleChangeDetail = z.infer<typeof PeopleChangeDetail>;

/** G2, M:G1: People's queues, as one bundled task. */
export const PeopleReviewDetail = z.object({
  queues: z.array(
    z.object({
      key: plain(40),
      label: plain(),
      count: z.int(),
      by: z.array(name()),
      link: plain(400),
    }),
  ),
});
export type PeopleReviewDetail = z.infer<typeof PeopleReviewDetail>;

/** S1, G5, M:S1: a checklist, each step done in place or where it lives. */
export const PeopleChecklistDetail = z.object({
  personId: plain(64),
  personName: name(),
  steps: z.array(
    z.object({
      key: plain(120),
      label: plain(),
      note: words(200).nullable(),
      done: z.boolean(),
      /** A section to fill in place, or a path to open; null for a tick. */
      section: plain(120).nullable(),
      link: plain(400).nullable(),
    }),
  ),
  /** The others on the same plan, and how far they are (G5). */
  others: z.array(z.object({ name: name(), note: words(200) })),
});
export type PeopleChecklistDetail = z.infer<typeof PeopleChecklistDetail>;

/** C3, C4, D2, F1, M:B3, M:C3: a document to keep, acknowledge, sign or countersign. */
export const PeopleDocumentDetail = z.object({
  documentId: plain(64),
  name: plain(255),
  mediaType: plain(40),
  size: z.int(),
  mode: z.enum(['keep', 'acknowledge', 'sign']).register(policy, asPublic()),
  state: z
    .enum(['open', 'kept', 'acknowledged', 'signed', 'countersigned', 'declined', 'cancelled'])
    .register(policy, asPublic()),
  personName: name(),
  sentBy: name(),
  countersigner: name().nullable(),
  signature: z
    .object({
      name: name(),
      how: z.enum(['typed', 'drawn']).register(policy, asPublic()),
      mark: words(20_000),
      at: Instant,
      place: plain().nullable(),
    })
    .nullable(),
  countersigned: z.object({ name: name(), at: Instant }).nullable(),
  note: words().nullable(),
  /** What the caller does with it now: sign, acknowledge, countersign, or nothing. */
  action: z.enum(['sign', 'acknowledge', 'countersign']).nullable().register(policy, asPublic()),
});
export type PeopleDocumentDetail = z.infer<typeof PeopleDocumentDetail>;

/* --------------------------------------------------------------- shared -- */

/** A status chip a detail can carry beside its parts. */
export const InboxBadge = z.object({ label: plain(120), tone: InboxTone });
export type InboxBadge = z.infer<typeof InboxBadge>;
