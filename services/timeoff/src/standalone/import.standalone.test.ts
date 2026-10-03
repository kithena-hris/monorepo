import { describe, expect, it } from 'vitest';

import { importMembers } from '../application/member/import.js';
import { caller, hr, people, TENANT, world } from '../application/testing/world.js';

/**
 * TOF-036: with People absent — this file runs under the standalone config,
 * where `@kithena/people` resolves to a module that throws — Platform's seven
 * arrive by import, dry run first, and each is granted the year.
 */

const header =
  'personId,displayName,firstName,managerPersonId,teamKey,teamName,locationKey,country,region,city,timeZone,hireDate,terminationDate,workPattern,status';
const row = (id: string, name: string, manager: string) =>
  `${id},"${name}",${name.split(' ')[0] ?? name},${manager},platform,Platform,madrid,ES,Comunidad de Madrid,Madrid,Europe/Madrid,2022-03-01,,"1,2,3,4,5",active`;
const csv = [
  header,
  row(people.marco, 'Marco Ruiz', ''),
  row(people.adam, 'Adam Novak', people.marco),
  row(people.omar, 'Omar Haddad', people.marco),
  row(people.yuki, 'Yuki Tanaka', people.marco),
  row(people.leo, 'Leo Martin', people.marco),
  row(people.hana, 'Hana Kim', people.marco),
  row(people.ravi, 'Ravi Patel', people.marco),
].join('\r\n');

describe('member import with People absent', () => {
  it('imports seven members, after a dry run that writes nothing', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { members: false });
    const run = importMembers(app.deps);
    const s = app.state(TENANT);

    const dry = await run(hr, { format: 'csv', content: csv, dryRun: true });
    expect(dry).toMatchObject({ ok: true, value: { rows: 7, created: 7, errors: [] } });
    expect(s.members.size).toBe(0);

    const real = await run(hr, { format: 'csv', content: csv, dryRun: false });
    expect(real).toMatchObject({ ok: true, value: { created: 7, updated: 0 } });
    expect(s.members.size).toBe(7);
    expect(s.members.get(people.adam)?.managerPersonId).toBe(people.marco);
    expect(s.members.get(people.adam)?.workPattern).toEqual([1, 2, 3, 4, 5]);
    expect(s.ledger.filter((e) => e.kind === 'grant')).toHaveLength(7);
  });

  it('writes nothing when one row is wrong, and says which', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { members: false });
    const broken = csv.replace('2022-03-01', 'last March');
    const result = await importMembers(app.deps)(hr, {
      format: 'csv',
      content: broken,
      dryRun: false,
    });
    expect(result.ok && result.value.errors).toEqual([
      expect.objectContaining({ row: 1, field: 'hireDate' }),
    ]);
    expect(app.state(TENANT).members.size).toBe(0);
  });

  it('takes JSON too, and is HR only', async () => {
    const app = world('2026-10-01T07:00:00.000Z', { members: false });
    const json = JSON.stringify([
      {
        personId: people.adam,
        displayName: 'Adam Novak',
        firstName: 'Adam',
        hireDate: '2024-01-01',
      },
    ]);
    const refused = await importMembers(app.deps)(caller(people.adam), {
      format: 'json',
      content: json,
      dryRun: false,
    });
    expect(refused).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

    const done = await importMembers(app.deps)(hr, {
      format: 'json',
      content: json,
      dryRun: false,
    });
    expect(done).toMatchObject({ ok: true, value: { created: 1 } });
  });
});
