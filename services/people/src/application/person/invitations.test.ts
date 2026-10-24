import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, noTransaction as tx, TENANT, versionOf } from './in-memory.js';
import { invitations, type IdentityInviter, type InvitationRow } from './invitations.js';

/**
 * A hire invited to their company's Kithena (PRD §8.2 step 8): now or on a
 * day, with what the sign-up page shows already filled in, the account linked
 * at once, and a second send re-issuing the link until they sign up.
 */

const HR = { accountId: '00000000-0000-4000-8000-0000000000ff', roles: new Set(['hr']) };
const NOT_HR = { accountId: '00000000-0000-4000-8000-0000000000fe', roles: new Set<string>() };
const ADA = '00000000-0000-4000-8000-0000000000a1';
const ACCOUNT = '00000000-0000-4000-8000-0000000000b1';

function setup() {
  const store = inMemoryPeople([
    versionOf(1, [
      define({ key: 'given_name' }),
      define({ key: 'family_name' }),
      define({ key: 'work_email' }),
      define({ key: 'pronouns', collectAt: 'signup', ownership: ['employee', 'hr'] }),
    ]),
  ]);
  store.seed(ADA, {
    status: 'pre_hire',
    fields: { givenName: 'Ada', familyName: 'Lovelace', workEmail: 'ada@example.com' },
    custom: { pronouns: 'she/her' },
  });
  const rows = new Map<string, InvitationRow>();
  const asked: Parameters<IdentityInviter['invite']>[1][] = [];
  const service = invitations({
    ...store.deps,
    calendars: utcCalendars,
    clock: fixedClock('2026-09-22T09:00:00.000Z'),
    store: {
      get: (_tx, _t, personId) => Promise.resolve(rows.get(personId) ?? null),
      save: (_tx, _t, row) => {
        rows.set(row.personId, row);
        return Promise.resolve();
      },
      byEmail: (_tx, _t, email) =>
        Promise.resolve(
          [...store.rows.values()].find((r) => r.fields.workEmail === email)?.snapshot.id ?? null,
        ),
      due: (_tx, _t, onOrBefore) =>
        Promise.resolve(
          [...rows.values()]
            .filter((r) => r.sentAt === null && r.sendOn <= onOrBefore)
            .map((r) => r.personId),
        ),
    },
    inviter: {
      invite: (_tenant, input) => {
        asked.push(input);
        return Promise.resolve(ok({ accountId: ACCOUNT, expiresAt: '2026-09-29T09:00:00Z' }));
      },
    },
  });
  const asking = { tenantId: TENANT, viewer: HR, correlationId: 'c1' };
  return { store, service, asked, rows, asking };
}

describe('inviting a hire to the company', () => {
  it('sends now with the name and sign-up answers filled in, and links the account', async () => {
    const { store, service, asked, asking } = setup();
    const sent = await service.invite(tx, { ...asking, personId: ADA, sendOn: null });
    expect(sent).toMatchObject({ ok: true, value: { state: 'invited', sendOn: '2026-09-22' } });
    expect(asked[0]).toMatchObject({
      email: 'ada@example.com',
      employmentStart: '2026-01-01',
      timeZone: 'Etc/UTC',
      name: { given: 'Ada', family: 'Lovelace' },
      answers: { pronouns: 'she/her' },
    });
    expect(store.rows.get(ADA)?.snapshot.identityAccountId).toBe(ACCOUNT);
    expect(await service.forEmail(tx, { ...asking, email: 'ada@example.com' })).toMatchObject({
      ok: true,
      value: { personId: ADA, state: 'invited' },
    });
  });

  it('keeps a day ahead, and the job sends it when that day comes', async () => {
    const { service, asked, rows, asking } = setup();
    const kept = await service.invite(tx, { ...asking, personId: ADA, sendOn: '2026-10-01' });
    expect(kept).toMatchObject({ ok: true, value: { state: 'scheduled', sendOn: '2026-10-01' } });
    expect(asked).toHaveLength(0);
    expect(await service.sendDue(tx, TENANT)).toBe(0);
    const held = rows.get(ADA);
    if (held === undefined) throw new Error('kept');
    rows.set(ADA, { ...held, sendOn: '2026-09-20' });
    expect(await service.sendDue(tx, TENANT)).toBe(1);
    expect(asked).toHaveLength(1);
    expect(rows.get(ADA)?.sentAt).not.toBeNull();
  });

  it('is HR’s, and not for somebody who has signed up already', async () => {
    const { store, service, asking } = setup();
    expect(
      await service.invite(tx, { ...asking, viewer: NOT_HR, personId: ADA, sendOn: null }),
    ).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    const row = store.rows.get(ADA);
    if (row === undefined) throw new Error('seeded');
    store.rows.set(ADA, { ...row, snapshot: { ...row.snapshot, status: 'onboarding' } });
    expect(await service.invite(tx, { ...asking, personId: ADA, sendOn: null })).toMatchObject({
      ok: false,
      error: { code: 'SIGNED_UP' },
    });
    expect(await service.forEmail(tx, { ...asking, email: 'ada@example.com' })).toMatchObject({
      value: { state: 'signed_up' },
    });
  });
});
