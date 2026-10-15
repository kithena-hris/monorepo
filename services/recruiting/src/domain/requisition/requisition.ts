import type { CalendarDate, Money } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * A request for headcount (Recruiting PRD §7, REC-015).
 *
 * `draft → pending_approval → approved | rejected | cancelled`, then `filled`
 * when every opening has a hire. A change to the budget or the openings after
 * approval sends it back for approval with the difference.
 */

export type RequisitionState =
  'draft' | 'pending_approval' | 'approved' | 'rejected' | 'cancelled' | 'filled';
export type RequisitionReason = 'new_role' | 'backfill' | 'temporary_cover' | 'growth';

export interface Budget {
  readonly from: Money;
  readonly to: Money;
}

export interface Requisition {
  readonly id: string;
  readonly title: string;
  readonly orgUnitId: string | null;
  readonly hiringManagerId: string | null;
  readonly legalEntityId: string | null;
  readonly locationIds: readonly string[];
  readonly openings: number;
  readonly filled: number;
  readonly targetStart: CalendarDate | null;
  readonly reason: RequisitionReason;
  readonly replacesPersonId: string | null;
  readonly budget: Budget | null;
  readonly justification: string;
  readonly state: RequisitionState;
  /** The values an approver last approved, to show what changed since. */
  readonly approved: { readonly openings: number; readonly budget: Budget | null } | null;
}

export interface RequisitionChange {
  readonly field: 'openings' | 'budget';
  readonly from: string;
  readonly to: string;
}

const budgetText = (budget: Budget | null): string =>
  budget === null
    ? 'none'
    : `${String(budget.from.amountMinor)}–${String(budget.to.amountMinor)} ${budget.from.currency}`;

export function validRequisition(r: Requisition): Result<Requisition> {
  if (r.title.trim() === '')
    return err(failure('TITLE_REQUIRED', 'Give the role a title', ['title']));
  if (!Number.isInteger(r.openings) || r.openings < 1) {
    return err(failure('OPENINGS', 'At least one opening', ['openings']));
  }
  if (r.reason === 'backfill' && r.replacesPersonId === null) {
    return err(
      failure('BACKFILL_WHO', 'A backfill names the person it replaces', ['replacesPersonId']),
    );
  }
  if (r.budget !== null) {
    if (r.budget.from.currency !== r.budget.to.currency) {
      return err(
        failure('BUDGET_CURRENCY', 'Both ends of the budget are in one currency', ['budget']),
      );
    }
    if (r.budget.from.amountMinor > r.budget.to.amountMinor) {
      return err(
        failure('BUDGET_ORDER', 'The budget’s lower end is above its upper end', ['budget']),
      );
    }
  }
  return ok(r);
}

export function submit(r: Requisition): Result<Requisition> {
  if (r.state !== 'draft' && r.state !== 'approved') {
    return err(failure('NOT_SUBMITTABLE', `A ${r.state} requisition cannot be sent for approval`));
  }
  const valid = validRequisition(r);
  return valid.ok ? ok({ ...r, state: 'pending_approval' }) : valid;
}

export function decide(r: Requisition, decision: 'approved' | 'rejected'): Result<Requisition> {
  if (r.state !== 'pending_approval')
    return err(failure('NOT_PENDING', 'Only a requisition awaiting approval is decided'));
  return ok({
    ...r,
    state: decision,
    approved: decision === 'approved' ? { openings: r.openings, budget: r.budget } : r.approved,
  });
}

/**
 * An edit. After approval, a change to the openings or the budget returns the
 * requisition to approval and says what changed (PRD §7.2).
 */
export function edit(
  r: Requisition,
  next: Requisition,
): Result<{ readonly requisition: Requisition; readonly changes: readonly RequisitionChange[] }> {
  if (r.state === 'cancelled' || r.state === 'filled' || r.state === 'rejected') {
    return err(failure('CLOSED', `A ${r.state} requisition cannot be edited`));
  }
  const valid = validRequisition(next);
  if (!valid.ok) return valid;
  const changes: RequisitionChange[] = [];
  const base = r.approved;
  if (base !== null && r.state === 'approved') {
    if (base.openings !== next.openings) {
      changes.push({ field: 'openings', from: String(base.openings), to: String(next.openings) });
    }
    if (budgetText(base.budget) !== budgetText(next.budget)) {
      changes.push({ field: 'budget', from: budgetText(base.budget), to: budgetText(next.budget) });
    }
  }
  return ok({
    requisition: {
      ...next,
      state: changes.length > 0 ? 'pending_approval' : r.state,
      approved: r.approved,
    },
    changes,
  });
}

export function cancel(r: Requisition): Result<Requisition> {
  if (r.state === 'filled' || r.state === 'cancelled')
    return err(failure('CLOSED', `Already ${r.state}`));
  return ok({ ...r, state: 'cancelled' });
}

/** One opening hired; the last one fills it. */
export function recordHire(r: Requisition): Result<Requisition> {
  if (r.state !== 'approved')
    return err(failure('NOT_APPROVED', 'Only an approved requisition is hired against'));
  const filled = r.filled + 1;
  if (filled > r.openings) return err(failure('NO_OPENING', 'Every opening is already filled'));
  return ok({ ...r, filled, state: filled === r.openings ? 'filled' : 'approved' });
}

/* ------------------------------------------------------ approval chains -- */

/** Who approves a step (PRD §7.2): a person, a role, or the manager's manager. */
export type Approver =
  | { readonly kind: 'person'; readonly personId: string }
  | { readonly kind: 'role'; readonly role: 'hr' | 'finance' | 'recruiting_admin' }
  | { readonly kind: 'managers_manager' };

/** When a chain applies. Every condition given must hold. */
export interface ChainCondition {
  readonly budgetAboveMinor?: number;
  readonly reasons?: readonly RequisitionReason[];
  readonly legalEntityIds?: readonly string[];
  /** Offers (§18.3): outside the band, above budget, an executive grade. */
  readonly outsideBand?: boolean;
  readonly aboveBudget?: boolean;
  readonly grades?: readonly string[];
}

export interface ApprovalChain {
  readonly id: string;
  readonly name: string;
  readonly appliesTo: 'requisition' | 'offer';
  /** Lower first; the first chain whose conditions hold is used. */
  readonly priority: number;
  readonly when: ChainCondition;
  readonly steps: readonly Approver[];
}

export interface ChainFacts {
  readonly budgetToMinor: number | null;
  readonly reason: RequisitionReason | null;
  readonly legalEntityId: string | null;
  readonly outsideBand: boolean;
  readonly aboveBudget: boolean;
  readonly grade: string | null;
}

function holds(when: ChainCondition, facts: ChainFacts): boolean {
  if (when.budgetAboveMinor !== undefined && (facts.budgetToMinor ?? 0) <= when.budgetAboveMinor)
    return false;
  if (when.reasons !== undefined && (facts.reason === null || !when.reasons.includes(facts.reason)))
    return false;
  if (
    when.legalEntityIds !== undefined &&
    (facts.legalEntityId === null || !when.legalEntityIds.includes(facts.legalEntityId))
  ) {
    return false;
  }
  if (when.outsideBand === true && !facts.outsideBand) return false;
  if (when.aboveBudget === true && !facts.aboveBudget) return false;
  if (when.grades !== undefined && (facts.grade === null || !when.grades.includes(facts.grade)))
    return false;
  return true;
}

/** The chain for these facts; none means approval is not needed. */
export function chainFor(
  chains: readonly ApprovalChain[],
  appliesTo: ApprovalChain['appliesTo'],
  facts: ChainFacts,
): ApprovalChain | null {
  return (
    chains
      .filter((chain) => chain.appliesTo === appliesTo)
      .toSorted((a, b) => a.priority - b.priority)
      .find((chain) => holds(chain.when, facts)) ?? null
  );
}

export interface Reporting {
  /** The manager of a member, from the member projection's reporting line. */
  managerOf(personId: string): string | null;
  holdersOf(role: 'hr' | 'finance' | 'recruiting_admin'): readonly string[];
}

/**
 * The people who approve each step, resolved. A step with nobody to approve
 * it (no manager's manager on record) is an error, never skipped silently.
 */
export function resolveSteps(
  chain: ApprovalChain,
  hiringManagerId: string | null,
  reporting: Reporting,
): Result<readonly (readonly string[])[]> {
  const steps: string[][] = [];
  for (const [index, step] of chain.steps.entries()) {
    const people =
      step.kind === 'person'
        ? [step.personId]
        : step.kind === 'role'
          ? [...reporting.holdersOf(step.role)]
          : (() => {
              const manager =
                hiringManagerId === null ? null : reporting.managerOf(hiringManagerId);
              return manager === null ? [] : [manager];
            })();
    if (people.length === 0) {
      return err(
        failure(
          'NOBODY_TO_APPROVE',
          `Step ${String(index + 1)} of “${chain.name}” has nobody to approve it`,
        ),
      );
    }
    steps.push(people);
  }
  return ok(steps);
}

export type ApprovalDecision = 'approved' | 'rejected';

export interface StepDecision {
  readonly step: number;
  readonly by: string;
  readonly decision: ApprovalDecision;
}

/**
 * Where an approval stands: the step waiting, or the outcome. Steps are in
 * order; any one person on a step decides it; one rejection ends the chain.
 */
export function approvalState(
  steps: readonly (readonly string[])[],
  decisions: readonly StepDecision[],
): {
  readonly outcome: 'pending' | ApprovalDecision;
  readonly waitingOn: readonly string[];
  readonly step: number;
} {
  for (const [index, people] of steps.entries()) {
    const decided = decisions.find((d) => d.step === index && people.includes(d.by));
    if (decided === undefined) return { outcome: 'pending', waitingOn: people, step: index };
    if (decided.decision === 'rejected') return { outcome: 'rejected', waitingOn: [], step: index };
  }
  return { outcome: 'approved', waitingOn: [], step: steps.length };
}

/** Whether this person may decide the step now. */
export function mayDecide(
  steps: readonly (readonly string[])[],
  decisions: readonly StepDecision[],
  personId: string,
): boolean {
  const state = approvalState(steps, decisions);
  return state.outcome === 'pending' && state.waitingOn.includes(personId);
}
