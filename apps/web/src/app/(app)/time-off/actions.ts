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
