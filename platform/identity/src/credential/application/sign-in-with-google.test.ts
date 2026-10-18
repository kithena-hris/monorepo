import { ok } from '@kithena/domain-kit';
import { describe, expect, it } from 'vitest';

import {
  beginGoogleSignIn,
  finishGoogleSignIn,
  type GoogleSignInDeps,
  type GoogleTrip,
} from './sign-in-with-google.js';

const device = { userAgent: 'test', ip: null, aaguid: null };

/** Google, a company with it switched on, and one invited person there. */
function world(overrides: Partial<GoogleSignInDeps> = {}) {
  let nonceSeen = '';
  const trips = new Map<string, GoogleTrip>();
  const links = new Map<string, string>();
  const sessions: { tenantId: string; accountId: string; amr: readonly string[] }[] = [];
  const deps: GoogleSignInDeps = {
    clientId: 'client-1',
    redirectUri: 'https://auth.example/google/callback',
    trips: {
      issue: (state, trip) => Promise.resolve(void trips.set(state, trip)),
      consume: (state) => {
        const trip = trips.get(state) ?? null;
        trips.delete(state);
        return Promise.resolve(trip);
      },
    },
    tenantBySlug: (slug) => Promise.resolve(slug === 'acme' ? { id: 't-acme', slug } : null),
    exchange: (code) =>
      Promise.resolve(
        code === 'good'
          ? {
              sub: 'g-1',
              email: 'ada@acme.example',
              email_verified: true,
              hd: 'acme.example',
              // The nonce of the trip this code came back from.
              nonce: nonceSeen,
            }
          : null,
      ),
    linkedIdentity: (sub) => Promise.resolve(links.get(sub) ?? null),
    accountsFor: (identityId) =>
      Promise.resolve(
        identityId === 'i-ada'
          ? [
              {
                accountId: 'a-ada',
                tenantId: 't-acme',
                tenantSlug: 'acme',
                workEmail: 'ada@acme.example',
              },
            ]
          : [],
      ),
    link: (tenantId, account) => {
      if (tenantId !== 't-acme' || account.email !== 'ada@acme.example') {
        return Promise.resolve(null);
      }
      links.set(account.sub, 'i-ada');
      return Promise.resolve('a-ada');
    },
    beginSession: (tenantId, accountId, _device, amr) => {
      sessions.push({ tenantId, accountId, amr });
      return Promise.resolve(
        ok({ sessionId: 's-1', accountId, expiresAt: '2026-11-17T00:00:00Z' }),
      );
    },
    handOff: (_tenantId, session) => Promise.resolve(`code-for-${session.sessionId}`),
    ...overrides,
  };
  const begin = beginGoogleSignIn(deps);
  const finish = finishGoogleSignIn(deps);
  /** Leave for Google and come back with `code`. */
  const trip = async (code: string, app: GoogleTrip['app'] = null) => {
    const url = await begin({ tenantSlug: 'acme', app });
    if (url === null) throw new Error('no trip');
    const state = new URL(url).searchParams.get('state') ?? '';
    nonceSeen = trips.get(state)?.nonce ?? '';
    return { state, url: new URL(url), finished: await finish({ code, state, device }) };
  };
  return { begin, finish, trip, links, sessions };
}

describe('leaving for Google', () => {
  it('asks Google for a code, with PKCE and a nonce, back to the one callback', async () => {
    const { url } = await world().trip('good');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'client-1',
      redirect_uri: 'https://auth.example/google/callback',
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
    });
    expect(url.searchParams.get('code_challenge')).not.toBe('');
    expect(url.searchParams.get('nonce')).not.toBe('');
  });

  it('does not leave for a company without Google', async () => {
    expect(await world().begin({ tenantSlug: 'globex', app: null })).toBeNull();
  });
});

describe('coming back from Google', () => {
  it('links the work address the first time and signs in as a federated session', async () => {
    const w = world();
    const { finished } = await w.trip('good');
    expect(finished).toEqual({
      kind: 'signed-in',
      tenantSlug: 'acme',
      code: 'code-for-s-1',
      app: null,
    });
    expect(w.links.get('g-1')).toBe('i-ada');
    expect(w.sessions).toEqual([{ tenantId: 't-acme', accountId: 'a-ada', amr: ['fed'] }]);
  });

  it('signs in by the link afterwards, without looking at the address', async () => {
    let linked = 0;
    const w = world({
      link: () => {
        linked++;
        return Promise.resolve(null);
      },
    });
    w.links.set('g-1', 'i-ada');
    const { finished } = await w.trip('good');
    expect(finished.kind).toBe('signed-in');
    expect(linked).toBe(0);
  });

  it('carries the phone app through the trip', async () => {
    const app = { redirect: 'kithena://signed-in', challenge: 'c-1' };
    const { finished } = await world().trip('good', app);
    expect(finished).toMatchObject({ kind: 'signed-in', app });
  });

  it('sends a refusal back to the company it came from', async () => {
    const { finished } = await world().trip('bad');
    expect(finished).toEqual({ kind: 'refused', tenantSlug: 'acme' });
  });

  it('refuses a Google account with no account at the company', async () => {
    const w = world({ link: () => Promise.resolve(null) });
    const { finished } = await w.trip('good');
    expect(finished).toEqual({ kind: 'refused', tenantSlug: 'acme' });
    expect(w.sessions).toEqual([]);
  });

  it('spends the trip: the same state does not work twice', async () => {
    const w = world();
    const { state } = await w.trip('good');
    expect(await w.finish({ code: 'good', state, device })).toEqual({
      kind: 'refused',
      tenantSlug: null,
    });
  });
});
