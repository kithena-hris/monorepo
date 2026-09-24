import { describe, expect, it } from 'vitest';
import type { ModuleEntitlement } from '@kithena/contracts';

import { setEntitlements } from './set-entitlements.js';

const ACME = '00000000-0000-4000-8000-00000000000a';

/** A registry of one company, whose list starts unrecorded. */
function registry() {
  let stored: readonly ModuleEntitlement[] | null = null;
  const writes: (readonly ModuleEntitlement[])[] = [];
  return {
    writes,
    stored: () => stored,
    set: setEntitlements({
      write: (tenantId, entitlements) => {
        if (tenantId !== ACME) return Promise.resolve('unknown');
        if (JSON.stringify(stored) === JSON.stringify(entitlements)) {
          return Promise.resolve('unchanged');
        }
        stored = entitlements;
        writes.push(entitlements);
        return Promise.resolve('changed');
      },
    }),
  };
}

describe('recording which modules a company bought (PEO-114)', () => {
  it('records the list, normalised', async () => {
    const r = registry();
    const set = await r.set(ACME, ['module.timeoff', 'module.people']);
    expect(set).toEqual({
      ok: true,
      value: { entitlements: ['module.people', 'module.timeoff'], changed: true },
    });
    expect(r.stored()).toEqual(['module.people', 'module.timeoff']);
  });

  it('writes nothing, and says so, when the list did not change', async () => {
    const r = registry();
    await r.set(ACME, ['module.people']);
    const again = await r.set(ACME, ['module.people']);
    expect(again.ok && again.value.changed).toBe(false);
    expect(r.writes).toHaveLength(1);
  });

  it('refuses an unknown module without writing', async () => {
    const r = registry();
    const set = await r.set(ACME, ['module.people', 'module.crypto']);
    expect(set.ok).toBe(false);
    expect(r.writes).toHaveLength(0);
  });

  it('refuses a company that does not exist', async () => {
    const set = await registry().set('00000000-0000-4000-8000-00000000000b', []);
    expect(set.ok ? null : set.error.code).toBe('TENANT_UNKNOWN');
  });
});
