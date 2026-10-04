import { describe, expect, it } from 'vitest';
import { createLogger } from '@kithena/telemetry';

import { identityFrom } from './identity.js';

/** The identity client against a mocked `fetch` (assistant PRD §10.1). */

const TENANT = '00000000-0000-4000-8000-00000000000a';
const SETTINGS = { IDENTITY_URL: 'http://identity:4100/', ASSISTANT_IDENTITY_TOKEN: 'pair' };
const quiet = createLogger({ write: () => undefined });
const ASKER = {
  accountId: '00000000-0000-4000-8000-000000000900',
  timeZone: 'Europe/Madrid',
  slug: 'acme',
  entitlements: ['module.people'],
};

function fetching(status: number, body: unknown = ASKER) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fake = ((url: string, init: RequestInit = {}) => {
    sent.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { fake, sent };
}

describe('who is asking, from identity', () => {
  it('posts the email with the pair token, and keeps the answer a minute', async () => {
    let at = 0;
    const { fake, sent } = fetching(200);
    const identity = identityFrom(SETTINGS, { fetch: fake, logger: quiet, now: () => at });
    expect(await identity.asker(TENANT, { email: 'Ada@acme.example' })).toEqual({ ok: true, value: ASKER });
    expect(sent[0]?.url).toBe(
      `http://identity:4100/api/internal/tenants/${TENANT}/assistant/asker`,
    );
    const init = sent[0]?.init ?? {};
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'Ada@acme.example' });
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('pair');
    at = 59_000;
    await identity.asker(TENANT, { email: 'ada@acme.example' });
    expect(sent).toHaveLength(1);
    at = 61_000;
    await identity.asker(TENANT, { email: 'ada@acme.example' });
    expect(sent).toHaveLength(2);
  });

  it('posts the web’s signed-in account in place of an email, and keeps it apart', async () => {
    const { fake, sent } = fetching(200);
    const identity = identityFrom(SETTINGS, { fetch: fake, logger: quiet });
    expect(await identity.asker(TENANT, { accountId: ASKER.accountId })).toEqual({
      ok: true,
      value: ASKER,
    });
    expect(JSON.parse(sent[0]?.init.body as string)).toEqual({ accountId: ASKER.accountId });
    await identity.asker(TENANT, { email: 'ada@acme.example' });
    expect(sent).toHaveLength(2);
  });

  it('reads a 404 as nobody, and never keeps it', async () => {
    const { fake, sent } = fetching(404, {});
    const identity = identityFrom(SETTINGS, { fetch: fake, logger: quiet });
    expect(await identity.asker(TENANT, { email: 'x@acme.example' })).toEqual({
      ok: false,
      error: 'NOT_FOUND',
    });
    await identity.asker(TENANT, { email: 'x@acme.example' });
    expect(sent).toHaveLength(2);
  });

  it('reads anything else, a malformed answer, or no identity configured as unreachable', async () => {
    const unreachable = { ok: false, error: 'UNREACHABLE' };
    const failing = identityFrom(SETTINGS, { fetch: fetching(500).fake, logger: quiet });
    expect(await failing.asker(TENANT, { email: 'a@acme.example' })).toEqual(unreachable);
    const odd = identityFrom(SETTINGS, {
      fetch: fetching(200, { who: 'knows' }).fake,
      logger: quiet,
    });
    expect(await odd.asker(TENANT, { email: 'a@acme.example' })).toEqual(unreachable);
    const { fake, sent } = fetching(200);
    expect(
      await identityFrom({}, { fetch: fake, logger: quiet }).asker(TENANT, { email: 'a@acme.example' }),
    ).toEqual(unreachable);
    expect(sent).toHaveLength(0);
  });
});
