import type { Viewer } from './person/ports.js';

/**
 * Answers to People's heavier reads, kept per tenant until anything in that
 * tenant changes (`infrastructure/valkey-read-cache.ts` is the one there is).
 *
 * **What invalidates.** A tenant has a generation, and an answer is kept
 * under the generation it was read in. Every unit of work that wrote anything
 * in the tenant moves the generation on once it commits (`tenantTransaction`),
 * and so does every event the consumer applies (OpenFGA's tuples follow
 * People's events there, outside any write of People's own). An answer from
 * an older generation is never handed out again. A short expiry is the
 * backstop for what no write marks: the calendar turning over, a cache that
 * missed a move because it was briefly unreachable.
 *
 * **Why one viewer's answer never reaches another.** The key is the whole of
 * who is asking as People decided it for this request (`readKey`): the
 * account, its roles as OpenFGA answered them just now, support's operator,
 * the administrator viewing as somebody. A role granted or taken away is
 * another key at once, not an invalidation that has to arrive. And the
 * tenant is in every key and every generation, so nothing crosses tenants.
 *
 * **Failing.** Every method swallows its own failure: a read the cache cannot
 * answer is a read People computes, never an error and never a stale answer
 * held longer than the expiry.
 */
export interface ReadCache {
  /** The answer kept for `key`, or the generation a fresh one is to be kept under. */
  readonly read: (
    tenantId: string,
    key: string,
  ) => Promise<{ readonly hit: true; readonly value: unknown } | ReadMiss>;
  /** Keep `value` for `key`, under the generation the miss was read in. */
  readonly write: (
    tenantId: string,
    key: string,
    generation: string,
    value: unknown,
  ) => Promise<void>;
  /** Something in the tenant changed: nothing kept for it before now is answered again. */
  readonly changed: (tenantId: string) => Promise<void>;
}

export interface ReadMiss {
  readonly hit: false;
  /** Null when the cache could not be asked: the answer is computed and not kept. */
  readonly generation: string | null;
}

/**
 * Who is asking, and what: every part of the viewer the answer may depend on,
 * in a fixed order, with the request's path and query. Roles sorted, so two
 * requests holding the same ones share a key.
 */
export function readKey(viewer: Viewer, request: string): string {
  return JSON.stringify([
    viewer.accountId,
    [...viewer.roles].sort(),
    viewer.support?.operatorId ?? null,
    viewer.viewing?.by ?? null,
    request,
  ]);
}
