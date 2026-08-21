import type { ChallengeStore, IssuedChallenge } from '../application/challenge-store.js';

/**
 * Challenges in Valkey, spent atomically.
 *
 * `GETDEL` rather than `GET` then `DEL`. The two-command version has a window
 * between them, and two requests carrying the same captured assertion can both
 * read the challenge before either deletes it — which is precisely the replay
 * the challenge exists to prevent. One round trip, one winner.
 */
const KEY = (challenge: string): string => `webauthn:challenge:${challenge}`;

export interface ChallengeClient {
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
}

export function valkeyChallengeStore(client: ChallengeClient): ChallengeStore {
  return {
    async issue(challenge, details, ttlSeconds) {
      await client.set(KEY(challenge), JSON.stringify(details), 'EX', Math.max(ttlSeconds, 1));
    },

    async consume(challenge) {
      const raw = await client.getdel(KEY(challenge));
      if (raw === null) return null;

      try {
        return JSON.parse(raw) as IssuedChallenge;
      } catch {
        // Already destroyed by the read above, so an unparseable value is a
        // spent challenge either way. Refusing is the only safe answer.
        return null;
      }
    },
  };
}
