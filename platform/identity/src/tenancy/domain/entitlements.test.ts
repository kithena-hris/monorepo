import { describe, expect, it } from 'vitest';

import { checkEntitlements, effectiveEntitlements } from './entitlements.js';

describe('which modules a company holds (PEO-114)', () => {
  it('keeps each known module once, in a stable order', () => {
    const checked = checkEntitlements(['module.timeoff', 'module.people', 'module.people']);
    expect(checked).toEqual({ ok: true, value: ['module.people', 'module.timeoff'] });
  });

  it('refuses a module that does not exist, rather than dropping it', () => {
    const checked = checkEntitlements(['module.people', 'module.payroll']);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.error.code).toBe('ENTITLEMENT_UNKNOWN');
      expect(checked.error.path).toEqual(['entitlements']);
    }
  });

  it('allows a company that bought nothing', () => {
    expect(checkEntitlements([])).toEqual({ ok: true, value: [] });
  });

  it('uses the deployment list only when nothing is recorded', () => {
    expect(effectiveEntitlements(null, ['module.people'])).toEqual(['module.people']);
    expect(effectiveEntitlements([], ['module.people'])).toEqual([]);
    expect(effectiveEntitlements(['module.timeoff'], ['module.people'])).toEqual([
      'module.timeoff',
    ]);
  });
});
