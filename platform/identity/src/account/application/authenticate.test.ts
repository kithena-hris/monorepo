import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';

import { authenticate } from './authenticate.js';
import type { CachedSession, SessionCache } from './session-cache.js';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const OTHER = '00000000-0000-4000-8000-00000000000b';

const session = (over: Partial<CachedSession> = {}): CachedSession => ({
  sessionId: '00000000-0000-4000-8000-0000000000b1',
  accountId: '00000000-0000-4000-8000-0000000000a1',
  tenantId: TENANT,
  identityId: '00000000-0000-4000-8000-0000000000d1',
  amr: ['swk', 'user'],
  authenticatedAt: '2026-04-01T09:00:00.000Z',
  expiresAt: '2026-05-01T09:00:00.000Z',
  lastSeenAt: '2026-04-01T09:00:00.000Z',
  ...over,
});

function fakeCache(seed: CachedSession | null = null): SessionCache & { writes: number } {
  let held = seed;
  const state = {
    writes: 0,
    read: () => Promise.resolve(held),
    write: (s: CachedSession) => {
      held = s;
      state.writes += 1;
      return Promise.resolve();
    },
    forget: () => {
      held = null;
      return Promise.resolve();
    },
  };
  return state;
}

const clock = fixedClock('2026-04-01T10:00:00.000Z');

describe('authenticate', () => {
  it('accepts a live session from the cache without touching the database', async () => {
    let loads = 0;
    const run = authenticate({
      cache: fakeCache(session()),
      load: () => {
        loads += 1;
        return Promise.resolve(null);
      },
      clock,
    });

    const result = await run(TENANT, 'any');

    expect(result.ok).toBe(true);
    expect(loads).toBe(0);
  });

  it('falls back to the database on a miss and repopulates', async () => {
    // The property that makes losing Valkey survivable: every session is still
    // in Postgres, so a cold cache costs latency rather than logging anyone out.
    const cache = fakeCache(null);
    const run = authenticate({ cache, load: () => Promise.resolve(session()), clock });

    expect((await run(TENANT, 'any')).ok).toBe(true);
    expect(cache.writes).toBe(1);
  });

  it('writes nothing when the cache already had it', async () => {
    const cache = fakeCache(session());
    const run = authenticate({ cache, load: () => Promise.resolve(null), clock });

    await run(TENANT, 'any');

    expect(cache.writes).toBe(0);
  });

  it('refuses a session belonging to another tenant, and says so', async () => {
    // A cookie is host-only, so this should be impossible in a browser. It is
    // checked anyway because "impossible in a browser" is not the same as
    // "impossible", and the cost of checking is one string comparison.
    const seen: string[] = [];
    const run = authenticate({
      cache: fakeCache(session({ tenantId: OTHER })),
      load: () => Promise.resolve(null),
      clock,
      onTenantMismatch: (s) => seen.push(s.tenantId),
    });

    const result = await run(TENANT, 'any');

    expect(result.ok).toBe(false);
    expect(seen).toEqual([OTHER]);
  });

  it('refuses a session past its absolute expiry', async () => {
    const run = authenticate({
      cache: fakeCache(session({ expiresAt: '2026-04-01T09:30:00.000Z' })),
      load: () => Promise.resolve(null),
      clock,
    });
    expect((await run(TENANT, 'any')).ok).toBe(false);
  });

  it('refuses a session that has been idle too long', async () => {
    // Idle and absolute are different limits. This one is an hour old and
    // nowhere near its absolute expiry, and an idle timeout of ten minutes
    // still ends it.
    const run = authenticate({
      cache: fakeCache(session()),
      load: () => Promise.resolve(null),
      clock,
      idleTimeoutSeconds: 600,
    });
    expect((await run(TENANT, 'any')).ok).toBe(false);
  });

  it('gives the same answer to a missing session and an expired one', async () => {
    // Nothing a caller receives distinguishes "never existed" from "expired"
    // from "wrong tenant". All three are the same refusal; only the log knows.
    const missing = authenticate({
      cache: fakeCache(null),
      load: () => Promise.resolve(null),
      clock,
    });
    const expired = authenticate({
      cache: fakeCache(session({ expiresAt: '2026-01-01T00:00:00.000Z' })),
      load: () => Promise.resolve(null),
      clock,
    });

    const a = await missing(TENANT, 'x');
    const b = await expired(TENANT, 'x');
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (a.ok || b.ok) return;
    expect(a.error).toEqual(b.error);
  });
});

/*
 * The idle window has to move, or it is not an idle window.
 *
 * With `lastSeenAt` frozen at sign-in, the eight-hour idle limit behaves as an
 * eight-hour absolute limit and somebody working through the day is signed out
 * mid-afternoon. These are the tests that keep the two limits distinct.
 */
describe('authenticate, keeping somebody signed in', () => {
  it('slides lastSeenAt once the session has been idle a while', async () => {
    const touched: { id: string; at: string }[] = [];
    const run = authenticate({
      cache: fakeCache(),
      load: () => Promise.resolve(session({ lastSeenAt: '2026-04-01T09:00:00.000Z' })),
      clock,
      touch: (_tenantId, id, at) => {
        touched.push({ id, at });
        return Promise.resolve();
      },
    });

    const result = await run(TENANT, 'any');
    expect(result.ok).toBe(true);
    expect(touched).toHaveLength(1);
    expect(touched[0]?.at).toBe('2026-04-01T10:00:00.000Z');
    // The returned session carries the new value, so the caller is not handed a
    // record it would immediately have to re-read to see the truth.
    if (result.ok) expect(result.value.lastSeenAt).toBe('2026-04-01T10:00:00.000Z');
  });

  it('does not write on every request', async () => {
    let touches = 0;
    const run = authenticate({
      cache: fakeCache(session({ lastSeenAt: '2026-04-01T09:59:00.000Z' })),
      load: () => Promise.resolve(null),
      clock,
      touch: () => {
        touches += 1;
        return Promise.resolve();
      },
    });

    // A minute of idleness is inside the five-minute threshold. A session read
    // on every page, image and server action must not cost a write each time.
    expect((await run(TENANT, 'any')).ok).toBe(true);
    expect(touches).toBe(0);
  });

  /*
   * The distinction that matters, and the one a sliding window usually gets
   * wrong: activity extends the idle limit and must never extend the absolute
   * one. Thirty days after signing in, a person signs in again.
   */
  it('never extends the absolute lifetime', async () => {
    const run = authenticate({
      cache: fakeCache(),
      load: () =>
        Promise.resolve(session({ expiresAt: '2026-05-01T09:00:00.000Z' })),
      clock,
      touch: () => Promise.resolve(),
    });

    const result = await run(TENANT, 'any');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.expiresAt).toBe('2026-05-01T09:00:00.000Z');
  });

  it('refuses a session past its absolute lifetime however recently it was used', async () => {
    let touches = 0;
    const run = authenticate({
      cache: fakeCache(),
      load: () =>
        Promise.resolve(
          session({
            // Used a moment ago, but a month and a day old.
            lastSeenAt: '2026-04-01T09:59:59.000Z',
            expiresAt: '2026-04-01T09:00:00.000Z',
          }),
        ),
      clock,
      touch: () => {
        touches += 1;
        return Promise.resolve();
      },
    });

    expect((await run(TENANT, 'any')).ok).toBe(false);
    // And is not resurrected by the request that discovered it.
    expect(touches).toBe(0);
  });

  it('refuses a session idle past the timeout rather than sliding it', async () => {
    let touches = 0;
    const run = authenticate({
      cache: fakeCache(),
      load: () => Promise.resolve(session({ lastSeenAt: '2026-03-31T20:00:00.000Z' })),
      clock,
      touch: () => {
        touches += 1;
        return Promise.resolve();
      },
    });

    expect((await run(TENANT, 'any')).ok).toBe(false);
    expect(touches).toBe(0);
  });
});
