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
