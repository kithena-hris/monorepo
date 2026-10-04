import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { logger } from '@kithena/telemetry';

import type { ReadCache } from '../application/read-cache.js';

/**
 * People's read cache in Valkey (`application/read-cache.ts` says what it
 * keeps and why it cannot leak): the Valkey already on the VM for BullMQ,
 * `VALKEY_URL`, nothing new to run or pay for.
 *
 * - `people:read:gen:<tenant>` — the tenant's generation, a counter moved on
 *   by `changed`. Kept a day past its last move; gone, it starts again, and
 *   every answer it outlived expired long before.
 * - `people:read:<tenant>:<sha256(key)>` — `{ g, v }`: the answer and the
 *   generation it was read in, for `TTL_SECONDS`.
 *
 * One round trip per read (both keys in one MGET), one per write, two per
 * change. Values are plain JSON, readable with `valkey-cli`.
 */

/** The backstop for what no write marks: the calendar, a missed move. */
export const TTL_SECONDS = 60;
const GENERATION_KEPT_SECONDS = 24 * 60 * 60;

/**
 * The commands this needs, and not the other three hundred: structural, so a
 * test satisfies it with a Map and swapping the client is one file
 * (`platform/identity`'s `valkey-session-cache.ts` does the same).
 */
export interface ValkeyClient {
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

const generationKey = (tenantId: string): string => `people:read:gen:${tenantId}`;
const valueKey = (tenantId: string, key: string): string =>
  `people:read:${tenantId}:${createHash('sha256').update(key).digest('hex')}`;

export function valkeyReadCache(client: ValkeyClient): ReadCache {
  let told = false;
  const failed = (cause: unknown): void => {
    // Once per process: a Valkey that is down is a slower People, not a broken one.
    if (told) return;
    told = true;
    logger.warn({ err: cause, module: 'people' }, 'read cache unavailable; reads are computed');
  };
  return {
    async read(tenantId, key) {
      try {
        const [generation, kept] = await client.mget(
          generationKey(tenantId),
          valueKey(tenantId, key),
        );
        const current = generation ?? '0';
        if (kept !== null && kept !== undefined) {
          const parsed = JSON.parse(kept) as { g?: unknown; v?: unknown };
          if (parsed.g === current) return { hit: true, value: parsed.v };
        }
        return { hit: false, generation: current };
      } catch (cause) {
        failed(cause);
        return { hit: false, generation: null };
      }
    },
    async write(tenantId, key, generation, value) {
      try {
        await client.set(
          valueKey(tenantId, key),
          JSON.stringify({ g: generation, v: value }),
          'EX',
          TTL_SECONDS,
        );
      } catch (cause) {
        failed(cause);
      }
    },
    async changed(tenantId) {
      try {
        await client.incr(generationKey(tenantId));
        await client.expire(generationKey(tenantId), GENERATION_KEPT_SECONDS);
      } catch (cause) {
        failed(cause);
      }
    },
  };
}

let shared: ReadCache | null | undefined;

/**
 * The process's read cache, from `VALKEY_URL`; null without one (a laptop, a
 * standalone boot, the acceptance stack), and People reads as it always did.
 * One connection for the process, shared by every caller.
 */
export function readCacheFrom(env: NodeJS.ProcessEnv): ReadCache | null {
  if (shared !== undefined) return shared;
  const url = env['VALKEY_URL'];
  if (url === undefined || url === '') {
    shared = null;
    return shared;
  }
  const client = new Redis(url, {
    // A read waits for the cache at most this long, then is computed; while
    // Valkey is unreachable a command fails at once rather than queueing, so
    // a Valkey that is down costs People nothing per read. A move missed that
    // way is what `TTL_SECONDS` bounds.
    commandTimeout: 250,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('error', () => {
    // Said once by `failed`, on the first command that meets it.
  });
  // Not closed on shutdown: the drain's writes still move generations on, and
  // the process exits once its steps are done (`@kithena/telemetry`).
  shared = valkeyReadCache(client);
  return shared;
}
