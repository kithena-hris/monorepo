import { describe, expect, it } from 'vitest';
import type { ModuleEntitlement } from '@kithena/contracts';

import { nameAdministrator, setEntitlements, type ModulesDeps } from './set-entitlements.js';

const ACME = '00000000-0000-4000-8000-00000000000a';
const ADA = '00000000-0000-4000-8000-0000000000a1';
const LEFT = '00000000-0000-4000-8000-0000000000a2';
const GRACE = '00000000-0000-4000-8000-0000000000a3';
const OPERATOR = '00000000-0000-4000-8000-0000000000f1';

/** A registry of one company, whose list starts unrecorded; the default is `defaults`. */
function registry(defaults: ModuleEntitlement[] = []) {
  let stored: readonly ModuleEntitlement[] | null = null;
  const writes: (readonly ModuleEntitlement[])[] = [];
  const named: string[] = [];
  const removed: string[] = [];
  const held: Record<string, string[]> = {};
  const deps: ModulesDeps = {
    inTenant: (tenantId, fn) =>
      fn({
        modules: () =>
          Promise.resolve(
            tenantId === ACME ? { recorded: stored, effective: stored ?? defaults } : null,
          ),
        accountStatus: (id) =>
          Promise.resolve(
            id === ADA || id === GRACE ? 'invited' : id === LEFT ? 'terminated' : null,
          ),
        administrators: () => Promise.resolve(structuredClone(held)),
        save: (entitlements) => {
          stored = entitlements;
          writes.push(entitlements);
          return Promise.resolve();
        },
        name: (a, by) => {
          named.push(`${a.entitlement} ${a.accountId} ${String(by)}`);
          const list = (held[a.entitlement] ??= []);
          if (!list.includes(a.accountId)) list.push(a.accountId);
          return Promise.resolve();
        },
        remove: (a, by) => {
          removed.push(`${a.entitlement} ${a.accountId} ${String(by)}`);
          held[a.entitlement] = (held[a.entitlement] ?? []).filter((id) => id !== a.accountId);
          return Promise.resolve();
        },
      }),
  };
  return {
    writes,
    named,
    removed,
    held,
    stored: () => stored,
    set: setEntitlements(deps),
    name: nameAdministrator(deps),
  };
}

describe('recording which modules a company bought (PEO-114)', () => {
  it('records the list, normalised', async () => {
    const r = registry();
    const set = await r.set(ACME, {
      entitlements: ['module.timeoff'],
      administrators: { 'module.timeoff': [ADA] },
    });
    expect(set.ok && set.value).toMatchObject({ entitlements: ['module.timeoff'], changed: true });
    expect(r.stored()).toEqual(['module.timeoff']);
  });

  it('writes nothing, and says so, when the list did not change', async () => {
    const r = registry();
    await r.set(ACME, {
      entitlements: ['module.timeoff'],
      administrators: { 'module.timeoff': [ADA] },
    });
    const again = await r.set(ACME, { entitlements: ['module.timeoff'] });
    expect(again.ok && again.value.changed).toBe(false);
    expect(r.writes).toHaveLength(1);
  });

  it('refuses an unknown module without writing', async () => {
    const r = registry();
    const set = await r.set(ACME, { entitlements: ['module.people', 'module.crypto'] });
    expect(set.ok).toBe(false);
    expect(r.writes).toHaveLength(0);
  });

  it('refuses a company that does not exist', async () => {
    const set = await registry().set('00000000-0000-4000-8000-00000000000b', {
      entitlements: [],
    });
    expect(set.ok ? null : set.error.code).toBe('TENANT_UNKNOWN');
  });
});

describe('naming who administers People (PEO-112)', () => {
  it('will not switch People on without an administrator, and writes nothing', async () => {
    const r = registry();
    const set = await r.set(ACME, { entitlements: ['module.people'] });
    expect(set.ok ? null : set.error.code).toBe('ADMINISTRATOR_REQUIRED');
    expect(r.writes).toEqual([]);
  });

  it('switches People on and names the administrator, with the operator', async () => {
    const r = registry();
    const set = await r.set(ACME, {
      entitlements: ['module.people'],
      administrators: { 'module.people': ADA },
      namedBy: OPERATOR,
    });
    expect(set.ok).toBe(true);
    expect(r.writes).toEqual([['module.people']]);
    expect(r.named).toEqual([`module.people ${ADA} ${OPERATOR}`]);
  });

  it('refuses an account that has left, or is not at the company', async () => {
    for (const account of [LEFT, '00000000-0000-4000-8000-0000000000ff']) {
      const r = registry();
      const set = await r.set(ACME, {
        entitlements: ['module.people'],
        administrators: { 'module.people': account },
      });
      expect(set.ok ? null : set.error.code).toBe('ADMINISTRATOR_UNUSABLE');
      expect(r.writes).toEqual([]);
    }
  });

  it('asks for nobody when People was already on by default', async () => {
    const r = registry(['module.people']);
    expect((await r.set(ACME, { entitlements: ['module.people'] })).ok).toBe(true);
    expect(r.named).toEqual([]);
  });

  it('names several at once, the same ones for every module switched on', async () => {
    const r = registry();
    const set = await r.set(ACME, {
      entitlements: ['module.people', 'module.timeoff'],
      administrators: { 'module.people': [ADA, GRACE], 'module.timeoff': [ADA, GRACE] },
      namedBy: OPERATOR,
    });
    expect(set.ok).toBe(true);
    expect(r.named).toEqual([
      `module.people ${ADA} ${OPERATOR}`,
      `module.people ${GRACE} ${OPERATOR}`,
      `module.timeoff ${ADA} ${OPERATOR}`,
      `module.timeoff ${GRACE} ${OPERATOR}`,
    ]);
  });

  it('adds and removes administrators of a module already on, with the operator', async () => {
    const r = registry(['module.people']);
    await r.set(ACME, { entitlements: ['module.people'], administrators: { 'module.people': [ADA] } });
    const set = await r.set(ACME, {
      entitlements: ['module.people'],
      administrators: { 'module.people': [GRACE] },
      namedBy: OPERATOR,
    });
    expect(set.ok && set.value).toMatchObject({
      named: [{ entitlement: 'module.people', accountId: GRACE }],
      removed: [{ entitlement: 'module.people', accountId: ADA }],
    });
    expect(r.removed).toEqual([`module.people ${ADA} ${OPERATOR}`]);
    expect(r.held['module.people']).toEqual([GRACE]);
  });

  it('refuses to remove the last administrator, and writes nothing', async () => {
    const r = registry(['module.people']);
    await r.set(ACME, { entitlements: ['module.people'], administrators: { 'module.people': [ADA] } });
    const writes = r.writes.length;
    const set = await r.set(ACME, {
      entitlements: ['module.people', 'module.timeoff'],
      administrators: { 'module.people': [], 'module.timeoff': [ADA] },
    });
    expect(set.ok ? null : set.error.code).toBe('LAST_ADMINISTRATOR');
    expect(r.writes).toHaveLength(writes);
    expect(r.removed).toEqual([]);
  });

  it('names an administrator for a company that has People, and only then', async () => {
    const off = registry();
    const refused = await off.name(ACME, { entitlement: 'module.people', accountId: ADA });
    expect(refused.ok ? null : refused.error.code).toBe('MODULE_NOT_ENABLED');

    const on = registry(['module.people']);
    expect((await on.name(ACME, { entitlement: 'module.people', accountId: ADA })).ok).toBe(true);
    expect(on.named).toEqual([`module.people ${ADA} null`]);

    const timeoff = await on.name(ACME, { entitlement: 'module.timeoff', accountId: ADA });
    expect(timeoff.ok ? null : timeoff.error.code).toBe('MODULE_NOT_ENABLED');
  });
});
