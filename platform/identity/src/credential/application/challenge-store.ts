/**
 * Challenges, issued once and spent once.
 *
 * A WebAuthn challenge is the only thing standing between an assertion and a
 * replay of it. If a challenge can be read twice, an assertion captured once
 * can be presented again, and the signature will verify perfectly both times.
 *
 * So `consume` must be atomic: read and destroy in one operation, not read then
 * delete. Two requests arriving together with the same captured assertion must
 * see exactly one success between them.
 *
 * Keyed by the challenge itself rather than by a session or a cookie. The
 * challenge is random and server-issued, so a client cannot invent one, and
 * keying by it means a discoverable-credential sign-in — where nobody has said
 * who they are yet — needs no state on the browser at all.
 */
export type ChallengePurpose = 'registration' | 'authentication';

export interface IssuedChallenge {
  readonly purpose: ChallengePurpose;
  /** The identity a registration is for. Null when nobody has identified yet. */
  readonly subject: string | null;
}

export interface ChallengeStore {
  issue(challenge: string, details: IssuedChallenge, ttlSeconds: number): Promise<void>;
  /** Atomic read-and-destroy. Returns null if it was never issued, or already spent. */
  consume(challenge: string): Promise<IssuedChallenge | null>;
}
