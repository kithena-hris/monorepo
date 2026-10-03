import {
  CalendarDate,
  LedgerEntry,
  LeaveTypeDefinition,
  LocationKey,
  PersonId,
  PolicyDefinition,
  TeamKey,
  TenantId,
} from '@kithena/contracts';
import { fixedClock } from '@kithena/domain-kit';

import { es } from '../../country-packs/es.js';
import { LeaveType } from '../../domain/policy/leave-type.js';
import { Policy, policyId } from '../../domain/policy/policy.js';
import type { Caller, Member } from '../ports.js';
import { inMemoryTimeOff, sequentialIds, type InMemoryTimeOff } from './in-memory.js';

/**
 * Acme's Platform team in October 2026, the design's data, over the in-memory
 * ports: Marco manages Adam, Omar, Yuki, Leo, Hana and Ravi in Madrid; Ada is
 * HR. Vacation is 25 days upfront, up to 3 below zero, 5 carried to 31 March;
 * sick leave is untracked. At least 5 of the 7 must be in.
 */

export const TENANT = TenantId.parse('11111111-1111-7111-8111-111111111111');
export const PLATFORM = TeamKey.parse('platform');
export const MADRID = LocationKey.parse('madrid');
export const VACATION_POLICY = policyId('0189aaaa-0000-7000-8000-000000000001');

const person = (n: number) =>
  PersonId.parse(`00000000-0000-7000-8000-${String(n).padStart(12, '0')}`);
export const people = {
  marco: person(1),
  adam: person(2),
  omar: person(3),
  yuki: person(4),
  leo: person(5),
  hana: person(6),
  ravi: person(7),
};
/** Ada's account; she is HR and not on Platform. */
export const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000a1';

export const d = (s: string): CalendarDate => CalendarDate.parse(s);

export const caller = (personId: PersonId | null, accountId?: string): Caller => ({
  tenantId: TENANT,
  accountId:
    accountId ?? (personId === null ? ADA_ACCOUNT : personId.replace(/^00000000/u, '0000000a')),
  personId,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});
export const hr = caller(null, ADA_ACCOUNT);

export function member(personId: PersonId, name: string, over: Partial<Member> = {}): Member {
  return {
    personId,
    displayName: name,
    firstName: name.split(' ')[0] ?? name,
    managerPersonId: personId === people.marco ? null : people.marco,
    teamKey: PLATFORM,
    teamName: 'Platform',
    locationKey: MADRID,
    country: 'ES',
    region: 'Comunidad de Madrid',
    city: 'Madrid',
    timeZone: 'Europe/Madrid',
    hireDate: d('2022-03-01'),
    terminationDate: null,
    workPattern: null,
    status: 'active',
    lastEventId: null,
    lastEffectiveFrom: null,
    ...over,
  };
}

export const vacationType = (): LeaveTypeDefinition =>
  LeaveTypeDefinition.parse({
    key: 'vacation',
    name: { default: 'Vacation' },
    category: 'annual_leave',
    colorToken: 'chart-1',
    icon: 'sun',
    tracked: true,
    paid: 'paid',
    visibility: 'type',
  });

export const sickType = (): LeaveTypeDefinition =>
  LeaveTypeDefinition.parse({
    key: 'sick',
    name: { default: 'Sick' },
    category: 'sick_leave',
    colorToken: 'chart-3',
    icon: 'thermometer',
    tracked: false,
    paid: 'paid',
    visibility: 'off_only',
    requiresNote: { afterDays: 3 },
  });

export const vacationPolicy = (over: Partial<PolicyDefinition> = {}): PolicyDefinition =>
  PolicyDefinition.parse({
    leaveTypeKey: 'vacation',
    allowance: [{ fromYears: 0, days: '25.000' }],
    carryOver: { maxDays: '5.000', useBy: { month: 3, day: 31 } },
    negativeBalance: { limit: '3.000' },
    ...over,
  });

/**
 * The world, seeded directly into the store: the leave types, a published
 * policy, Madrid's calendars, the team minimum and the seven members — with
 * no ledger, so a test posts what it needs. `withGrant` adds the year's 25;
 * `members: false` leaves the team out, for an import to bring.
 */
export function world(
  at = '2026-10-01T07:00:00.000Z',
  options: { withGrant?: boolean; members?: boolean } = {},
): InMemoryTimeOff {
  const app = inMemoryTimeOff(at);
  app.hrAccounts.add(ADA_ACCOUNT);
  const s = app.state(TENANT);

  for (const def of [vacationType(), sickType()]) {
    const t = LeaveType.define(def);
    if (!t.ok) throw new Error(t.error.message);
    s.leaveTypes.set(def.key, t.value);
  }
  const policy = Policy.draft({
    id: VACATION_POLICY,
    tenantId: TENANT,
    definition: vacationPolicy(),
  });
  const ids = sequentialIds();
  const seedCtx = {
    clock: fixedClock('2025-12-01T00:00:00.000Z'),
    newId: () => ids().replace('01890000', '0189ffff'),
    actor: { kind: 'system', process: 'seed' } as const,
    correlationId: '00000000-0000-4000-8000-0000000000c0',
    causationId: null,
    timeZone: 'Europe/Madrid',
  };
  policy.publish(d('2026-01-01'), seedCtx);
  policy.drainEvents();
  s.policies.set(policy.id, policy);

  for (const layer of es.calendars.madrid) s.layers.set(layer.key, layer);
  s.assignments.set(
    MADRID,
    es.calendars.madrid.map((l) => l.key),
  );
  s.minimums.set(PLATFORM, { atLeast: 5, unit: 'people' });

  const names: Record<keyof typeof people, string> = {
    marco: 'Marco Ruiz',
    adam: 'Adam Novak',
    omar: 'Omar Haddad',
    yuki: 'Yuki Tanaka',
    leo: 'Leo Martin',
    hana: 'Hana Kim',
    ravi: 'Ravi Patel',
  };
  if (options.members === false) return app;
  for (const [k, id] of Object.entries(people)) {
    s.members.set(id, member(id, names[k as keyof typeof people]));
  }

  if (options.withGrant === true) {
    for (const id of Object.values(people)) {
      s.ledger.push(
        LedgerEntry.parse({
          entryId: seedCtx.newId(),
          personId: id,
          leaveTypeKey: vacationType().key,
          kind: 'grant',
          amount: '25.000',
          unit: 'day',
          effectiveOn: d('2026-01-01'),
          occurredAt: seedCtx.clock.instant(),
          policyVersion: 1,
          supersedes: null,
          requestId: null,
          reason: null,
        }),
      );
    }
  }
  return app;
}
