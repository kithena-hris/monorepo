import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Support access: an operator in the back office signs in to a company as its
 * support agent (`docs/auth-administration.md`, "Support access").
 *
 * The rules that are rules rather than queries live here: how long the session
 * lasts, what a reason must be, and what the support account is called. The
 * database repeats the first two as CHECK constraints, so a writer that forgot
 * this file still cannot store a longer session or an empty reason.
 */

/** One hour, absolute. Never extended: nothing moves `expires_at` after it is written. */
export const SUPPORT_SESSION_SECONDS = 60 * 60;

/** Room for a ticket number and a sentence; not for a pasted conversation. */
export const SUPPORT_REASON_MAX = 500;

/** The method a support session claims in `amr`, where a passkey claims `hwk`/`swk`. */
export const SUPPORT_AMR = 'support';

export function supportReason(raw: unknown): Result<string> {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason === '') {
    return err(
      failure('SUPPORT_REASON_REQUIRED', 'Say why: a ticket number or a sentence', ['reason']),
    );
  }
  if (reason.length > SUPPORT_REASON_MAX) {
    return err(
      failure(
        'SUPPORT_REASON_TOO_LONG',
        `Keep the reason under ${String(SUPPORT_REASON_MAX)} characters`,
        ['reason'],
      ),
    );
  }
  return ok(reason);
}

export function supportSessionWindow(now: Date): { startedAt: string; expiresAt: string } {
  return {
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SUPPORT_SESSION_SECONDS * 1000).toISOString(),
  };
}

/**
 * The one support account a company has.
 *
 * Not an employee, so it has no real address: `.invalid` is reserved by
 * RFC 2606 and nothing can deliver to it, which means no invitation or
 * recovery link addressed to it can ever be used.
 */
export function supportAccountProfile(tenantSlug: string): {
  workEmail: string;
  givenName: string;
  familyName: string;
} {
  return {
    workEmail: `support@${tenantSlug}.support.kithena.invalid`,
    givenName: 'Kithena',
    familyName: 'support',
  };
}
