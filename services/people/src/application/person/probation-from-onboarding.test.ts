import { describe, expect, it } from 'vitest';

import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import { personAccess } from './person-access.js';
import { probationsFromOnboarding } from './probation-from-onboarding.js';
import { withSupport } from './subject.js';

/**
 * A probation decided in Onboarding, on People's record (Recruiting PRD §O8):
 * the outcome, and an extension's new end.
 */

const label = (l: string) => ({ default: l, translations: {} });

function setup() {
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'given_name' }),
      define({ key: 'family_name' }),
      define({ key: 'work_email', ownership: ['hr'] }),
      define({ key: 'probation_end', dataType: 'date', typeConfig: { kind: 'date' } }),
      define({
        key: 'probation_outcome',
        dataType: 'select',
        typeConfig: {
          kind: 'select',
          options: [
            { value: 'passed', label: label('Passed') },
            { value: 'extended', label: label('Extended') },
            { value: 'failed', label: label('Not passed') },
          ],
        },
      }),
    ]),
  ]);
  const access = personAccess({ ...store.deps, relations: withSupport(store.deps.relations) });
  return {
    store,
    access,
    probations: probationsFromOnboarding(access, store.deps.schemas),
  };
}

const envelope = (payload: object) => ({
  eventId: '01890000-0000-7000-8000-0000000000e1',
  eventName: 'onboarding.probation.reviewed',
  eventVersion: 1,
  tenantId: TENANT,
  occurredAt: '2027-04-20T09:00:00.000Z',
  recordedAt: '2027-04-20T09:00:00.000Z',
  effectiveFrom: '2027-04-20',
  aggregate: { type: 'plan', id: 'plan-1', version: 1 },
  actor: { kind: 'system', process: 'onboarding' },
  correlationId: '00000000-0000-4000-8000-0000000000e2',
  causationId: null,
  payload: {
    planId: '00000000-0000-4000-8000-0000000000e3',
    by: '00000000-0000-4000-8000-0000000000e4',
    ...payload,
  },
});

async function hireAda(access: ReturnType<typeof setup>['access']): Promise<string> {
  const created = await access.create(tx, {
    tenantId: TENANT,
    viewer: { accountId: 'system', roles: new Set(['hr']) },
    correlationId: '00000000-0000-4000-8000-0000000000e5',
    applySensitiveWithoutApproval: true,
    attributes: {
      given_name: 'Ada',
      family_name: 'Lovelace',
      work_email: 'ada@example.com',
      probation_end: '2027-05-01',
    },
    hireDate: '2026-11-02',
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.id;
}

describe('a probation decided in Onboarding', () => {
  it('extended: the new end and the outcome are on the record', async () => {
    const { store, access, probations } = setup();
    const personId = await hireAda(access);
    expect(
      await probations.reviewed(
        tx,
        envelope({ personId, outcome: 'extended', probationEnd: '2027-08-01' }) as never,
      ),
    ).toEqual({ outcome: 'applied' });
    const row = store.rows.get(personId);
    expect(row?.fields.custom).toMatchObject({
      probation_end: '2027-08-01',
      probation_outcome: 'extended',
    });
  });

  it('passed: only the outcome; the end stays', async () => {
    const { store, access, probations } = setup();
    const personId = await hireAda(access);
    await probations.reviewed(
      tx,
      envelope({ personId, outcome: 'passed', probationEnd: null }) as never,
    );
    expect(store.rows.get(personId)?.fields.custom).toMatchObject({
      probation_end: '2027-05-01',
      probation_outcome: 'passed',
    });
  });

  it('names nobody yet: nothing to record it on', async () => {
    const { probations } = setup();
    expect(
      (
        await probations.reviewed(
          tx,
          envelope({ personId: null, outcome: 'passed', probationEnd: null }) as never,
        )
      ).outcome,
    ).toBe('ignored');
  });
});
