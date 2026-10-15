import { describe, expect, it } from 'vitest';

import {
  approvalState,
  chainFor,
  decide,
  edit,
  mayDecide,
  recordHire,
  resolveSteps,
  submit,
  type ApprovalChain,
  type Requisition,
} from './requisition.js';

const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

const draft: Requisition = {
  id: 'r1',
  title: 'Senior Backend Engineer',
  orgUnitId: 'payments',
  hiringManagerId: 'marco',
  legalEntityId: 'acme-de',
  locationIds: ['berlin'],
  openings: 2,
  filled: 0,
  targetStart: null,
  reason: 'new_role',
  replacesPersonId: null,
  budget: { from: eur(7_200_000), to: eur(8_800_000) },
  justification: 'Payments volume doubled',
  state: 'draft',
  approved: null,
};

const unwrap = <T>(r: { ok: true; value: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe('a requisition’s life (PRD §7.1)', () => {
  it('goes from draft to approved, then fills one opening at a time', () => {
    const approved = unwrap(decide(unwrap(submit(draft)), 'approved'));
    expect(approved.state).toBe('approved');
    const one = unwrap(recordHire(approved));
    expect(one).toMatchObject({ filled: 1, state: 'approved' });
    expect(unwrap(recordHire(one))).toMatchObject({ filled: 2, state: 'filled' });
  });

  it('refuses a backfill that does not say whom it replaces, and a budget upside down', () => {
    expect(submit({ ...draft, reason: 'backfill' })).toMatchObject({
      ok: false,
      error: { code: 'BACKFILL_WHO' },
    });
    expect(submit({ ...draft, budget: { from: eur(9), to: eur(1) } })).toMatchObject({
      ok: false,
      error: { code: 'BUDGET_ORDER' },
    });
  });

  it('returns to approval with the difference when the budget changes after approval', () => {
    const approved = unwrap(decide(unwrap(submit(draft)), 'approved'));
    const changed = unwrap(
      edit(approved, { ...approved, budget: { from: eur(7_200_000), to: eur(9_500_000) } }),
    );
    expect(changed.requisition.state).toBe('pending_approval');
    expect(changed.changes).toEqual([
      { field: 'budget', from: '7200000–8800000 EUR', to: '7200000–9500000 EUR' },
    ]);
  });

  it('keeps its approval when only the justification changes', () => {
    const approved = unwrap(decide(unwrap(submit(draft)), 'approved'));
    const changed = unwrap(edit(approved, { ...approved, justification: 'Clearer words' }));
    expect(changed).toMatchObject({ requisition: { state: 'approved' }, changes: [] });
  });
});

const chains: ApprovalChain[] = [
  {
    id: 'big',
    name: 'Large budget',
    appliesTo: 'requisition',
    priority: 1,
    when: { budgetAboveMinor: 10_000_000 },
    steps: [{ kind: 'managers_manager' }, { kind: 'role', role: 'finance' }],
  },
  {
    id: 'default',
    name: 'Default',
    appliesTo: 'requisition',
    priority: 9,
    when: {},
    steps: [{ kind: 'role', role: 'hr' }],
  },
  {
    id: 'band',
    name: 'Outside band',
    appliesTo: 'offer',
    priority: 1,
    when: { outsideBand: true },
    steps: [{ kind: 'role', role: 'hr' }],
  },
];

const facts = {
  budgetToMinor: 8_800_000,
  reason: 'new_role' as const,
  legalEntityId: 'acme-de',
  outsideBand: false,
  aboveBudget: false,
  grade: null,
};

describe('approval chains (PRD §7.2)', () => {
  it('chooses the first chain whose conditions hold', () => {
    expect(chainFor(chains, 'requisition', facts)?.id).toBe('default');
    expect(chainFor(chains, 'requisition', { ...facts, budgetToMinor: 12_000_000 })?.id).toBe(
      'big',
    );
    expect(chainFor(chains, 'offer', facts)).toBeNull();
    expect(chainFor(chains, 'offer', { ...facts, outsideBand: true })?.id).toBe('band');
  });

  const reporting = {
    managerOf: (id: string) => (id === 'marco' ? 'sofia' : null),
    holdersOf: (role: string) => (role === 'finance' ? ['fin1', 'fin2'] : ['ada']),
  };

  it('resolves the manager’s manager and the role holders', () => {
    const big = chains[0] as ApprovalChain;
    expect(unwrap(resolveSteps(big, 'marco', reporting))).toEqual([['sofia'], ['fin1', 'fin2']]);
    expect(resolveSteps(big, 'nobody', reporting)).toMatchObject({
      ok: false,
      error: { code: 'NOBODY_TO_APPROVE' },
    });
  });

  it('decides step by step; one rejection ends it', () => {
    const steps = [['sofia'], ['fin1', 'fin2']];
    expect(approvalState(steps, [])).toEqual({ outcome: 'pending', waitingOn: ['sofia'], step: 0 });
    expect(mayDecide(steps, [], 'fin1')).toBe(false);
    const first = [{ step: 0, by: 'sofia', decision: 'approved' as const }];
    expect(mayDecide(steps, first, 'fin2')).toBe(true);
    expect(
      approvalState(steps, [...first, { step: 1, by: 'fin2', decision: 'approved' }]).outcome,
    ).toBe('approved');
    expect(approvalState(steps, [{ step: 0, by: 'sofia', decision: 'rejected' }]).outcome).toBe(
      'rejected',
    );
  });
});
