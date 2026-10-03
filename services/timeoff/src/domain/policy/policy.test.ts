import { describe, expect, it } from 'vitest';
import { PolicyDefinition, PolicyPublished } from '@kithena/contracts';

import { context, date, TENANT } from '../fixtures.js';
import { Policy, policyId } from './policy.js';

const v1 = PolicyDefinition.parse({ leaveTypeKey: 'vacation', allowance: [{ fromYears: 0, days: '25.000' }] });
const v2 = PolicyDefinition.parse({ leaveTypeKey: 'vacation', allowance: [{ fromYears: 0, days: '26.000' }] });
const id = policyId('0189aaaa-0000-7000-8000-000000000001');

const published = (): Policy => {
  const policy = Policy.draft({ id, tenantId: TENANT, definition: v1 });
  const result = policy.publish(date('2026-01-01'), context());
  if (!result.ok) throw new Error(result.error.message);
  return policy;
};

describe('Policy', () => {
  it('starts as a draft at version 1 that can be revised in place', () => {
    const policy = Policy.draft({ id, tenantId: TENANT, definition: v1 });
    expect(policy.revise(v2).ok).toBe(true);
    expect(policy.versions.map((v) => [v.version, v.status])).toEqual([[1, 'draft']]);
    expect(policy.latest.definition).toEqual(v2);
  });

  it('publishes, raising policy.published with the date balances re-fold from', () => {
    const policy = published();
    const [event] = policy.drainEvents();
    expect(event?.eventName).toBe(PolicyPublished.name);
    expect(event?.effectiveFrom).toBe('2026-01-01');
    expect(event?.payload).toEqual({ policyId: id, version: 1, leaveTypeKey: 'vacation', effectiveFrom: '2026-01-01' });
  });

  it('never changes a published version: a revision becomes the next draft', () => {
    const policy = published();
    expect(policy.revise(v2).ok).toBe(true);
    expect(policy.versions.map((v) => [v.version, v.status])).toEqual([
      [1, 'published'],
      [2, 'draft'],
    ]);
    expect(policy.at(1)?.definition).toEqual(v1);
    expect(Object.isFrozen(policy.at(1)?.definition)).toBe(true);
  });

  it('refuses to publish when there is no draft', () => {
    const result = published().publish(date('2026-06-01'), context());
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('NOTHING_TO_PUBLISH');
  });

  it('refuses a version that takes effect before the one it follows', () => {
    const policy = published();
    policy.revise(v2);
    const result = policy.publish(date('2025-12-31'), context());
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('EFFECTIVE_BEFORE_PREVIOUS');
  });

  it('refuses to move a policy to another leave type', () => {
    const result = published().revise({ ...v2, leaveTypeKey: 'personal' as typeof v2.leaveTypeKey });
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('LEAVE_TYPE_FIXED');
  });

  it('answers which published version is in effect on a date', () => {
    const policy = published();
    policy.revise(v2);
    policy.publish(date('2026-07-01'), context());
    expect(policy.inEffectOn(date('2025-12-31'))).toBeNull();
    expect(policy.inEffectOn(date('2026-03-01'))?.version).toBe(1);
    expect(policy.inEffectOn(date('2026-07-01'))?.version).toBe(2);
  });
});
