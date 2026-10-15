import type { CalendarDate, ProbationOutcome } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { addMonths } from './plan.js';

/**
 * The probation review (Recruiting PRD §O8, ONB-005). The manager decides, or
 * HR; an extension only where the terms pack allows one and by no more than it
 * allows. Ending a probation is People's termination flow; this only records
 * the outcome, which People keeps as `probation_outcome`.
 */
export function decideProbation(
  facts: {
    readonly end: CalendarDate;
    readonly managerId: string | null;
    /** From the hire's terms pack; null where the country allows none. */
    readonly allowedExtensionMonths: number | null;
  },
  deciderId: string,
  deciderIsHr: boolean,
  outcome: ProbationOutcome,
  extendMonths: number | null,
): Result<{ outcome: ProbationOutcome; probationEnd: CalendarDate | null }> {
  if (deciderId !== facts.managerId && !deciderIsHr)
    return err(failure('FORBIDDEN', 'The manager or HR decides a probation'));
  if (outcome !== 'extended') return ok({ outcome, probationEnd: null });
  const allowed = facts.allowedExtensionMonths ?? 0;
  if (allowed === 0)
    return err(failure('NO_EXTENSION', 'This contract’s probation cannot be extended'));
  if (extendMonths === null || extendMonths < 1 || extendMonths > allowed)
    return err(failure('EXTENSION_TOO_LONG', `Extend by 1 to ${String(allowed)} months`));
  return ok({ outcome, probationEnd: addMonths(facts.end, extendMonths) });
}
