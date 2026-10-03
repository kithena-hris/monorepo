'use server';

import { headers } from 'next/headers';

import { currentTenant } from '../../../lib/branding';
import { timeOff } from '../../../lib/people';

/**
 * What the Time Off screens' buttons do: server actions, each one operation
 * sent to Time Off through the router as the person signed in (TOF-060), as
 * People's are (`../people/actions.ts`).
 *
 * The browser chooses the arguments, never the operation, and Time Off
 * validates every one again and decides whether this person may. Nothing here
 * authorizes anything. Every write carries a fresh idempotency key and
 * answers with the page drawn again (`lib/people.ts`), so the screen shows
 * Time Off's answer, never a guess. Later screens add theirs here.
 */

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * The clock (T1's card, T2's pill, MT3's slide): clock in, start or end a
 * break, clock out, from the web or under a finger (`mobile`), at the work
 * model the day is being worked at. The time is Time Off's clock, not the
 * browser's, and no location ever travels: the phone's one check became the
 * work model before it got here.
 */
export async function punch(
  kind: 'in' | 'out' | 'break_start' | 'break_end',
  workModel: 'office' | 'remote' | 'client',
  source: 'web' | 'mobile' = 'web',
): Promise<Outcome> {
  const a = await timeOff('PunchTimeOffClock', { input: { kind, workModel, source } });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/* ------------------------------------------------------------ parental -- */

type ParentRole = 'birth_parent' | 'other_parent' | 'adopting';
type TeamSees = 'type' | 'away';
type BlockKind = 'mandatory' | 'flexible' | 'vacation' | 'company' | 'later';

export interface ParentalAnswers {
  readonly role: ParentRole;
  readonly childDate: string;
  readonly singleParent: boolean;
  readonly children: number;
}

/**
 * T8's entitlement card, for answers not saved yet: Time Off works it out
 * from the law where the person works and the company's policy, and saves
 * nothing. A read, so nothing is drawn again.
 */
export async function parentalEntitlement(
  answers: ParentalAnswers,
): Promise<
  | { readonly ok: true; readonly entitlement: unknown }
  | { readonly ok: false; readonly message: string }
> {
  const a = await timeOff<{ preview: unknown }>('TimeOffParentalPlan', { ...answers });
  return a.ok ? { ok: true, entitlement: a.data.preview } : { ok: false, message: a.message };
}

/** T8's answers and what the team sees: a private draft, started or answered again. */
export async function answerParental(
  answers: ParentalAnswers & { readonly teamSees: TeamSees },
): Promise<Outcome> {
  const a = await timeOff('AnswerTimeOffParental', { input: answers });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T9: the blocks where the parent left them; a broken rule comes back on the plan, not here. */
export async function editParentalBlocks(
  planId: string,
  blocks: readonly { readonly kind: BlockKind; readonly from: string; readonly to: string }[],
): Promise<Outcome> {
  const a = await timeOff('EditTimeOffParentalBlocks', { planId, input: { blocks } });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T10: who covers what, and what the team sees. */
export async function saveParentalHandover(
  planId: string,
  handover: readonly { readonly work: string; readonly coveredBy: string }[],
  teamSees: TeamSees,
): Promise<Outcome> {
  const a = await timeOff('SaveTimeOffParentalHandover', {
    planId,
    input: { handover, teamSees },
  });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T10's "Send to HR": refused while a rule is broken. */
export async function sendParentalPlan(planId: string): Promise<Outcome> {
  const a = await timeOff('SendTimeOffParentalPlan', { planId });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T11's "Approve plan", HR's. */
export async function approveParentalPlan(planId: string): Promise<Outcome> {
  const a = await timeOff('ApproveTimeOffParentalPlan', { planId });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** The baby arrived: the mandatory weeks move to the birth. */
export async function recordParentalBirth(planId: string, birth: string): Promise<Outcome> {
  const a = await timeOff('RecordTimeOffParentalBirth', { planId, input: { birth } });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/**
 * The member's own kiosk PIN (TOF-107, TOF-108): six digits, kept by Time
 * Off as a keyed hash, refused when somebody else has it.
 */
export async function setKioskPin(personId: string, pin: string): Promise<Outcome> {
  const a = await timeOff('SetTimeOffKioskCredential', {
    personId,
    kind: 'pin',
    input: { value: pin },
  });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/* ------------------------------------------------------------ parental -- */

type ParentRole = 'birth_parent' | 'other_parent' | 'adopting';
type TeamSees = 'type' | 'away';
type BlockKind = 'mandatory' | 'flexible' | 'vacation' | 'company' | 'later';

export interface ParentalAnswers {
  readonly role: ParentRole;
  readonly childDate: string;
  readonly singleParent: boolean;
  readonly children: number;
}

/**
 * T8's entitlement card, for answers not saved yet: Time Off works it out
 * from the law where the person works and the company's policy, and saves
 * nothing. A read, so nothing is drawn again.
 */
export async function parentalEntitlement(
  answers: ParentalAnswers,
): Promise<
  | { readonly ok: true; readonly entitlement: unknown }
  | { readonly ok: false; readonly message: string }
> {
  const a = await timeOff<{ preview: unknown }>('TimeOffParentalPlan', { ...answers });
  return a.ok ? { ok: true, entitlement: a.data.preview } : { ok: false, message: a.message };
}

/** T8's answers and what the team sees: a private draft, started or answered again. */
export async function answerParental(
  answers: ParentalAnswers & { readonly teamSees: TeamSees },
): Promise<Outcome> {
  const a = await timeOff('AnswerTimeOffParental', { input: answers });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T9: the blocks where the parent left them; a broken rule comes back on the plan, not here. */
export async function editParentalBlocks(
  planId: string,
  blocks: readonly { readonly kind: BlockKind; readonly from: string; readonly to: string }[],
): Promise<Outcome> {
  const a = await timeOff('EditTimeOffParentalBlocks', { planId, input: { blocks } });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T10: who covers what, and what the team sees. */
export async function saveParentalHandover(
  planId: string,
  handover: readonly { readonly work: string; readonly coveredBy: string }[],
  teamSees: TeamSees,
): Promise<Outcome> {
  const a = await timeOff('SaveTimeOffParentalHandover', {
    planId,
    input: { handover, teamSees },
  });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T10's "Send to HR": refused while a rule is broken. */
export async function sendParentalPlan(planId: string): Promise<Outcome> {
  const a = await timeOff('SendTimeOffParentalPlan', { planId });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T11's "Approve plan", HR's. */
export async function approveParentalPlan(planId: string): Promise<Outcome> {
  const a = await timeOff('ApproveTimeOffParentalPlan', { planId });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** The baby arrived: the mandatory weeks move to the birth. */
export async function recordParentalBirth(planId: string, birth: string): Promise<Outcome> {
  const a = await timeOff('RecordTimeOffParentalBirth', { planId, input: { birth } });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/**
 * A punch made afterwards (T21, MT18): the clock-out somebody forgot, at the
 * time they say, as a new punch beside the record (`supersedes: null`), never
 * an edit of it. Time Off decides whether they may and whether the manager
 * sees it beside the original.
 */
export async function correctPunch(input: {
  readonly personId: string;
  readonly supersedes: string | null;
  readonly at: string;
  readonly kind: 'in' | 'out' | 'break_start' | 'break_end';
  readonly reason: string | null;
}): Promise<Outcome> {
  const a = await timeOff('CorrectTimeOffPunch', { input });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/**
 * The attendance Requests tab (TOF-099): a report's overtime on a day, as
 * comp time or pay (what the rules allow; Time Off refuses anything else),
 * or declined.
 */
export async function decideOvertime(input: {
  readonly personId: string;
  readonly date: string;
  readonly approve: boolean;
  readonly choice: 'comp' | 'paid' | null;
}): Promise<Outcome> {
  const a = await timeOff('DecideTimeOffOvertime', { input });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/**
 * T28: send each person without a break their own message. The company's
 * name and its own origin come from this request, never the browser: Time
 * Off puts the origin in the link, and messaging checks it is the company's.
 */
export async function sendNudges(include: {
  readonly balance: boolean;
  readonly bridge: boolean;
  readonly losing: boolean;
}): Promise<
  | {
      readonly ok: true;
      readonly sent: number;
      readonly unreachable: number;
      readonly failed: number;
    }
  | { readonly ok: false; readonly message: string }
> {
  const inbound = await headers();
  const host = inbound.get('x-forwarded-host') ?? inbound.get('host') ?? '';
  const proto = inbound.get('x-forwarded-proto') ?? 'https';
  const tenant = await currentTenant();
  const a = await timeOff<{ sent: number; unreachable: number; failed: number }>(
    'SendTimeOffNudges',
    {
      input: {
        include,
        companyName: tenant?.branding.displayName ?? tenant?.slug ?? host,
        appOrigin: `${proto}://${host}`,
      },
    },
  );
  return a.ok ? { ok: true, ...a.data } : { ok: false, message: a.message };
}

/* ---------------------------------------- HR operations, TOF-096 onwards -- */

/** T24: send a month (`2026-09`) to Payroll; it locks, and later fixes go to the next. */
export async function closePayPeriod(month: string): Promise<Outcome> {
  const a = await timeOff('CloseTimeOffPayPeriod', { month });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/** T24: ask a team's late members (everyone's, without one) and their managers. */
export async function remindPayPeriod(month: string, teamKey: string | null): Promise<Outcome> {
  const a = await timeOff('RemindTimeOffPayPeriod', { month, input: { teamKey } });
  return a.ok ? { ok: true } : { ok: false, message: a.message };
}

/* ------------------------------------------- the manager's, TOF-068 to TOF-073 -- */

const outcome = (a: { ok: true } | { ok: false; message: string }): Outcome =>
  a.ok ? { ok: true } : { ok: false, message: a.message };

/**
 * Approve all (T16): Time Off approves only what triage calls clear and
 * says why not for the rest, which the screen then shows; the approved ones
 * stay approved either way.
 */
export async function approveRequests(requestIds: readonly string[]): Promise<Outcome> {
  const a = await timeOff<{ refused: readonly unknown[] }>('ApproveTimeOffRequests', {
    input: { requestIds },
  });
  if (!a.ok) return outcome(a);
  const refused = a.data.refused.length;
  return refused === 0
    ? { ok: true }
    : {
        ok: false,
        message: `${String(refused)} ${refused === 1 ? 'needs' : 'need'} a closer look and ${refused === 1 ? 'was' : 'were'} not approved.`,
      };
}

/** Approve or decline at the step waiting on the caller (T16, T17, T15's Approve anyway). */
export async function decideRequest(
  requestId: string,
  decision: 'approve' | 'decline',
): Promise<Outcome> {
  return outcome(await timeOff('DecideTimeOffRequest', { requestId, input: { decision } }));
}

/**
 * Other dates instead of a decline (T18, T15): up to three suggestions, each
 * runs of days, and what the approver wrote with them, which the member reads.
 */
export async function suggestDates(
  requestId: string,
  proposals: readonly { readonly spans: readonly { from: string; to: string }[] }[],
  message: string | null = null,
): Promise<Outcome> {
  return outcome(
    await timeOff('SuggestTimeOffDates', { requestId, input: { proposals, message } }),
  );
}

/** Who decides for the caller while they are away (T19). */
export async function setDelegation(
  approverId: string,
  choice: {
    readonly delegateId: string;
    readonly range: { from: string; to: string } | null;
    readonly automatic: boolean;
    readonly salaryRelated: boolean;
  },
): Promise<Outcome> {
  return outcome(await timeOff('SetTimeOffDelegation', { approverId, input: choice }));
}

export async function removeDelegation(approverId: string): Promise<Outcome> {
  return outcome(await timeOff('RemoveTimeOffDelegation', { approverId }));
}

/**
 * Subscribe (T12): a signed, revocable feed token for the scope, as the
 * address a calendar app polls. `TIMEOFF_FEED_BASE` is where Time Off's feed
 * is reachable from outside; nothing in the web app serves it.
 */
export async function subscribeCalendar(
  scope: 'team' | 'company' | 'me',
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const a = await timeOff<{ token: string }>('IssueTimeOffCalendarFeed', { input: { scope } });
  if (!a.ok) return { ok: false, message: a.message };
  const base =
    process.env['TIMEOFF_FEED_BASE'] ?? 'http://localhost:4002/v1/timeoff/calendar/feed.ics';
  return { ok: true, url: `${base}?token=${encodeURIComponent(a.data.token)}` };
}

/* ------------------------------------------------ the employee's screens -- */
/* TOF-062 to TOF-067: send, change, shorten, cancel, answer, subscribe.       */

interface Span {
  readonly from: string;
  readonly to: string;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
}

const done = (a: { readonly ok: boolean; readonly message?: string }): Outcome =>
  a.ok ? { ok: true } : { ok: false, message: a.message ?? 'Time Off did not answer' };

/**
 * T3, T5: send a request. Within a negative balance's limit sending is
 * borrowing (Time Off adds HR to the chain); the answer is the new
 * request's id, for the screen to open.
 */
export async function sendRequest(input: {
  readonly leaveTypeKey: string;
  readonly span: Span;
  readonly note: string | null;
}): Promise<
  | { readonly ok: true; readonly requestId: string }
  | { readonly ok: false; readonly message: string }
> {
  const a = await timeOff<{ requestId: string }>('RequestTimeOff', { input });
  return a.ok ? { ok: true, requestId: a.data.requestId } : { ok: false, message: a.message };
}

/** T7: move approved dates; the old ones stay booked until the new ones are approved. */
export async function changeRequest(requestId: string, span: Span): Promise<Outcome> {
  return done(await timeOff('ChangeTimeOffRequest', { requestId, input: { span } }));
}

/** T7: give the tail back from a new last day; approved at once. */
export async function shortenRequest(requestId: string, to: string): Promise<Outcome> {
  return done(await timeOff('ShortenTimeOffRequest', { requestId, input: { to } }));
}

/** T7: cancel an approved request, or withdraw one nobody has decided. */
export async function cancelRequest(requestId: string): Promise<Outcome> {
  return done(await timeOff('CancelTimeOffRequest', { requestId }));
}

/** T6: take suggestion `accept` (approved at once), or keep your own dates with null. */
export async function answerSuggestion(requestId: string, accept: number | null): Promise<Outcome> {
  return done(await timeOff('AnswerSuggestedTimeOffDates', { requestId, input: { accept } }));
}

/**
 * MT21: the caller's own calendar feed — their time off and the holidays
 * where they work — as the address a calendar app polls. The feed is the
 * one Time Off path a browser reaches without the router, so its origin is
 * `TIMEOFF_PUBLIC_URL` (the service itself in development).
 */
export async function subscribeToCalendar(): Promise<
  { readonly ok: true; readonly url: string } | { readonly ok: false; readonly message: string }
> {
  const a = await timeOff<{ token: string }>('IssueTimeOffCalendarFeed', {
    input: { scope: 'me' },
  });
  if (!a.ok) return { ok: false, message: a.message };
  const origin = (process.env['TIMEOFF_PUBLIC_URL'] ?? 'http://localhost:4002').replace(/\/$/, '');
  return {
    ok: true,
    url: `${origin}/v1/timeoff/calendar/feed.ics?token=${encodeURIComponent(a.data.token)}`,
  };
}
