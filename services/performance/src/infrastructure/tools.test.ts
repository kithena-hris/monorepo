import { describe, expect, it } from 'vitest';

import { githubTools, signToolState, verifyToolState } from './tools.js';

const ENV = {
  GITHUB_APP_CLIENT_ID: 'Iv1.client',
  GITHUB_APP_CLIENT_SECRET: 'shh',
  PERFORMANCE_WEBHOOK_KEY: 'root-key',
  AUTH_ORIGIN: 'https://auth.app.kithena.com',
};
const TENANT = '11111111-1111-4111-8111-111111111111';
const PERSON = '33333333-3333-4333-8333-333333333333';

/** A GitHub that answers what the adapter asks, and remembers the asking. */
function fakeGitHub(expiresIn?: number) {
  const asked: string[] = [];
  const http: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    asked.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (body: unknown) => Promise.resolve(Response.json(body));
    if (url === 'https://github.com/login/oauth/access_token') {
      const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
      return json({
        access_token: form.get('grant_type') === 'refresh_token' ? 'gho_renewed' : 'gho_first',
        ...(expiresIn === undefined ? {} : { expires_in: expiresIn, refresh_token: 'ghr_1' }),
      });
    }
    if (url === 'https://api.github.com/user') return json({ login: 'marco-gh' });
    if (url.startsWith('https://api.github.com/search/issues'))
      return json({
        items: decodeURIComponent(url).includes('author:adam-gh created')
          ? [
              {
                html_url: 'https://github.com/acme/api/pull/7',
                title: 'Export in CSV',
                body: 'Adds the export.',
                created_at: '2026-03-01T10:00:00Z',
                closed_at: '2026-03-02T10:00:00Z',
                repository_url: 'https://api.github.com/repos/acme/api',
                pull_request: { merged_at: '2026-03-02T10:00:00Z' },
              },
            ]
          : [],
      });
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  return { http, asked };
}

describe('the GitHub connector', () => {
  it('is off until its app, key and return address are all set', () => {
    expect(githubTools({ ...ENV, GITHUB_APP_CLIENT_SECRET: '' })).toBeUndefined();
    expect(githubTools(ENV)).toBeDefined();
  });

  it('carries a state the auth origin can read and only this company and person can finish', async () => {
    const clock = { ms: 1_000 };
    const gh = githubTools(ENV, fakeGitHub().http, () => clock.ms);
    const asked = await gh?.authorize({
      tenantId: TENANT,
      personId: PERSON,
      origin: 'https://acme.app.kithena.com',
    });
    const url = new URL(asked?.ok === true ? asked.value.url : '');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://auth.app.kithena.com/tools/github/done',
    );
    const state = url.searchParams.get('state') ?? '';
    const [claims] = state.split('.');
    expect(JSON.parse(Buffer.from(claims ?? '', 'base64url').toString('utf8'))).toMatchObject({
      o: 'https://acme.app.kithena.com',
    });
    const someoneElse = await gh?.complete({
      tenantId: TENANT,
      personId: 'not-them',
      code: 'c',
      state,
    });
    expect(someoneElse?.ok).toBe(false);
    const done = await gh?.complete({ tenantId: TENANT, personId: PERSON, code: 'c', state });
    expect(done?.ok === true ? done.value.account : '').toBe('marco-gh');
    // The token is sealed: nothing of it is readable in what is kept.
    expect(done?.ok === true ? done.value.secret : '').not.toContain('gho_');
    clock.ms += 11 * 60 * 1000;
    expect((await gh?.complete({ tenantId: TENANT, personId: PERSON, code: 'c', state }))?.ok).toBe(
      false,
    );
  });

  it('reads the subject’s pull requests in the period, renewing a token about to expire', async () => {
    const clock = { ms: 1_000 };
    const fake = fakeGitHub(30);
    const gh = githubTools(ENV, fake.http, () => clock.ms);
    const asked = await gh?.authorize({
      tenantId: TENANT,
      personId: PERSON,
      origin: 'https://acme.app.kithena.com',
    });
    const state =
      new URL(asked?.ok === true ? asked.value.url : '').searchParams.get('state') ?? '';
    const done = await gh?.complete({ tenantId: TENANT, personId: PERSON, code: 'c', state });
    const secret = done?.ok === true ? done.value.secret : null;
    const found = await gh?.search({
      tenantId: TENANT,
      personId: PERSON,
      secret,
      subject: { email: 'adam@acme.example', account: 'adam-gh' },
      from: '2026-01-01',
      to: '2026-06-30',
    });
    expect(found?.ok === true ? found.value.items : []).toEqual([
      {
        link: 'https://github.com/acme/api/pull/7',
        date: '2026-03-02',
        kind: 'pull request',
        text: 'acme/api: Export in CSV (merged) — Adds the export.',
      },
    ]);
    // Within a minute of expiring, so renewed first, and the new one handed back to keep.
    expect(found?.ok === true ? found.value.secret : undefined).toEqual(expect.any(String));
    expect(fake.asked.filter((a) => a.includes('access_token'))).toHaveLength(2);
    expect(
      fake.asked.some((a) =>
        decodeURIComponent(a).includes('type:pr author:adam-gh created:2026-01-01..2026-06-30'),
      ),
    ).toBe(true);
  });

  it('signs and checks a state with its own key', () => {
    const key = Buffer.alloc(32, 1);
    const state = signToolState(key, { t: TENANT, a: PERSON, o: 'https://acme' }, 0);
    expect(verifyToolState(key, state, 1)).toEqual({ t: TENANT, a: PERSON });
    expect(verifyToolState(Buffer.alloc(32, 2), state, 1)).toBeNull();
  });
});
