import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { fixedClock } from '@kithena/domain-kit';
import { startValkey } from '@kithena/testing';

import { authenticate } from './application/authenticate.js';
import { revokeSession } from './application/revoke-session.js';
import type { CachedSession } from './application/session-cache.js';
import { valkeySessionCache, type ValkeyClient } from './infrastructure/valkey-session-cache.js';

/**
 * The session cache, against a real Valkey.
 *
 * Two properties are worth a container rather than a fake. Losing the cache
 * must not log anybody out, because every session is still a row in Postgres —
 * and `docker-compose.yml` runs Valkey with no persistence configured at all,
 * so "the cache went away" is a Tuesday rather than an incident. And a
 * revocation must clear the cache before the durable row, so that a failure in
 * the middle leaves a cache miss rather than a logout that did not log anyone
 * out.
 */

const TENANT = '00000000-0000-4000-8000-00000000000a';

let stop: (() => Promise<void>) | undefined;
let client: Redis | undefined;

const session: CachedSession = {
  sessionId: '00000000-0000-4000-8000-0000000000b1',
  accountId: '00000000-0000-4000-8000-0000000000a1',
  tenantId: TENANT,
  identityId: '00000000-0000-4000-8000-0000000000d1',
  amr: ['swk', 'user'],
  authenticatedAt: '2026-04-01T09:00:00.000Z',
  expiresAt: '2026-05-01T09:00:00.000Z',
  lastSeenAt: '2026-04-01T09:00:00.000Z',
};

const clock = fixedClock('2026-04-01T10:00:00.000Z');

beforeAll(async () => {
  const started = await startValkey();
  stop = started.stop;
  client = new Redis(started.url);
});

afterAll(async () => {
  client?.disconnect();
  await stop?.();
});

function cache() {
  return valkeySessionCache(client as unknown as ValkeyClient);
}

describe('the cache round-trips a session', () => {
  it('reads back what it wrote', async () => {
    await cache().write(session, 60);
    expect(await cache().read(session.sessionId)).toEqual(session);
  });

  it('returns null for a session it has never seen', async () => {
    expect(await cache().read('00000000-0000-4000-8000-00000000dead')).toBeNull();
  });

  it('expires every key it writes', async () => {
    // A cache entry with no TTL turns one lost delete into a session that
    // outlives its own row.
    await cache().write(session, 60);
    const ttl = await client?.ttl(`session:${session.sessionId}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });

  it('treats a value it cannot parse as a miss, and clears it', async () => {
    // What a rolling deploy looks like when the stored shape changes. Healing
    // by re-reading Postgres beats a wave of 500s.
    await client?.set(`session:${session.sessionId}`, 'not json at all');
    expect(await cache().read(session.sessionId)).toBeNull();
    expect(await client?.get(`session:${session.sessionId}`)).toBeNull();
  });
});

describe('losing the cache logs nobody out', () => {
  it('serves the session from the durable store and repopulates', async () => {
    await client?.flushall();

    const run = authenticate({
      cache: cache(),
      load: () => Promise.resolve(session),
      clock,
    });

    expect((await run(TENANT, session.sessionId)).ok).toBe(true);
    // And it is warm again afterwards, so the next request costs one read.
    expect(await cache().read(session.sessionId)).toEqual(session);
  });

  it('costs one durable read per session, not one per request', async () => {
    await client?.flushall();
    let loads = 0;
    const run = authenticate({
      cache: cache(),
      load: () => {
        loads += 1;
        return Promise.resolve(session);
      },
      clock,
    });

    await run(TENANT, session.sessionId);
    await run(TENANT, session.sessionId);
    await run(TENANT, session.sessionId);

    expect(loads).toBe(1);
  });
});

describe('revocation clears the cache before the durable row', () => {
  it('leaves nothing cached when both succeed', async () => {
    await cache().write(session, 60);

    await revokeSession({ cache: cache(), remove: () => Promise.resolve() })(
      TENANT,
      session.sessionId,
    );

    expect(await cache().read(session.sessionId)).toBeNull();
  });

  it('leaves a cache miss, not a live session, when the durable delete fails', async () => {
    // The whole reason for the order. With the cache cleared first, a failed
    // database delete means the next request re-reads Postgres, finds the
    // session alive, and puts it back — the revocation did not happen, which is
    // the truth. The other order would leave the cache serving a session whose
    // row is gone.
    await cache().write(session, 60);

    await expect(
      revokeSession({
        cache: cache(),
        remove: () => Promise.reject(new Error('database unavailable')),
      })(TENANT, session.sessionId),
    ).rejects.toThrow('database unavailable');

    expect(await cache().read(session.sessionId)).toBeNull();

    // And the session is genuinely still usable, because it was never revoked.
    const run = authenticate({ cache: cache(), load: () => Promise.resolve(session), clock });
    expect((await run(TENANT, session.sessionId)).ok).toBe(true);
  });
});

describe('a cookie does not travel between tenants', () => {
  it('refuses a cached session presented on another tenant’s hostname', async () => {
    await cache().write(session, 60);

    const run = authenticate({
      cache: cache(),
      load: () => Promise.resolve(null),
      clock,
    });

    const result = await run('00000000-0000-4000-8000-00000000000b', session.sessionId);
    expect(result.ok).toBe(false);
  });
});
