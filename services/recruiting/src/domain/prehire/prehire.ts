import type {
  CalendarDate,
  ConditionKind,
  ConditionState,
  PrehireCancelReason,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The pre-hire (Recruiting PRD §21.3, REC-032): hired, with a start date
 * ahead, and the conditions that must be met before it — People's word,
 * `pre_hire`, because "provisional" already means something else there.
 */

export interface Condition {
  readonly kind: ConditionKind;
  readonly state: ConditionState;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
}

export type PrehireState = 'conditions_open' | 'conditions_met' | 'started' | 'cancelled';

export interface Prehire {
  readonly applicationId: string;
  readonly candidateId: string;
  readonly startDate: CalendarDate;
  readonly conditions: readonly Condition[];
  readonly state: PrehireState;
  readonly cancelReason: PrehireCancelReason | null;
}

const settled = (c: Condition) => c.state === 'met' || c.state === 'waived';

export function openPrehire(
  applicationId: string,
  candidateId: string,
  startDate: CalendarDate,
  kinds: readonly ConditionKind[],
): Prehire {
  const conditions = [...new Set(kinds)].map((kind) => ({
    kind,
    state: 'open' as const,
    decidedBy: null,
    decidedAt: null,
    note: null,
  }));
  return {
    applicationId,
    candidateId,
    startDate,
    conditions,
    state: conditions.length === 0 ? 'conditions_met' : 'conditions_open',
    cancelReason: null,
  };
}

/** A condition decided: met, waived or failed, with who and when. A failure never cancels by itself. */
export function decideCondition(
  prehire: Prehire,
  kind: ConditionKind,
  state: Exclude<ConditionState, 'open'>,
  by: string,
  at: string,
  note: string | null,
): Result<{ prehire: Prehire; allMet: boolean }> {
  if (prehire.state === 'cancelled' || prehire.state === 'started')
    return err(failure('PREHIRE_STATE', `This pre-hire is ${prehire.state}`));
  if (!prehire.conditions.some((c) => c.kind === kind))
    return err(failure('NO_CONDITION', 'No such condition on this hire'));
  if (state === 'waived' && (kind === 'right_to_work' || kind === 'work_permit')) {
    return err(
      failure('NOT_WAIVABLE', 'The right to work is a legal requirement and cannot be waived'),
    );
  }
  const conditions = prehire.conditions.map((c) =>
    c.kind === kind ? { ...c, state, decidedBy: by, decidedAt: at, note } : c,
  );
  const allMet = conditions.every(settled);
  const wasMet = prehire.state === 'conditions_met';
  return ok({
    prehire: { ...prehire, conditions, state: allMet ? 'conditions_met' : 'conditions_open' },
    allMet: allMet && !wasMet,
  });
}

/** What stands between the pre-hire and the start date (PRD §21.3): an open condition blocks it. */
export function blockers(prehire: Prehire, today: CalendarDate): readonly ConditionKind[] {
  if (today < prehire.startDate) return [];
  return prehire.conditions.filter((c) => !settled(c)).map((c) => c.kind);
}

export function cancelPrehire(prehire: Prehire, reason: PrehireCancelReason): Result<Prehire> {
  if (prehire.state === 'cancelled' || prehire.state === 'started')
    return err(failure('PREHIRE_STATE', `This pre-hire is ${prehire.state}`));
  return ok({ ...prehire, state: 'cancelled', cancelReason: reason });
}

export function moveStart(
  prehire: Prehire,
  to: CalendarDate,
  today: CalendarDate,
): Result<Prehire> {
  if (prehire.state === 'cancelled' || prehire.state === 'started')
    return err(failure('PREHIRE_STATE', `This pre-hire is ${prehire.state}`));
  if (to < today) return err(failure('START_PAST', 'The new start date has passed'));
  return ok({ ...prehire, startDate: to });
}
