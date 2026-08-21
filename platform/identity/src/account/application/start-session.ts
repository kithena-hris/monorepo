import { err, failure, type Result } from '@kithena/domain-kit';

import { Account, type EventContext, type StartSessionInput } from '../domain/account.js';
import type { SlotAllocation } from '../domain/session.js';
import type { AccountRepository } from './account-repository.js';

/**
 * Sign a device in.
 *
 * The interesting part is the retry, and why it is here rather than hidden in
 * the repository.
 *
 * Allocating a slot is read-then-write: the domain looks at the sessions it
 * loaded and picks one. Two logins a millisecond apart both read the same three
 * sessions, both pick slot four, and both try to insert it. `UNIQUE
 * (account_id, slot)` means exactly one wins — which is the entire point of the
 * index — and the loser has not failed, it has merely read stale state. So it
 * reloads and tries again, and the second attempt sees four sessions and either
 * finds a different slot or evicts one.
 *
 * Retrying is only correct because the whole operation is inside one
 * transaction and the domain is pure: replaying it has no effect beyond the
 * transaction that was rolled back.
 */

/** Postgres `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

export interface StartSessionDeps {
  readonly accounts: AccountRepository;
  /** Runs the callback in a transaction scoped to the tenant, for RLS. */
  readonly inTenantTransaction: <T>(
    tenantId: string,
    fn: (tx: Parameters<AccountRepository['load']>[0]) => Promise<T>,
  ) => Promise<T>;
  /**
   * How many times to reload and retry after losing a slot race.
   *
   * Bounded, and small. Each attempt is a fresh read, so a caller genuinely
   * contending with several simultaneous logins converges quickly; a caller
   * that does not converge in a handful of attempts is contending with
   * something this loop cannot fix, and spinning would turn a slow login into
   * a held connection.
   */
  readonly maxAttempts?: number;
}

export type StartSession = (
  tenantId: string,
  accountId: string,
  input: StartSessionInput,
  ctx: EventContext,
) => Promise<Result<SlotAllocation>>;

export function startSession({
  accounts,
  inTenantTransaction,
  maxAttempts = 4,
}: StartSessionDeps): StartSession {
  return async (tenantId, accountId, input, ctx) => {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await inTenantTransaction(tenantId, async (tx) => {
          const snapshot = await accounts.load(tx, accountId);
          // Not "not found" in the ordinary sense: RLS means an account
          // belonging to another tenant is indistinguishable from one that does
          // not exist, and that is the correct thing for a caller to be told.
          if (!snapshot) return err(failure('NOT_FOUND', 'Account not found'));

          const account = Account.rehydrate(snapshot);
          const started = account.startSession(input, ctx);
          if (!started.ok) return started;

          await accounts.save(tx, account);
          return started;
        });
      } catch (error: unknown) {
        if (!isUniqueViolation(error) || attempt === maxAttempts) throw error;
        // Lost the race for a slot. Fall through and read the world again.
      }
    }

    // Unreachable: the loop either returns or throws. Present so the function
    // has a total signature rather than an implicit undefined.
    return err(failure('SLOT_CONTENTION', 'Could not allocate a session slot'));
  };
}

/**
 * Whether this is the slot race, looking through whatever wrapped it.
 *
 * Drizzle raises its own `Failed query` error and hangs the driver's error off
 * `cause`, so the obvious `error.code === '23505'` matches nothing — the retry
 * never fires, every loser gives up on its first attempt, and an account that
 * should end with four sessions ends with one. The integration test found this;
 * a unit test with a fake repository could not have, because the fake would
 * have thrown the unwrapped error this check originally expected.
 */
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current !== null && depth < 5; depth += 1) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
