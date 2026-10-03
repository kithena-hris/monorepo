'use server';

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
 * The clock (T1's card, T2's pill): clock in, start or end a break, clock
 * out, from the web, at the work model the day is being worked at. The time
 * is Time Off's clock, not the browser's.
 */
export async function punch(
  kind: 'in' | 'out' | 'break_start' | 'break_end',
  workModel: 'office' | 'remote' | 'client',
): Promise<Outcome> {
  const a = await timeOff('PunchTimeOffClock', { input: { kind, workModel, source: 'web' } });
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

/** Other dates instead of a decline (T18, T15): up to three suggestions, each runs of days. */
export async function suggestDates(
  requestId: string,
  proposals: readonly { readonly spans: readonly { from: string; to: string }[] }[],
): Promise<Outcome> {
  return outcome(await timeOff('SuggestTimeOffDates', { requestId, input: { proposals } }));
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
