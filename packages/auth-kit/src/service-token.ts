import { timingSafeEqual } from 'node:crypto';

/**
 * The shared secret between two of our own processes.
 *
 * Not a `Principal`. Everything else in this package answers "which human is
 * this and what may they do"; this answers the question that comes before it —
 * whether the caller is one of ours at all. The routes it guards run before any
 * human is known: the tenant registry the proxy reads on every request, the
 * back-office provisioning API, and the messaging service, none of which have a
 * person to authenticate.
 *
 * Constant-time, because the obvious comparison leaks the token. `a === b` on
 * strings returns at the first differing byte, so how long it takes says how
 * many leading bytes were right, and a few thousand requests turn that into the
 * secret. `timingSafeEqual` throws on a length mismatch — itself a leak of the
 * length — so lengths are compared first and only equal-length inputs reach it.
 *
 * It lives here rather than in either service because both need it and neither
 * owns it, and a second copy of a constant-time comparison is a second chance
 * to write `===`.
 */

/** Just enough of a request to read one header. Keeps `node:http` out of the
 *  signature, so this compiles the same in a function runtime as in a server. */
export interface HeaderCarrier {
  readonly headers: Record<string, string | string[] | undefined>;
}

export function presentsInternalToken(request: HeaderCarrier, expected: string): boolean {
  const presented = request.headers['x-internal-token'];
  if (typeof presented !== 'string' || expected.length === 0) return false;

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
