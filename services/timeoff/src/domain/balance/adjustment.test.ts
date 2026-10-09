import { describe, expect, it } from 'vitest';
import { LeaveTypeKey } from '@kithena/contracts';

import { ADAM, context, date } from '../fixtures.js';
import { decideAdjustment, proposeAdjustment } from './adjustment.js';

const vacation = LeaveTypeKey.parse('vacation');
const ask = (over: Record<string, unknown> = {}) => ({
  personId: ADAM,
  leaveTypeKey: vacation,
  amount: '2.000',
  effectiveOn: date('2026-10-01'),
  reason: 'Worked the offsite weekend',
  proposedBy: 'acct-hr',
  byHr: true,
  ...over,
});

describe('a balance adjustment (PRD §7.1: an HR correction, always with a reason)', () => {
  it('from HR is approved as it is made', () => {
    const made = proposeAdjustment(ask(), context());
    expect(made).toMatchObject({
      ok: true,
      value: { status: 'approved', amount: '2.000', decidedBy: 'acct-hr' },
    });
  });

  it('from a manager waits for HR', () => {
    const made = proposeAdjustment(ask({ byHr: false, proposedBy: 'acct-marco' }), context());
    expect(made).toMatchObject({ ok: true, value: { status: 'pending', decidedBy: null } });
  });

  it('always says why, and changes something', () => {
    expect(proposeAdjustment(ask({ reason: '   ' }), context())).toMatchObject({
      ok: false,
      error: { code: 'REASON_REQUIRED', path: ['reason'] },
    });
    expect(proposeAdjustment(ask({ amount: '0.000' }), context())).toMatchObject({
      ok: false,
      error: { code: 'NOTHING_TO_ADJUST', path: ['amount'] },
    });
    expect(proposeAdjustment(ask({ amount: '-1.500' }), context())).toMatchObject({ ok: true });
  });

  it('is decided once, by someone other than who asked', () => {
    const made = proposeAdjustment(ask({ byHr: false, proposedBy: 'acct-marco' }), context());
    if (!made.ok) throw new Error('not made');
    expect(
      decideAdjustment(made.value, { approve: true, by: 'acct-marco' }, context()),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const approved = decideAdjustment(made.value, { approve: true, by: 'acct-hr' }, context());
    expect(approved).toMatchObject({
      ok: true,
      value: { status: 'approved', decidedBy: 'acct-hr' },
    });
    if (!approved.ok) throw new Error('not approved');
    expect(
      decideAdjustment(approved.value, { approve: false, by: 'acct-hr' }, context()),
    ).toMatchObject({ ok: false, error: { code: 'ALREADY_DECIDED' } });
  });
});
