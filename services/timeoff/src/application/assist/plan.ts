import type { CalendarDate, TenantId } from '@kithena/contracts';

import { addDays, daysBetween } from '../../domain/days.js';
import type { ParentalPlanView, View } from '../screens/views.js';
import type { Writer } from './ports.js';
import { templated, written, type Written } from './written.js';

/**
 * Why a parental plan is shaped the way it is (TOF-092, T9, T11, MT11): the
 * domain laid it out and checked it; this only says so.
 *
 * The child's date is health data (a due date is a pregnancy), so no date
 * reaches a model: each block is weeks after the child arrives and how many
 * weeks it lasts, with the entitlement's week counts and the notice it needs.
 */

type Plan = Omit<View<typeof ParentalPlanView>, 'explanation'>;

/** Whole weeks from `from` to `to`, both counted: 7 days is a week. */
const weeksOf = (from: CalendarDate, to: CalendarDate): number =>
  Math.round(daysBetween(from, to) / 7);

/** The flexible weeks booked straight after the mandatory ones, as one run. */
function runAfterMandatory(plan: Plan): number {
  const sorted = plan.blocks.toSorted((a, b) => a.from.localeCompare(b.from));
  let edge = sorted.find((b) => b.kind === 'mandatory')?.to;
  let run = 0;
  for (const b of sorted) {
    if (edge !== undefined && b.kind === 'flexible' && b.from === addDays(edge, 1)) {
      run += weeksOf(b.from, b.to);
      edge = b.to;
    }
  }
  return run;
}

export function planTemplate(plan: Plan): string {
  const e = plan.entitlement;
  const run = runAfterMandatory(plan);
  const shape =
    run > 0
      ? `${String(run)} of your ${String(e.flexibleWeeks)} flexible weeks follow the mandatory ${String(e.mandatoryWeeks)}, so most of your time is at the start.`
      : `Your ${String(e.flexibleWeeks)} flexible weeks are spread over the year after the mandatory ${String(e.mandatoryWeeks)}.`;
  const kept = plan.keptWeeks > 0 ? ` ${String(plan.keptWeeks)} weeks are kept for later.` : '';
  const notice =
    plan.reminders.length > 0
      ? ` Each flexible block needs ${String(e.noticeDays)} days’ notice, and Kithena reminds you.`
      : '';
  return `${shape}${kept}${notice}`;
}

export async function explainPlan(
  writer: Writer | undefined,
  tenantId: TenantId,
  plan: Plan,
): Promise<Written> {
  const template = planTemplate(plan);
  if (writer === undefined) return templated(template);
  const start = plan.childDate;
  const out = await written(
    writer,
    tenantId,
    {
      instruction:
        'A parent is planning their leave after a child arrives. The system laid out and checked ' +
        'the plan; explain its shape in two short sentences, to the parent as “you”. Weeks are ' +
        'counted from when the child arrives.',
      facts: {
        weeks: {
          mandatory: plan.entitlement.mandatoryWeeks,
          flexible: plan.entitlement.flexibleWeeks,
          later: plan.entitlement.laterWeeks,
          company: plan.entitlement.companyWeeks,
        },
        blocks: plan.blocks
          .toSorted((a, b) => a.from.localeCompare(b.from))
          .map((b) => ({
            kind: b.kind,
            startsWeeksAfter: Math.round((daysBetween(start, b.from) - 1) / 7),
            weeks: weeksOf(b.from, b.to),
          })),
        flexibleRightAfterMandatory: runAfterMandatory(plan),
        keptForLater: plan.keptWeeks,
        noticeDays: plan.entitlement.noticeDays,
        remindersSet: plan.reminders.length,
        rulesBroken: plan.problems.length,
      },
    },
    { why: { about: 'Why the plan has this shape.', template } },
  );
  return out.why;
}
