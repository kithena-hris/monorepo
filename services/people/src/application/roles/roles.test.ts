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
    releaseLastAdministrator: () => Promise.resolve(),
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

describe('Kithena support and the roles (decided 2026-09-29)', () => {
  const SUPPORT = '00000000-0000-4000-8000-0000000000c1';
  const OPERATOR = '00000000-0000-4000-8000-0000000000e1';
  const ADMIN = '00000000-0000-4000-8000-0000000000b3';
  const support = {
    accountId: SUPPORT,
    roles: new Set(['people_admin', 'hr', 'finance']),
    support: { operatorId: OPERATOR, reason: 'Ticket 4812' },
  };
  const at = { tenantId: ACME, correlationId: 'c' };
  const make = (rows: [string, string][]) => {
    const s = store(rows);
    s.candidates = () =>
      Promise.resolve([{ accountId: OTHER, personId: 'p', name: null, workEmail: null }]);
    const clock = fixedClock('2026-09-30T12:00:00.000Z');
    return { s, roles: tenantRoles({ store: s, clock, newId: () => 'e' }) };
  };

  it('lists who holds what, and is not among them', async () => {
    const { roles } = make([[ADMIN, 'people_admin']]);
    const listed = await roles.list(tx, { ...at, viewer: support });
    expect(listed.ok && listed.value.holders.map((h) => h.accountId)).toEqual([ADMIN]);
  });

  it('grants as an administrator, recorded as the operator’s', async () => {
    const { roles, s } = make([[ADMIN, 'people_admin']]);
    const granted = await roles.grant(tx, {
      ...at,
      viewer: support,
      accountId: OTHER,
      role: 'finance',
      reason: 'Asked for by the customer',
    });
    expect(granted.ok).toBe(true);
    expect(s.events[0]?.actor).toEqual({ kind: 'user', userId: SUPPORT, onBehalfOf: OPERATOR });
  });

  it('never revokes the company’s last administrator', async () => {
    const { roles } = make([[ADMIN, 'people_admin']]);
    const refused = await roles.revoke(tx, {
      ...at,
      viewer: support,
      accountId: ADMIN,
      role: 'people_admin',
      reason: 'No',
    });
    expect(!refused.ok && refused.error.code).toBe('LAST_ADMIN');
  });

  it('is nothing without its session: the same account, not support, is refused', async () => {
    const { roles } = make([[ADMIN, 'people_admin']]);
    const plain = { accountId: SUPPORT, roles: new Set(['people_admin', 'hr', 'finance']) };
    const listed = await roles.list(tx, { ...at, viewer: plain });
    expect(!listed.ok && listed.error.code).toBe('FORBIDDEN');
    const granted = await roles.grant(tx, {
      ...at,
      viewer: plain,
      accountId: OTHER,
      role: 'hr',
      reason: 'x',
    });
    expect(!granted.ok && granted.error.code).toBe('FORBIDDEN');
  });

  it('lets an administrator list, as HR always could, and not finance', async () => {
    const admin = { accountId: ADMIN, roles: new Set<string>() };
    expect((await make([[ADMIN, 'people_admin']]).roles.list(tx, { ...at, viewer: admin })).ok).toBe(
      true,
    );
    const refused = await make([[ADMIN, 'finance']]).roles.list(tx, { ...at, viewer: admin });
    expect(!refused.ok && refused.error.code).toBe('FORBIDDEN');
  });
});
