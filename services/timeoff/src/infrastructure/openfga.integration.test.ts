import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CalendarDate, PersonId, TeamKey, TenantId } from '@kithena/contracts';
import { startOpenFga } from '@kithena/testing';

import { openFga, type TimeOffFga } from './openfga.js';

/**
 * TOF-048 against a real OpenFGA: the model, the tuples Time Off writes from
 * its projection, and the four relations the application asks about.
 *
 *   Marco ─▶ Adam, Omar        (Platform, Acme)
 *   Ada covers for Marco 19–23 October
 *   Hana                       (Design, Acme)
 *   Globex has its own "platform"
 */

const ACME = TenantId.parse('00000000-0000-4000-8000-00000000000a');
const GLOBEX = TenantId.parse('00000000-0000-4000-8000-00000000000b');
const person = (n: number) =>
  PersonId.parse(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const MARCO = person(1);
const ADAM = person(2);
const OMAR = person(3);
const ADA = person(4);
const HANA = person(5);
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000a1';
const PLATFORM = TeamKey.parse('platform');
const DESIGN = TeamKey.parse('design');

let stop: (() => Promise<void>) | undefined;
let fga: TimeOffFga;
let today = CalendarDate.parse('2026-10-20');

const active = { status: 'active' as const };
const ask = (
  tenantId: TenantId,
  user: `person:${string}` | `account:${string}`,
  relation: 'approver' | 'delegate' | 'hr_admin' | 'teammate',
  object: `member:${string}` | `tenant:${string}`,
) => fga.authorizer.check(tenantId, { user, relation, object });

beforeAll(async () => {
  const started = await startOpenFga();
  stop = started.stop;
  fga = openFga(started.apiUrl, { today: () => today });
  await fga.syncMember(ACME, {
    personId: MARCO,
    teamKey: PLATFORM,
    managerPersonId: null,
    ...active,
  });
  for (const id of [ADAM, OMAR]) {
    await fga.syncMember(ACME, {
      personId: id,
      teamKey: PLATFORM,
      managerPersonId: MARCO,
      ...active,
    });
  }
  await fga.syncMember(ACME, { personId: HANA, teamKey: DESIGN, managerPersonId: null, ...active });
  await fga.syncMember(GLOBEX, {
    personId: person(9),
    teamKey: PLATFORM,
    managerPersonId: null,
    ...active,
  });
  await fga.syncCover(ACME, MARCO, {
    delegateId: ADA,
    ranges: [{ from: CalendarDate.parse('2026-10-19'), to: CalendarDate.parse('2026-10-23') }],
  });
  await fga.setHrAdmin(ACME, HR_ACCOUNT, true);
}, 180_000);

afterAll(async () => {
  await stop?.();
});

describe('the Time Off model', () => {
  it('makes a manager the approver of their reports, and nobody else', async () => {
    expect(await ask(ACME, `person:${MARCO}`, 'approver', `member:${ADAM}`)).toBe(true);
    expect(await ask(ACME, `person:${OMAR}`, 'approver', `member:${ADAM}`)).toBe(false);
    expect(await ask(GLOBEX, `person:${MARCO}`, 'approver', `member:${ADAM}`)).toBe(false);
  });

  it('makes a delegate decide for the approver during the cover only', async () => {
    today = CalendarDate.parse('2026-10-20');
    expect(await ask(ACME, `person:${ADA}`, 'delegate', `member:${ADAM}`)).toBe(true);
    today = CalendarDate.parse('2026-10-26');
    expect(await ask(ACME, `person:${ADA}`, 'delegate', `member:${ADAM}`)).toBe(false);
    today = CalendarDate.parse('2026-10-18');
    expect(await ask(ACME, `person:${ADA}`, 'delegate', `member:${ADAM}`)).toBe(false);
    // The cover ends: no tuple, whatever the day.
    today = CalendarDate.parse('2026-10-20');
    expect(await fga.syncCover(ACME, MARCO, null)).toBe('applied');
    expect(await ask(ACME, `person:${ADA}`, 'delegate', `member:${ADAM}`)).toBe(false);
  });

  it('holds HR on the tenant asked about, for its accounts', async () => {
    expect(await ask(ACME, `account:${HR_ACCOUNT}`, 'hr_admin', `tenant:${ACME}`)).toBe(true);
    expect(await ask(GLOBEX, `account:${HR_ACCOUNT}`, 'hr_admin', `tenant:${GLOBEX}`)).toBe(false);
    expect(await ask(ACME, `account:${ADAM}`, 'hr_admin', `tenant:${ACME}`)).toBe(false);
  });

  it('makes a teammate someone who may see "Off" but is not an approver', async () => {
    // A teammate sees that Adam is off; the type is for approvers, whom this is not.
    expect(await ask(ACME, `person:${OMAR}`, 'teammate', `member:${ADAM}`)).toBe(true);
    expect(await ask(ACME, `person:${OMAR}`, 'approver', `member:${ADAM}`)).toBe(false);
    expect(await ask(ACME, `person:${ADAM}`, 'teammate', `member:${ADAM}`)).toBe(false);
    expect(await ask(ACME, `person:${HANA}`, 'teammate', `member:${ADAM}`)).toBe(false);
    // Globex's "platform" is not Acme's.
    expect(await ask(GLOBEX, `person:${person(9)}`, 'teammate', `member:${ADAM}`)).toBe(false);
  });

  it('converges: the same member synced twice changes nothing, and a move replaces the team', async () => {
    const omar = { personId: OMAR, teamKey: PLATFORM, managerPersonId: MARCO, ...active };
    expect(await fga.syncMember(ACME, omar)).toBe('unchanged');
    expect(await fga.syncMember(ACME, { ...omar, teamKey: DESIGN })).toBe('applied');
    expect(await ask(ACME, `person:${OMAR}`, 'teammate', `member:${ADAM}`)).toBe(false);
    expect(await ask(ACME, `person:${OMAR}`, 'teammate', `member:${HANA}`)).toBe(true);
  });
});
