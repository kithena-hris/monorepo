import type { CachedSession, SessionCache } from '../application/session-cache.js';

/**
 * The session cache, in Valkey.
 *
 * **Not mounted.** `composition.ts` does not reference this, and has not since
 * it was written — every authenticated request reads its session from Postgres.
 * That is the right call at present: the back-office has one operator, and a
 * cache in front of a query nobody is waiting on buys nothing while adding a
 * process that can be down while the service is up. This is kept rather than
 * deleted because the shape is correct and the day a dashboard says session
 * reads are hot, mounting it is one line — see `SessionCache` in
 * `../application/session-cache.ts`, and `docs/environments.md` for what
 * changes at scale.
 *
 * The client is `ioredis` and the server is Valkey, which is not a
 * contradiction: Valkey is the Linux Foundation's fork of Redis and speaks the
 * same protocol, and `ioredis` is the mature MIT-licensed client. `iovalkey`
 * exists and is the same library renamed, but it is 0.x, and the read path for
 * every authenticated request is not where a young client earns its place.
 *
 * Values are plain JSON. A binary codec would save bytes on an object of this
 * size and cost the ability to read a key with `valkey-cli` while working out
 * why somebody is logged out.
 */
const KEY = (sessionId: string): string => `session:${sessionId}`;

/**
 * The three commands this needs, and not the other three hundred.
 *
 * Structural rather than `ioredis`'s own type: the adapter states what it uses,
 * a test can satisfy it in four lines, and swapping the client is a change to
 * one file rather than to every signature that mentions it. It also sidesteps
 * the client's default export being a namespace under `verbatimModuleSyntax`.
 */
export interface ValkeyClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export function valkeySessionCache(client: ValkeyClient): SessionCache {
  return {
    async read(sessionId) {
      const raw = await client.get(KEY(sessionId));
      if (raw === null) return null;

      try {
        return JSON.parse(raw) as CachedSession;
      } catch {
        // A value this process cannot parse was written by a different version
        // of this process. Treating it as a miss re-reads Postgres and rewrites
        // the key in the current shape, which is a rolling deploy healing
        // itself rather than a wave of 500s.
        await client.del(KEY(sessionId));
        return null;
      }
    },

    async write(session, ttlSeconds) {
      // Every key expires. A cache with no TTL turns one lost delete into a
      // session that outlives its own row.
      await client.set(
        KEY(session.sessionId),
        JSON.stringify(session),
        'EX',
        Math.max(ttlSeconds, 1),
      );
    },

    async forget(sessionId) {
      await client.del(KEY(sessionId));
    },
  };
}
