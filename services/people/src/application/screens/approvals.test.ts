import { describe, expect, it } from 'vitest';
import { fixedClock, type Clock } from '@kithena/domain-kit';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import type { Holding, PendingChangeDeps } from '../person/pending-changes.js';
import { inMemoryPendingChangeStore } from '../person/pending-store.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import { approvalsView } from './people.js';
import type { ScreenDeps } from './record.js';

/**
 * Unusual changes on Approvals (the AI features brief, feature 4): People's
 * rules flag them for whoever decides, in words, and never for the requester.
 */

const ADA = '00000000-0000-4000-8000-0000000000a1';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b1';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const HANNA_ACCOUNT = '00000000-0000-4000-8000-0000000000b4';

const confidential = {
  classification: 'confidential',
  piiKind: 'none',
  exportable: true,
  aiEligible: false,
} as const;
const salary = define({
  key: 'base_salary',
  label: { default: 'Base salary' },
  dataType: 'money',
  typeConfig: { kind: 'money' },
  visibility: ['self', 'hr'],
  ownership: ['hr'],
  requiresApproval: true,
  classification: confidential,
});
const iban = define({
  key: 'iban',
  label: { default: 'IBAN' },
  dataType: 'bank_account',
  typeConfig: { kind: 'bank_account', country: 'DE' },
  encrypted: true,
  visibility: ['self', 'hr'],
  ownership: ['employee', 'hr'],
  classification: { ...confidential, piiKind: 'financial' },
});

const viewer = (accountId: string): Viewer => ({ accountId, roles: new Set(['hr']) });
const asking = (v: Viewer) => ({
  tenantId: TENANT,
  viewer: v,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});

function setup(at: string) {
  const store = inMemoryPeople([versionOf(3, [salary, iban])]);
  store.seed(ADA, {
    account: ADA_ACCOUNT,
    custom: { base_salary: { amountMinor: 5_000_000, currency: 'EUR' } },
  });
  const clock: Clock = fixedClock(at);
  const holding: Holding = {
    store: inMemoryPendingChangeStore(),
    publish: () => Promise.resolve(),
    clock,
    newId: store.deps.newId,
  };
  const access = personAccess({ ...store.deps, clock, approvals: holding });
  const pending: PendingChangeDeps = {
    ...holding,
    access,
    schemas: store.deps.schemas,
    reader: store.deps.reader,
    relations: store.deps.relations,
    roles: {
      holdings: () =>
        Promise.resolve(
          new Map([
            [HR_ACCOUNT, new Set(['hr'])],
            [HANNA_ACCOUNT, new Set(['hr'])],
          ]),
        ),
    },
  };
  const deps = {
    service: {
      access,
      schemas: store.deps.schemas,
      inTenant: (_tenant: string, fn: (scope: { tx: never }) => unknown) => fn({ tx: {} as never }),
      pending,
    },
    relations: store.deps.relations,
    clock,
    calendars: utcCalendars,
    personOf: () => Promise.resolve(null),
  } as unknown as ScreenDeps;
  return { access, deps };
}

const flagsOf = async (deps: ScreenDeps, v: Viewer) => {
  const view = await approvalsView(deps, asking(v));
  if (!view.ok) throw new Error(view.error.message);
  return view.value.items.map((i) => [i.key, i.flags.map((f) => f.code)]);
};

describe('flags on Approvals', () => {
  it('tells the decider a large rise and a late-night change to bank details, in words', async () => {
    // A Tuesday, 22:30 UTC: the tenant's zone, outside working hours.
    const { access, deps } = setup('2026-09-22T22:30:00.000Z');
    const tx = {} as never;
    await access.update(tx, {
      ...asking(viewer(HANNA_ACCOUNT)),
      personId: ADA,
      changes: {
        base_salary: { amountMinor: 6_500_000, currency: 'EUR' },
        iban: 'DE89370400440532013000',
      },
    });
    expect(await flagsOf(deps, viewer(HR_ACCOUNT))).toEqual([
      ['base_salary', ['pay_change_large', 'outside_hours']],
      ['iban', ['bank_by_other', 'outside_hours']],
    ]);
    const view = await approvalsView(deps, asking(viewer(HR_ACCOUNT)));
    const reasons = view.ok ? view.value.items[0]?.flags.map((f) => f.reason) : [];
    expect(reasons?.[0]).toBe('Pay goes up 30% on what is in force.');
  });

  it('never shows the requester which rules their change tripped', async () => {
    const { access, deps } = setup('2026-09-22T22:30:00.000Z');
    await access.update({} as never, {
      ...asking(viewer(HANNA_ACCOUNT)),
      personId: ADA,
      changes: { base_salary: { amountMinor: 6_500_000, currency: 'EUR' } },
    });
    expect(await flagsOf(deps, viewer(HANNA_ACCOUNT))).toEqual([['base_salary', []]]);
  });

  it('flags nothing ordinary', async () => {
    const { access, deps } = setup('2026-09-22T10:00:00.000Z');
    await access.update({} as never, {
      ...asking(viewer(HANNA_ACCOUNT)),
      personId: ADA,
      changes: { base_salary: { amountMinor: 5_200_000, currency: 'EUR' } },
    });
    expect(await flagsOf(deps, viewer(HR_ACCOUNT))).toEqual([['base_salary', []]]);
  });
});
