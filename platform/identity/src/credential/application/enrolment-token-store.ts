import type { EnrolmentState } from '../domain/enrolment-state.js';
import type { EnrolmentToken, SecondChannel } from '../domain/enrolment-token.js';

export interface IssueRequest {
  readonly accountId: string;
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
  inspect(token: string): Promise<EnrolmentState>;
}
