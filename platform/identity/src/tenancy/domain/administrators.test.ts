import { describe, expect, it } from 'vitest';

import { administratorChanges, mayAdminister } from './administrators.js';

const ADA = '00000000-0000-4000-8000-0000000000a1';
const GRACE = '00000000-0000-4000-8000-0000000000a2';
const PEOPLE = 'module.people';
const TIMEOFF = 'module.timeoff';

describe('who administers a module, when it is switched on (PEO-112)', () => {
  it('requires an administrator for every administered module switched on', () => {
    for (const module of [PEOPLE, TIMEOFF] as const) {
      const named = administratorChanges([], [module], {}, {});
      expect(named.ok ? null : named.error).toMatchObject({
        code: 'ADMINISTRATOR_REQUIRED',
        path: ['administrators', module],
      });
    }
    const empty = administratorChanges([], [PEOPLE], {}, { [PEOPLE]: [] });
    expect(empty.ok ? null : empty.error.code).toBe('ADMINISTRATOR_REQUIRED');
  });

  it('names the one given, in the older single form', () => {
    expect(administratorChanges([], [PEOPLE], {}, { [PEOPLE]: ADA })).toEqual({
      ok: true,
      value: { named: [{ entitlement: PEOPLE, accountId: ADA }], removed: [] },
    });
  });

  it('names several, once each, and the same ones for several modules', () => {
    const changes = administratorChanges(
      [],
      [PEOPLE, TIMEOFF],
      {},
      { [PEOPLE]: [ADA, GRACE, ADA], [TIMEOFF]: [ADA, GRACE] },
    );
    expect(changes.ok && changes.value.named).toEqual([
      { entitlement: PEOPLE, accountId: ADA },
      { entitlement: PEOPLE, accountId: GRACE },
      { entitlement: TIMEOFF, accountId: ADA },
      { entitlement: TIMEOFF, accountId: GRACE },
    ]);
  });

  it('asks nothing of a module already on and not mentioned', () => {
    expect(administratorChanges([PEOPLE], [PEOPLE], { [PEOPLE]: [ADA] }, {})).toEqual({
      ok: true,
      value: { named: [], removed: [] },
    });
  });

  it('turns a list into who to add and who to remove', () => {
    const changes = administratorChanges(
      [PEOPLE],
      [PEOPLE],
      { [PEOPLE]: [ADA] },
      { [PEOPLE]: [GRACE] },
    );
    expect(changes.ok && changes.value).toEqual({
      named: [{ entitlement: PEOPLE, accountId: GRACE }],
      removed: [{ entitlement: PEOPLE, accountId: ADA }],
    });
    const same = administratorChanges([PEOPLE], [PEOPLE], { [PEOPLE]: [ADA] }, { [PEOPLE]: [ADA] });
    expect(same.ok && same.value).toEqual({ named: [], removed: [] });
  });

  it('never removes the last administrator', () => {
    const changes = administratorChanges([PEOPLE], [PEOPLE], { [PEOPLE]: [ADA] }, { [PEOPLE]: [] });
    expect(changes.ok ? null : changes.error).toMatchObject({
      code: 'LAST_ADMINISTRATOR',
      path: ['administrators', PEOPLE],
    });
  });

  it('leaves a module that never had one named as it is when sent none', () => {
    expect(administratorChanges([PEOPLE], [PEOPLE], {}, { [PEOPLE]: [] })).toEqual({
      ok: true,
      value: { named: [], removed: [] },
    });
  });

  it('still names one again in the single form, for a company that lost them', () => {
    const named = administratorChanges([PEOPLE], [PEOPLE], { [PEOPLE]: [ADA] }, { [PEOPLE]: ADA });
    expect(named.ok && named.value.named).toEqual([{ entitlement: PEOPLE, accountId: ADA }]);
  });

  it('refuses an administrator for a module the company does not have', () => {
    const named = administratorChanges([], [], {}, { [PEOPLE]: [ADA] });
    expect(named.ok ? null : named.error.code).toBe('MODULE_NOT_ENABLED');
  });

  it('refuses something that is not an account id', () => {
    const named = administratorChanges([], [PEOPLE], {}, { [PEOPLE]: [ADA, 'ada'] });
    expect(named.ok ? null : named.error.code).toBe('ADMINISTRATOR_REQUIRED');
  });

  it('lets an account administer only while it can still sign in', () => {
    expect(['provisioned', 'invited', 'active'].every(mayAdminister)).toBe(true);
    expect(['suspended', 'terminated', 'nonsense'].some(mayAdminister)).toBe(false);
  });
});
