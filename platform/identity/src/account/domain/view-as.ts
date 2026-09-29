import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Viewing as an employee: a People administrator sees the app exactly as one
 * employee does, read-only, from inside the company
 * (`docs/auth-administration.md`, "Viewing as an employee").
 *
 * Not support. Support is Kithena, from the back office, a full administrator
 * of the company. This is somebody at the company, as one named employee,
 * unable to change anything. People decides who may start one — it holds the
 * roles — and these are the rules identity keeps whatever People says: the
 * database repeats the limit and the reason as CHECK constraints.
 */

/** Thirty minutes, absolute. Never extended: nothing moves `expires_at` after it is written. */
export const VIEW_AS_SECONDS = 30 * 60;

/** What a view-as session claims in `amr`. */
export const VIEW_AS_AMR = 'view_as';

const REASON_MAX = 500;

export function viewAsReason(raw: unknown): Result<string> {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason === '') {
    return err(failure('VIEW_AS_REASON_REQUIRED', 'Say why you are viewing as them', ['reason']));
  }
  if (reason.length > REASON_MAX) {
    return err(
      failure(
        'VIEW_AS_REASON_TOO_LONG',
        `Keep the reason under ${String(REASON_MAX)} characters`,
        ['reason'],
      ),
    );
  }
  return ok(reason);
}

export function viewAsWindow(now: Date): { startedAt: string; expiresAt: string } {
  return {
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + VIEW_AS_SECONDS * 1000).toISOString(),
  };
}

/** An account as these rules need it. */
export interface ViewAsParty {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
}

/**
 * Whether `admin` may view as `subject`, as far as identity can tell.
 *
 * `adminBeingViewed` is whether a view-as session is live on the admin's own
 * account. An administrator is never viewed (People refuses it), so that can
 * only mean the request comes from inside somebody's view of this account: a
 * view-as session trying to start another.
 */
export function viewAsRefusal(input: {
  readonly admin: ViewAsParty | null;
  readonly subject: ViewAsParty | null;
  readonly adminBeingViewed: boolean;
}): Result<void> {
  const { admin, subject } = input;
  if (admin?.kind === 'support' || subject?.kind === 'support') {
    return err(failure('VIEW_AS_SUPPORT', 'Kithena support is never viewed as, and never views as'));
  }
  if (admin?.status !== 'active' || subject?.status !== 'active') {
    return err(failure('VIEW_AS_UNKNOWN_ACCOUNT', 'No such active person at this company'));
  }
  if (admin.id === subject.id) return err(failure('VIEW_AS_SELF', 'You cannot view as yourself'));
  if (input.adminBeingViewed) {
    return err(failure('VIEW_AS_NESTED', 'You cannot start viewing as somebody while viewing'));
  }
  return ok(undefined);
}

/** How a view-as session that is ending now ended. */
export function endedBy(now: Date, expiresAt: string): 'admin' | 'time_limit' {
  return now.getTime() >= Date.parse(expiresAt) ? 'time_limit' : 'admin';
}
