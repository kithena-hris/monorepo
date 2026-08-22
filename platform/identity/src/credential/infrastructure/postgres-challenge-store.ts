import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type {
  ChallengePurpose,
  ChallengeStore,
  IssuedChallenge,
} from '../application/challenge-store.js';

/**
 * Challenges in Postgres, spent atomically.
 *
 * `DELETE ... RETURNING` is the exact counterpart of Valkey's `GETDEL`, and for
 * the same reason: a `SELECT` then a `DELETE` has a window between them where
 * two requests carrying the same captured assertion both read the challenge
 * before either destroys it. That is precisely the replay a challenge exists to
 * prevent. One statement, one winner — the loser gets zero rows and a refusal.
 *
 * Expiry is a predicate rather than a background job. A row past `expires_at`
 * is invisible to `consume` from the instant it expires, so a sweep that has
 * not run yet cannot make a stale challenge usable — the sweep only reclaims
 * space.
 */
export function postgresChallengeStore(db: PostgresJsDatabase): ChallengeStore {
  return {
    async issue(challenge, details, ttlSeconds) {
      const seconds = Math.max(ttlSeconds, 1);
      await db.execute(sql`
        INSERT INTO platform.webauthn_challenge (challenge, purpose, subject, expires_at)
        VALUES (
          ${challenge},
          ${details.purpose},
          ${details.subject}::uuid,
          now() + make_interval(secs => ${seconds})
        )
        ON CONFLICT (challenge) DO NOTHING
      `);
    },

    async consume(challenge) {
      const rows = await db.execute(sql`
        DELETE FROM platform.webauthn_challenge
         WHERE challenge = ${challenge}
           AND expires_at > now()
        RETURNING purpose, subject
      `);

      const row = [...rows][0];
      if (!row) return null;

      const purpose = row['purpose'];
      if (purpose !== 'registration' && purpose !== 'authentication') {
        // The CHECK constraint makes this unreachable. Refusing rather than
        // casting means a future purpose added to the column and not to the
        // type fails closed instead of being treated as a registration.
        return null;
      }

      const subject = row['subject'];
      return {
        purpose: purpose satisfies ChallengePurpose,
        subject: typeof subject === 'string' ? subject : null,
      } satisfies IssuedChallenge;
    },
  };
}

/**
 * Reclaims space from challenges nobody came back for.
 *
 * Most challenges are consumed within a minute; the ones left behind are the
 * sign-ins somebody abandoned at the Touch ID prompt. Nothing depends on this
 * running — `consume` already refuses an expired row — so it is safe to call on
 * a timer, to skip, and to fail.
 */
export async function sweepExpiredChallenges(db: PostgresJsDatabase): Promise<number> {
  const rows = await db.execute(sql`
    DELETE FROM platform.webauthn_challenge WHERE expires_at <= now() RETURNING 1
  `);
  return [...rows].length;
}
