import { describe, expect, it } from 'vitest';

import { deploymentEntitlements, ModuleEntitlement, moduleEntitlements } from './entitlements.js';

describe('module entitlements (PEO-114)', () => {
  it('accepts a module that exists and nothing else', () => {
    expect(ModuleEntitlement.safeParse('module.people').success).toBe(true);
    expect(ModuleEntitlement.safeParse('module.payroll').success).toBe(false);
    expect(ModuleEntitlement.safeParse('people').success).toBe(false);
  });

  it('keeps the known ones, once each, sorted', () => {
    expect(
      moduleEntitlements(['module.timeoff', 'module.people', 'module.people', 'x', 3]),
    ).toEqual(['module.people', 'module.timeoff']);
  });

  it('reads the deployment list, and treats nonsense as none', () => {
    expect(deploymentEntitlements('["module.people"]')).toEqual(['module.people']);
    expect(deploymentEntitlements('not json')).toEqual([]);
    expect(deploymentEntitlements('{"a":1}')).toEqual([]);
    expect(deploymentEntitlements(undefined)).toEqual([]);
  });
});
