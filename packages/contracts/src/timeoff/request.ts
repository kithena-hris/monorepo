import * as z from 'zod';

import { asFreeText, asInternal, asPublic, asSpecialCategory, policy } from '../classification.js';
import { CalendarDate, Instant, PersonId } from '../primitives.js';
import { DayAmount, LeaveCategory, LeaveTypeKey } from './primitives.js';

/**
 * A leave request on the wire: what a member sends, and what each reader may
 * see of it (PRD §8.1, §8.5, MT14).
 *
 * Three views rather than one view with fields blanked, because a blanked
 * field is a field somebody forgets to blank. The teammate view cannot carry a
 * sick note because it has no property to carry it in.
 */

/** PRD §8.1. */
export const RequestStatus = z
  .enum([
    'draft',
    'pending',
    'approved',
    'taken',
    'change_pending',
    'declined',
    'counter_proposed',
    'withdrawn',
    'cancelled',
  ])
  .register(policy, asInternal());
export type RequestStatus = z.infer<typeof RequestStatus>;

/** Dates with half days at either end. Shared by requests, proposals and changes. */
export const DateSpan = z
  .object({
    from: CalendarDate,
    to: CalendarDate,
    startsHalfDay: z.boolean().default(false).register(policy, asInternal()),
    endsHalfDay: z.boolean().default(false).register(policy, asInternal()),
  })
  .refine((s) => s.from <= s.to, { message: 'Leave cannot end before it starts', path: ['to'] });
export type DateSpan = z.infer<typeof DateSpan>;

/**
 * The sick note: special-category health data (PRD §8.5). A reference to the
 * encrypted file, never its content. It appears in exactly two shapes, the
 * member's own input and the member-and-HR view below.
 */
const sickNote = z.uuid().nullable().default(null).register(policy, asSpecialCategory('health'));

/** A free-text note to the approver. */
const note = z.string().max(1000).nullable().default(null).register(policy, asFreeText());

/** What a member sends (T3, MT5–MT7). */
export const LeaveRequestInput = z.object({
  leaveTypeKey: LeaveTypeKey,
  span: DateSpan,
  note,
  sickNoteFileId: sickNote,
});
export type LeaveRequestInput = z.infer<typeof LeaveRequestInput>;

/** The fields every reader may see. */
const seen = {
  requestId: z.uuid().register(policy, asPublic()),
  personId: PersonId,
  span: DateSpan,
  status: RequestStatus,
};

/** What a manager or a delegate deciding the request sees: the type and the
 *  reason, and whether a sick note exists, never the note. */
export const ApproverRequestView = z.object({
  ...seen,
  leaveTypeKey: LeaveTypeKey,
  category: LeaveCategory,
  workingDays: DayAmount,
  daysAway: DayAmount,
  note,
  notePresent: z.boolean().register(policy, asInternal()),
  requestedAt: Instant,
});
export type ApproverRequestView = z.infer<typeof ApproverRequestView>;

/** What the member themselves and HR see. The only view holding the sick note. */
export const LeaveRequestView = ApproverRequestView.extend({ sickNoteFileId: sickNote });
export type LeaveRequestView = z.infer<typeof LeaveRequestView>;

/**
 * What a teammate sees on the calendar.
 *
 * For a type shown to teammates, the type; for an `off_only` type — sick and
 * parental always — "Off" and the dates, with no type, no note and no
 * category to infer one from.
 */
export const TeammateRequestView = z.discriminatedUnion('shows', [
  z.object({
    ...seen,
    shows: z.literal('type').register(policy, asPublic()),
    leaveTypeKey: LeaveTypeKey,
  }),
  z.object({ ...seen, shows: z.literal('off').register(policy, asPublic()) }),
]);
export type TeammateRequestView = z.infer<typeof TeammateRequestView>;
