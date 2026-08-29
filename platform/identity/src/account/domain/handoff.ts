import { createHash, randomBytes } from 'node:crypto';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * The one-time code that carries a session from the auth origin to the tenant
 * origin.
 *
 * It exists because two hostnames are involved and a `__Host-` cookie can only
 * be set by the one it belongs to — `docs/authentication.md` and the migration
 * have the full reasoning. What lives here is the part that is a rule rather
 * than a query: how long a code is good for, what makes one redeemable, and the
 * fact that every refusal looks the same.
 */

/**
 * Sixty seconds.
 *
 * This is a redirect the browser follows immediately, not a link anybody keeps.
 * The window has to cover a slow device on a slow network and nothing else — a
 * code that outlives the navigation is a code sitting in browser history, in
 * the referrer of anything the landing page loads, and in every proxy log on
 * the way.
 */
export const HANDOFF_TTL_SECONDS = 60;

export interface IssuedCode {
  /** Returned once, put in the redirect, never stored. */
  readonly code: string;
  /** What is stored. */
  readonly codeHash: Buffer;
  readonly expiresAt: Date;
}

/**
 * SHA-256, not a password hash.
 *
 * The input is 256 bits of `randomBytes`, so there is no dictionary to slow an
 * attacker down and a work factor would only add latency to every redemption.
 * The property being bought is that a backup or a support query yields nothing
 * redeemable, and a plain digest buys exactly that.
 */
export function hashCode(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

export function issuedCode(now: Date): IssuedCode {
  // base64url: it goes in a query string, and the alternative is spending the
  // entropy on percent-encoding.
  const code = randomBytes(32).toString('base64url');
  return {
    code,
    codeHash: hashCode(code),
    expiresAt: new Date(now.getTime() + HANDOFF_TTL_SECONDS * 1000),
  };
}

export interface StoredCode {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly expiresAt: Date;
  readonly redeemedAt: Date | null;
}

/**
 * One refusal for every reason.
 *
 * Expired, already spent, and issued for a different company are the same
 * answer to whoever asked. Telling them apart would say which codes ever
 * existed and which companies they belonged to, and none of that is the
 * caller's to learn. The distinguishing detail goes to the log.
 */
export const HandoffRefused = failure('HANDOFF_REFUSED', 'That sign-in could not be completed');

/**
 * Whether this code may be exchanged for its session.
 *
 * The tenant is passed in by the app redeeming, which takes it from its own
 * hostname — so a code issued for Acme and presented at another company's
 * origin is refused *here*, before a session crosses a boundary, rather than
 * being handed over and left for row-level security to catch afterwards.
 */
export function checkRedeemable(
  stored: StoredCode,
  redeemingTenantId: string,
  now: Date,
): Result<{ sessionId: string }> {
  if (stored.redeemedAt !== null) return err(HandoffRefused);
  // `<=`: a code good *until* an instant is not good at it.
  if (stored.expiresAt.getTime() <= now.getTime()) return err(HandoffRefused);
  if (stored.tenantId !== redeemingTenantId) return err(HandoffRefused);

  return ok({ sessionId: stored.sessionId });
}
