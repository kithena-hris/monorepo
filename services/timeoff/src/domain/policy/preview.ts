import type { DayAmount, PersonId, PolicyDefinition } from '@kithena/contracts';

import { entitlement, type Member } from '../balance/entitlement.js';
import type { EventContext } from '../context.js';
import { amount, days, Decimal, sum } from '../days.js';

/**
 * What publishing a draft would do to each member (PRD §6.3, T30): the same
 * fold the ledger runs, over the current version and over the draft, side by
 * side. Not an estimate, and nothing is posted.
 *
 * Per member, for one leave year: what each version grants, what would be
 * left at the year end if nothing more is booked, and how much of that the
 * carry-over cap lets go. A version that does not reach the member grants
 * nothing.
 */

export interface PreviewInput {
  readonly member: Member;
  /** The version in effect for them today; `null` when none reaches them. */
  readonly current: PolicyDefinition | null;
  /** The draft; `null` when it does not reach them. */
  readonly draft: PolicyDefinition | null;
  /** Taken and booked so far this leave year. */
  readonly spent: DayAmount;
  /** Carried into this leave year. */
  readonly carried: DayAmount;
}

interface Pair {
  readonly current: DayAmount;
  readonly draft: DayAmount;
}

export interface MemberPreview {
  readonly personId: PersonId;
  readonly allowance: Pair;
  /** Left at the year end if nothing more is booked. */
  readonly left: Pair;
  /** Lost at the year end above the carry-over cap (all of it without one). */
  readonly lostAtYearEnd: Pair;
}

function under(
  definition: PolicyDefinition | null,
  input: PreviewInput,
  year: number,
  ctx: Pick<EventContext, 'newId' | 'clock'>,
): { allowance: Decimal; left: Decimal; lost: Decimal } {
  const granted =
    definition === null
      ? new Decimal(0)
      : sum(
          entitlement(
            { policy: definition, policyVersion: 1, member: input.member, year },
            ctx,
          ).map((e) => days(e.amount)),
        );
  const left = days(input.carried).plus(granted).minus(input.spent);
  const cap = definition?.carryOver?.maxDays;
  const lost = Decimal.max(0, cap === undefined ? left : left.minus(cap));
  return { allowance: granted, left, lost };
}

export function previewChange(
  inputs: readonly PreviewInput[],
  year: number,
  ctx: Pick<EventContext, 'newId' | 'clock'>,
): MemberPreview[] {
  return inputs.map((input) => {
    const now = under(input.current, input, year, ctx);
    const next = under(input.draft, input, year, ctx);
    return {
      personId: input.member.personId,
      allowance: { current: amount(now.allowance), draft: amount(next.allowance) },
      left: { current: amount(now.left), draft: amount(next.left) },
      lostAtYearEnd: { current: amount(now.lost), draft: amount(next.lost) },
    };
  });
}
