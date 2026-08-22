import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { err, failure, ok, type Clock, type Result } from '@kithena/domain-kit';

/**
 * The token that turns a commissioned account into a usable one.
 *
 * Its properties are the whole security of first login, so they are stated as
 * code rather than left to whoever writes the endpoint.
 */
export type SecondChannel = 'in_person' | 'known_value';

export interface EnrolmentToken {
  readonly id: string;
  readonly tenantId: string;
  readonly accountId: string;
  readonly secondChannel: SecondChannel;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
}

/** 72 hours: survives a weekend and a first day that moved. */
export const ENROLMENT_TTL_SECONDS = 72 * 60 * 60;

export const TokenRejected = failure(
  'ENROLMENT_TOKEN_INVALID',
  'That enrolment link is not usable',
);

/**
 * A new token, and the hash to store beside it.
 *
 * 32 bytes of `randomBytes` — 256 bits, so guessing is not a strategy and no
 * rate limit is load-bearing. Returned once, in memory, and never persisted:
 * what goes in the row is the hash, so a backup, a replica or a support query
 * yields nothing usable.
 */
export function mintEnrolmentToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashEnrolmentToken(token) };
}

export function hashEnrolmentToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * The rules that outlive consumption: whose token it is, and whether it was in
 * date.
 *
 * Split from `acceptToken` because of the order things happen in. Spending a
 * token is a single atomic statement, and what comes back from it is a row
 * whose `consumed_at` has just been set — by us, a moment ago. Checking "is
 * this unconsumed" against that row refuses every token the instant it is
 * spent, which is what the integration test found.
 *
 * So the caller that consumes checks these two, and the caller that merely
 * holds a token checks all three.
 *
 * The tenant check is the least obvious of them. A token issued for Acme and
 * presented on Globex's hostname is void even though the token is genuine —
 * otherwise a link mailed to somebody at one customer becomes a way to probe
 * another.
 */
export function tokenStillValid(
  token: EnrolmentToken,
  presentedTenantId: string,
  clock: Clock,
): Result<EnrolmentToken> {
  if (token.tenantId !== presentedTenantId) return err(TokenRejected);
  if (clock.now().getTime() >= Date.parse(token.expiresAt)) return err(TokenRejected);

  return ok(token);
}

/**
 * The complete rule, for a token that has not been spent yet.
 *
 * Used by anything that loads a token without consuming it — a preview screen,
 * an admin view, a second adapter. The consumption path uses
 * `tokenStillValid`, because the database has already answered the question
 * this adds.
 */
export function acceptToken(
  token: EnrolmentToken,
  presentedTenantId: string,
  clock: Clock,
): Result<EnrolmentToken> {
  if (token.consumedAt !== null) return err(TokenRejected);
  return tokenStillValid(token, presentedTenantId, clock);
}

/**
 * Compare two hashes without leaking how far they matched.
 *
 * The lookup is by hash and the database does the comparison, so this exists
 * for the paths that compare in application code — a cached token, a test, a
 * future adapter that fetches by account and checks the hash itself. Cheap
 * enough that having it removes the temptation to use `===` there.
 */
export function hashesMatch(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
