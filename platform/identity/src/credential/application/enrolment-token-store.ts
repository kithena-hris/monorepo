import type { PersonName } from '../../shared/person-name.js';
import type { EnrolmentState } from '../domain/enrolment-state.js';
import type { EnrolmentToken, SecondChannel } from '../domain/enrolment-token.js';

export interface IssueRequest {
  readonly accountId: string;
  /**
   * Why this link exists: the first one, or a replacement.
   *
   * Stored rather than inferred later. The page a link opens has to know
   * whether it is a first enrolment or a recovery, and every way of guessing
   * that from other columns has been wrong — see `enrolmentState`.
   */
  readonly purpose: 'invitation' | 'recovery';
  readonly secondChannel: SecondChannel;
  /** The HR admin who authorised it. Null when the platform provisions a tenant. */
  readonly issuedBy: string | null;
}

/**
 * What issuing produces: the token, once, and when it stops working.
 *
 * The deadline is here rather than recomputed by the caller because the
 * database is what sets it — `now() + interval` runs on the server. A message
 * that states a different expiry from the row is wrong on exactly the detail
 * the person reading it acts on.
 */
export interface IssuedEnrolment {
  /** In memory, once. The row holds only its hash. */
  readonly token: string;
  /** ISO 8601 with an offset. */
  readonly expiresAt: string;
}

export interface EnrolmentTokenStore {
  /**
   * Mint a token, returning it once. The row holds only the hash.
   *
   * Invalidates any live token for the same account. Re-issuing must replace
   * rather than accumulate: a person who asked for three links otherwise has
   * three usable ones, and the two they did not use are two more chances for
   * somebody else.
   */
  issue(request: IssueRequest): Promise<IssuedEnrolment>;

  /**
   * Spend a token, atomically.
   *
   * Returns null for a token that does not exist, has been used, or has
   * expired — indistinguishably, because the caller is unauthenticated and the
   * difference between "used" and "never existed" tells them something.
   */
  consume(token: string): Promise<EnrolmentToken | null>;

  /**
   * What a token is worth, without spending it.
   *
   * Separate from `consume` because it must not have its side effect: the page
   * asks this on load, and a check that burnt the link would make opening the
   * page the thing that invalidates it.
   *
   * Reports the reason rather than a bare null, unlike `consume`. The caller
   * holds a 256-bit token handed over out of band, so it already has the
   * secret — see `EnrolmentState` for why that changes what may be said.
   */
  /**
   * What this link is worth, and why it was issued.
   *
   * Both, because they answer different questions: `state` decides whether to
   * offer the ceremony at all, `purpose` decides what to ask before it. A
   * recovery link belongs to somebody already in the registry, so it skips the
   * onboarding form rather than inviting them to retype a name that is already
   * on their row.
   */
  inspect(token: string): Promise<{
    state: EnrolmentState;
    purpose: string;
    /** What the account is already called, or null if nobody has been asked. */
    name: PersonName | null;
    /**
     * When their employment starts, so the form can show it rather than ask.
     *
     * Read-only on that screen deliberately. `Account.enrol` refuses a passkey
     * before this date — it is what stops a hire entered three weeks early
     * signing in during those three weeks — so a field the person enrolling
     * could edit would be a field that walks past their own start-date check.
     * Seeing it is useful; setting it is HR's.
     */
    employmentStart: string | null;
    /**
     * The zone on the account, which the form offers back for confirmation.
     *
     * `Etc/UTC` for almost everybody, because every invitation path defaults it
     * there when HR types nothing — which is the bug the form is being asked to
     * close. The form prefers what the browser reports when the stored value is
     * that default, and prefers the stored value when HR did set one.
     */
    timeZone: string | null;
  }>;
}
