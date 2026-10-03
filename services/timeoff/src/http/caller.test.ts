import { describe, expect, it } from 'vitest';

import { ADA_ACCOUNT, people, TENANT, world } from '../application/testing/world.js';
import { callerFromHeaders, withMember } from './caller.js';

/** TOF-050a: the router names an account; the projection says which member it is. */

const TOKEN = 'router-to-timeoff';
const ADAM_ACCOUNT = people.adam.replace(/^00000000/u, '0000000a');

const request = (principal: Record<string, unknown>, token = TOKEN) => ({
  headers: {
    'x-internal-token': token,
    'x-kithena-principal': JSON.stringify({
      tenantId: TENANT,
      entitlements: ['module.timeoff'],
      ...principal,
    }),
  },
});

function boot() {
  const app = world();
  return withMember(callerFromHeaders(TOKEN), app.deps.uow);
}

describe('the caller', () => {
  it('is the member whose account signed in', async () => {
    const answer = await boot()(request({ userId: ADAM_ACCOUNT }));
    expect(answer).toMatchObject({
      ok: true,
      value: { tenantId: TENANT, accountId: ADAM_ACCOUNT, personId: people.adam },
    });
  });

  it('is an account and nothing more when no member signs in as it', async () => {
    const answer = await boot()(request({ userId: ADA_ACCOUNT }));
    expect(answer).toMatchObject({ ok: true, value: { accountId: ADA_ACCOUNT, personId: null } });
  });

  it('is nobody when two members claim the account', async () => {
    const app = world();
    const s = app.state(TENANT);
    const omar = s.members.get(people.omar);
    if (omar === undefined) throw new Error('Omar is in the world');
    s.members.set(people.omar, { ...omar, accountId: ADAM_ACCOUNT });
    const answer = await withMember(
      callerFromHeaders(TOKEN),
      app.deps.uow,
    )(request({ userId: ADAM_ACCOUNT }));
    expect(answer).toMatchObject({ ok: true, value: { personId: null } });
  });

  it('keeps a person the router forwarded', async () => {
    const answer = await boot()(request({ userId: ADA_ACCOUNT, personId: people.hana }));
    expect(answer).toMatchObject({ ok: true, value: { personId: people.hana } });
  });

  it('is refused before the projection is asked, without the router’s token', async () => {
    const answer = await boot()(request({ userId: ADAM_ACCOUNT }, 'guessed'));
    expect(answer).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  });

  it('is refused in a support or view-as session, which Time Off has no rules for', async () => {
    const operator = '0000000b-0000-4000-8000-000000000001';
    for (const session of [{ impersonatedBy: operator }, { viewedBy: operator }]) {
      // oxlint-disable-next-line no-await-in-loop -- two sessions
      const answer = await boot()(request({ userId: ADAM_ACCOUNT, ...session }));
      expect(answer).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    const plain = await boot()(
      request({ userId: ADAM_ACCOUNT, impersonatedBy: null, viewedBy: null }),
    );
    expect(plain).toMatchObject({ ok: true, value: { personId: people.adam } });
  });

  it('is refused for a company that did not buy Time Off', async () => {
    const answer = await boot()(request({ userId: ADAM_ACCOUNT, entitlements: ['module.people'] }));
    expect(answer).toMatchObject({ ok: false, error: { code: 'NOT_ENTITLED' } });
  });
});
