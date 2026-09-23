import { describe, expect, it } from 'vitest';

import { administratorsToName, mayAdminister } from './administrators.js';

const ADA = '00000000-0000-4000-8000-0000000000a1';

describe('who administers a module, when it is switched on (PEO-112)', () => {
  it('requires an administrator for People when People is switched on', () => {
    const named = administratorsToName([], ['module.people'], {});
    expect(named.ok ? null : named.error).toMatchObject({
      code: 'ADMINISTRATOR_REQUIRED',
      path: ['administrators', 'module.people'],
    });
  });

  it('names the one given', () => {
    expect(administratorsToName([], ['module.people'], { 'module.people': ADA })).toEqual({
      ok: true,
      value: [{ entitlement: 'module.people', accountId: ADA }],
    });
  });

  it('asks nothing of a module that needs no administrator, or one already on', () => {
    expect(administratorsToName([], ['module.timeoff'], {})).toEqual({ ok: true, value: [] });
    expect(administratorsToName(['module.people'], ['module.people'], {})).toEqual({
      ok: true,
      value: [],
    });
  });

  it('still names one for a module already on, when asked', () => {
    const named = administratorsToName(['module.people'], ['module.people'], {
      'module.people': ADA,
    });
    expect(named.ok && named.value).toEqual([{ entitlement: 'module.people', accountId: ADA }]);
  });

  it('refuses an administrator for a module the company does not have', () => {
    const named = administratorsToName([], [], { 'module.people': ADA });
    expect(named.ok ? null : named.error.code).toBe('MODULE_NOT_ENABLED');
  });

  it('refuses something that is not an account id', () => {
    const named = administratorsToName([], ['module.people'], { 'module.people': 'ada' });
    expect(named.ok ? null : named.error.code).toBe('ADMINISTRATOR_REQUIRED');
  });

  it('lets an account administer only while it can still sign in', () => {
    expect(['provisioned', 'invited', 'active'].every(mayAdminister)).toBe(true);
    expect(['suspended', 'terminated', 'nonsense'].some(mayAdminister)).toBe(false);
  });
});
