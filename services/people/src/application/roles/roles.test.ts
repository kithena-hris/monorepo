import { describe, expect, it } from 'vitest';
import type { PendingEvent } from '@kithena/domain-kit';
import { fixedClock } from '@kithena/domain-kit';

import { tenantRoles, type RoleStore } from './roles.js';

/** `accessEnded` without a database: which grants go, and what is raised. */

const ACME = '00000000-0000-4000-8000-00000000000a';
const LEAVER = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';

function store(
  rows: [string, string][],
): RoleStore & { events: PendingEvent[]; rows: [string, string][] } {
  const events: PendingEvent[] = [];
  return {
    rows,
    events,
    lock: () => Promise.resolve(),
    holdings: () => {
      const held = new Map<string, Set<string>>();
      for (const [account, role] of rows)
        held.set(account, (held.get(account) ?? new Set()).add(role));
      return Promise.resolve(held);
    },
    grant: () => Promise.resolve(),
    revoke: (_tx, _t, account, role) => {
      rows.splice(
        rows.findIndex(([a, r]) => a === account && r === role),
        1,
      );
      return Promise.resolve();
    },
    candidates: () => Promise.resolve([]),
    publish: (_tx, published) => {
      events.push(...published);
      return Promise.resolve();
    },
  };
}

const ended = { tenantId: ACME, accountId: LEAVER, correlationId: 'c', causationId: null };
const tx = {} as never;

describe('a leaver’s roles when their access ends', () => {
  it('revokes each, the last people_admin too, as the system with the reason access_ended', async () => {
    const s = store([
      [LEAVER, 'people_admin'],
      [LEAVER, 'finance'],
      [OTHER, 'hr'],
    ]);
    const roles = tenantRoles({
      store: s,
      clock: fixedClock('2026-09-30T12:00:00.000Z'),
      newId: () => 'e',
    });
    expect(await roles.accessEnded(tx, ended)).toEqual(['finance', 'people_admin']);
    expect(s.rows).toEqual([[OTHER, 'hr']]);
    expect(s.events.map((e) => [e.eventName, e.actor, e.payload])).toEqual(
      ['finance', 'people_admin'].map((role) => [
        'people.role.revoked',
        { kind: 'system', process: 'people.roles' },
        { accountId: LEAVER, role, by: null, via: 'system', reason: 'access_ended' },
      ]),
    );
  });

  it('raises nothing for somebody who held no role', async () => {
    const s = store([[OTHER, 'hr']]);
    const roles = tenantRoles({
      store: s,
      clock: fixedClock('2026-09-30T12:00:00.000Z'),
      newId: () => 'e',
    });
    expect(await roles.accessEnded(tx, ended)).toEqual([]);
    expect(s.events).toEqual([]);
  });
});
