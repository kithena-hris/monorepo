import type { EnrolmentToken, SecondChannel } from '../domain/enrolment-token.js';

export interface IssueRequest {
  readonly accountId: string;
  readonly secondChannel: SecondChannel;
  /** The HR admin who authorised it. Null when the platform provisions a tenant. */
  readonly issuedBy: string | null;
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
  issue(request: IssueRequest): Promise<string>;

  /**
   * Spend a token, atomically.
   *
   * Returns null for a token that does not exist, has been used, or has
   * expired — indistinguishably, because the caller is unauthenticated and the
   * difference between "used" and "never existed" tells them something.
   */
  consume(token: string): Promise<EnrolmentToken | null>;
}
