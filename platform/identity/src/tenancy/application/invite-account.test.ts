import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';

import { inviteAccount, type InviteAccountDeps, type InviteScope } from './invite-account.js';
import type { Delivery, Invitation, InvitationNotifier } from './invitation-notifier.js';

const TENANT = '00000000-0000-4000-8000-000000000001';
const AUTH_ORIGIN = 'https://auth.app.kithena.com';
const EXPIRES = '2026-08-27T09:05:00.000Z';
const TODAY = '2026-08-24T09:00:00.000Z';
const LOGO = 'https://x.public.blob.vercel-storage.com/acme.png';

function notifier(delivery: Delivery = { delivered: true, messageId: 'msg_1', reason: null }) {
  const sent: Invitation[] = [];
  const port: InvitationNotifier = {
    send: (invitation) => {
      sent.push(invitation);
      return Promise.resolve(delivery);
    },
  };
  return { port, sent };
}

/**
 * A scope whose writes append to one list, so a test can assert order as well
 * as content. Same shape as `provision-tenant.test.ts`, and for the same
 * reason: order is what row-level security cares about and nothing about an
 * individual call says so.
 */
function deps(
  over: Partial<InviteScope> = {},
  extra: Partial<InviteAccountDeps> = {},
): InviteAccountDeps & { written: string[]; sent: Invitation[] } {
  const written: string[] = [];
  const mail = notifier();

  const scope: InviteScope = {
    findByEmail: () => Promise.resolve(null),
    commission: (input) => {
      written.push(`commission:${input.email}@${input.employmentStart}/${input.timeZone}`);
      return Promise.resolve({
        accountId: '00000000-0000-4000-8000-0000000000a1',
        identityId: '00000000-0000-4000-8000-00000000000d',
      });
    },
    invite: (input) => {
      written.push(`invite:${input.accountId}/${input.secondChannel}`);
      return Promise.resolve(ok({ token: 'a-single-use-token', expiresAt: EXPIRES }));
    },
    ...over,
  };

  return {
    written,
    sent: mail.sent,
    tenantById: () => Promise.resolve({ slug: 'acme', displayName: 'Acme Corp', logoUrl: LOGO }),
    inTenantTransaction: (_tenantId, fn) => fn(scope),
    authOrigin: AUTH_ORIGIN,
    clock: fixedClock(TODAY),
    notifier: mail.port,
    ...extra,
  };
}

const request = { tenantId: TENANT, email: 'Ada@Acme.Example', issuedBy: null };

describe('inviting somebody new', () => {
  it('creates the account, issues a link, and sends it', async () => {
    const d = deps();
    const result = await inviteAccount(d)(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(d.written).toEqual([
      'commission:ada@acme.example@2026-08-24/Etc/UTC',
      'invite:00000000-0000-4000-8000-0000000000a1/in_person',
    ]);
    expect(d.sent).toHaveLength(1);
    expect(result.value.delivery.delivered).toBe(true);
  });

  it('normalises the address before anything is written or sent', async () => {
    const d = deps();
    const result = await inviteAccount(d)(request);

    expect(result.ok && result.value.email).toBe('ada@acme.example');
    expect(d.sent[0]?.email).toBe('ada@acme.example');
    // Stored lower case too, or the same person invited twice is two accounts.
    expect(d.written[0]).toContain('commission:ada@acme.example');
  });

  it('returns a link the enrolment page can read', async () => {
    const d = deps();
    const result = await inviteAccount(d)(request);
    if (!result.ok) throw new Error('expected an invitation');

    const link = new URL(result.value.enrolUrl);
    expect(link.origin).toBe(AUTH_ORIGIN);
    expect(link.pathname).toBe('/enrol');
    expect(link.searchParams.get('tenant')).toBe('acme');
    expect(link.searchParams.get('name')).toBe('ada@acme.example');
  });

  it('tells the messaging service which company this is', async () => {
    const d = deps();
    await inviteAccount(d)(request);
    expect(d.sent[0]?.companyName).toBe('Acme Corp');
    expect(d.sent[0]?.expiresAt).toBe(EXPIRES);
  });
});

describe('inviting somebody who is already known', () => {
  const known = (status: string): Partial<InviteScope> => ({
    findByEmail: () =>
      Promise.resolve({
        accountId: '00000000-0000-4000-8000-0000000000b2',
        identityId: '00000000-0000-4000-8000-00000000000e',
        status,
      }),
  });

  it('re-issues to an invited account without creating a second one', async () => {
    // Issuing invalidates the previous token, so this replaces rather than
    // accumulates. Creating a second account would collide with the unique
    // index on (tenant, work_email) and, worse, would be the wrong thing.
    const d = deps(known('invited'));
    const result = await inviteAccount(d)(request);

    expect(result.ok).toBe(true);
    expect(d.written).toEqual(['invite:00000000-0000-4000-8000-0000000000b2/in_person']);
  });

  it('refuses an enrolled account and writes nothing', async () => {
    const d = deps(known('active'));
    const result = await inviteAccount(d)(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ALREADY_ENROLLED');
    expect(d.written).toEqual([]);
    // And nothing is sent. An unsolicited "you have been invited" to somebody
    // who already works there is a phishing lesson taught by us.
    expect(d.sent).toEqual([]);
  });

  it('refuses a terminated account', async () => {
    const result = await inviteAccount(deps(known('terminated')))(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACCOUNT_TERMINATED');
  });
});

describe('when the message cannot be sent', () => {
  it('still returns the invitation, so the link can be handed over in person', async () => {
    // The whole reason `send` reports rather than throws. A messaging outage
    // must not be able to stop a new hire being given access — and handing the
    // link over in person is the channel the design prefers anyway.
    const failing = notifier({ delivered: false, messageId: null, reason: 'provider' });
    const d = deps({}, { notifier: failing.port });

    const result = await inviteAccount(d)(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.delivery.delivered).toBe(false);
    expect(result.value.delivery.reason).toBe('provider');
    // The account and the token are committed regardless.
    expect(d.written).toHaveLength(2);
    expect(result.value.enrolUrl).toContain('token=a-single-use-token');
  });
});

describe('refusals that never reach the database', () => {
  it('refuses a company that does not exist', async () => {
    const d = deps({}, { tenantById: () => Promise.resolve(null) });
    const result = await inviteAccount(d)(request);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TENANT_UNKNOWN');
    expect(d.written).toEqual([]);
  });
});

describe('the employment record the account is created against', () => {
  it('commissions against today when the caller does not say', async () => {
    const d = deps();
    const result = await inviteAccount(d)(request);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employmentStart).toBe('2026-08-24');
    expect(result.value.timeZone).toBe('Etc/UTC');
  });

  it('commissions against a forward-dated start, which is the point', async () => {
    // `Account.enrol` refuses a passkey before the start date. An account
    // commissioned with today's date can be enrolled the moment the link
    // arrives — right for somebody starting today, wrong for a hire entered
    // three weeks early, who could otherwise be logging in for three weeks
    // before they are employed.
    const d = deps();
    const result = await inviteAccount(d)({
      ...request,
      employmentStart: '2026-09-14',
      timeZone: 'Europe/Madrid',
    });

    expect(result.ok).toBe(true);
    expect(d.written[0]).toBe('commission:ada@acme.example@2026-09-14/Europe/Madrid');
  });

  it('takes today in the stated zone, not in UTC', async () => {
    // 09:00 UTC on the 24th is 23:00 on the 23rd in Honolulu. Somebody starting
    // "today" there starts on the 23rd, and an account dated the 24th refuses
    // their passkey for the rest of their first day.
    const d = deps();
    await inviteAccount(d)({ ...request, timeZone: 'Pacific/Honolulu' });
    expect(d.written[0]).toBe('commission:ada@acme.example@2026-08-23/Pacific/Honolulu');
  });

  it.each([
    ['a date that is not one', '14/09/2026'],
    ['a day that does not exist', '2026-02-30'],
    ['a partial date', '2026-09'],
  ])('refuses %s without writing anything', async (_case, employmentStart) => {
    const d = deps();
    const result = await inviteAccount(d)({ ...request, employmentStart });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPLOYMENT_START_MALFORMED');
    expect(d.written).toEqual([]);
  });

  it('refuses a zone the runtime does not know', async () => {
    const d = deps();
    const result = await inviteAccount(d)({ ...request, timeZone: 'Europe/Atlantis' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TIME_ZONE_UNKNOWN');
    expect(d.written).toEqual([]);
  });

  it('refuses a start date far enough out to be a typo', async () => {
    // `2036` for `2026` is one keystroke, and it produces an account nobody can
    // enrol for a decade — which looks exactly like the link being broken.
    const d = deps();
    const result = await inviteAccount(d)({ ...request, employmentStart: '2036-09-14' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EMPLOYMENT_START_IMPLAUSIBLE');
  });

  it('accepts a start date in the past, which is a rehire or a backfill', async () => {
    const d = deps();
    const result = await inviteAccount(d)({ ...request, employmentStart: '2019-01-07' });
    expect(result.ok).toBe(true);
  });
});

describe('the second channel', () => {
  it('records in person by default', async () => {
    const d = deps();
    await inviteAccount(d)(request);
    expect(d.written[1]).toContain('/in_person');
  });

  it('records the one the employer actually used', async () => {
    // Recorded rather than enforced today, which is exactly why recording it
    // matters: it is what makes the claim checkable after the fact.
    const d = deps();
    await inviteAccount(d)({ ...request, secondChannel: 'known_value' });
    expect(d.written[1]).toContain('/known_value');
  });
});

describe('what the message is told about the company', () => {
  it('passes the mark through when the company allows it', async () => {
    const d = deps();
    await inviteAccount(d)(request);
    expect(d.sent[0]?.logoUrl).toBe(LOGO);
  });

  it('passes null when the company has asked not to be shown', async () => {
    // Decided by `brandingFor` in whoever supplies `tenantById`, so the
    // messaging service never learns the flag exists.
    const d = deps(
      {},
      {
        tenantById: () =>
          Promise.resolve({ slug: 'acme', displayName: 'Acme Corp', logoUrl: null }),
      },
    );
    await inviteAccount(d)(request);
    expect(d.sent[0]?.logoUrl).toBeNull();
  });
});
