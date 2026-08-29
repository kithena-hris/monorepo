import type { Clock } from '@kithena/domain-kit';
import { err, ok, type Result } from '@kithena/domain-kit';

import {
  HandoffRefused,
  checkRedeemable,
  hashCode,
  issuedCode,
  type StoredCode,
} from '../domain/handoff.js';

export interface HandoffStore {
  readonly put: (row: {
    tenantId: string;
    sessionId: string;
    codeHash: Buffer;
    expiresAt: Date;
  }) => Promise<void>;
  /**
   * Marks the code spent and returns what it held, or null.
   *
   * One statement, and the reason is the same as the enrolment token's: a
   * `SELECT` followed by an `UPDATE` leaves a window in which two requests
   * presenting the same code both pass. The conditional update only matches
   * while `redeemed_at` is NULL, so exactly one of them wins.
   *
   * Note that this spends the code *before* the domain has judged it. That is
   * deliberate for expiry: a stale code is burnt on presentation rather than
   * left for somebody to keep retrying.
   *
   * It does **not** burn a code presented by the wrong company, and that falls
   * out of the row-level security below rather than from a decision here — the
   * statement cannot see the row, so it changes nothing. Which is the outcome
   * worth having: somebody probing another tenant's code cannot deny its owner
   * the sign-in it was issued for.
   *
   * `tenantId` is the company doing the redeeming, and it is not a filter this
   * layer applies for convenience: `platform.handoff_code` carries row-level
   * security with FORCE, so the statement must run inside that tenant to see
   * anything at all. A code belonging to another company is therefore invisible
   * rather than merely rejected — the database enforces the boundary and
   * `checkRedeemable` states it, which is the order those two belong in.
   */
  readonly spend: (codeHash: Buffer, tenantId: string) => Promise<StoredCode | null>;
}

export type IssueHandoff = (input: {
  tenantId: string;
  sessionId: string;
}) => Promise<Result<{ code: string }>>;

export type RedeemHandoff = (input: {
  code: string;
  tenantId: string;
}) => Promise<Result<{ sessionId: string }>>;

/**
 * Minting the code the auth origin puts in its redirect.
 *
 * The session already exists and is already valid by the time this runs — this
 * hands over a reference to it and authorises nothing on its own.
 */
export function issueHandoff({
  store,
  clock,
}: {
  store: HandoffStore;
  clock: Clock;
}): IssueHandoff {
  return async ({ tenantId, sessionId }) => {
    const issued = issuedCode(clock.now());
    try {
      await store.put({
        tenantId,
        sessionId,
        codeHash: issued.codeHash,
        expiresAt: issued.expiresAt,
      });
    } catch {
      /*
       * A refusal, not a 500.
       *
       * `session_id` is a foreign key, so a session that has been revoked
       * between signing in and asking for a code lands here — a real race, not
       * a bug, and the honest answer to it is "sign in again" rather than a
       * stack trace. Anything genuinely broken about the database shows up on
       * every other query too; swallowing it here costs one confusing symptom
       * and saves handing a 500 to a person who did nothing wrong.
       */
      return err(HandoffRefused);
    }
    return ok({ code: issued.code });
  };
}

/**
 * Exchanging the code for the session it stands for.
 *
 * The tenant is supplied by the app doing the redeeming, which reads it from
 * its own hostname — never from the code and never from anything a browser
 * sent. That is what stops a code issued for one company being spent at
 * another's origin.
 */
export function redeemHandoff({
  store,
  clock,
}: {
  store: HandoffStore;
  clock: Clock;
}): RedeemHandoff {
  return async ({ code, tenantId }) => {
    // A code that is not even the right shape never reaches the database.
    if (code === '' || code.length > 128) return err(HandoffRefused);

    const stored = await store.spend(hashCode(code), tenantId);
    if (stored === null) return err(HandoffRefused);

    return checkRedeemable(stored, tenantId, clock.now());
  };
}
