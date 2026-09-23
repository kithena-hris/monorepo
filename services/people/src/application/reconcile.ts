import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Actor } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import type { InTenantTransaction } from '../infrastructure/unit-of-work.js';

/**
 * §8.2, "People is bought later": a provisional person for every account the
 * tenant already has.
 *
 * The tenant has been running on identity alone, so every account exists and
 * no person does, and the `identity.account.provisioned` events that would
 * have created them went past before anybody was listening. This asks identity
 * for the accounts directly and provisions each one through the same path the
 * consumer uses.
 *
 * Re-running it is a no-op, and not because it looks first: the unique index
 * on `(tenant_id, identity_account_id)` refuses the second insert, and the
 * provisioner raises no event for a row it did not write.
 */

export interface IdentityAccount {
  readonly accountId: string;
  readonly workEmail: string;
  readonly timeZone: string;
  readonly employmentStart: string;
  /** Present once the person has enrolled and identity captured it. */
  readonly name: { given: string; family: string; preferred: string | null } | null;
}

/** Identity's accounts for one tenant, in whatever pages identity serves them. */
export interface AccountDirectory {
  accounts(tenantId: string): AsyncIterable<IdentityAccount>;
}

export interface ProvisionContext {
  readonly actor: Actor;
  readonly correlationId: string;
  readonly causationId: string | null;
}

/** Creates the provisional record, or does nothing when one exists. True when it wrote. */
export interface ProvisionalPeople {
  provision(
    tx: PostgresJsDatabase,
    tenantId: string,
    account: IdentityAccount,
    ctx: ProvisionContext,
  ): Promise<boolean>;
}

export interface ReconcileDeps {
  readonly directory: AccountDirectory;
  readonly people: ProvisionalPeople;
  readonly inTenant: InTenantTransaction;
}

export function reconcile(deps: ReconcileDeps) {
  return async (
    tenantId: string,
    ctx: ProvisionContext,
  ): Promise<Result<{ seen: number; created: number }>> => {
    let seen = 0;
    let created = 0;

    /*
     * One short transaction per account rather than one around the whole
     * walk: the directory is an HTTP call, and a transaction held open across
     * the network is a set of row locks held for as long as identity takes.
     */
    const accounts = deps.directory.accounts(tenantId)[Symbol.asyncIterator]();
    for (;;) {
      let next: IteratorResult<IdentityAccount>;
      try {
        next = await accounts.next();
      } catch (cause) {
        // Identity unreachable or answering nonsense. What was provisioned
        // stays provisioned, and running it again picks up the rest.
        return err(
          failure(
            'DIRECTORY_UNAVAILABLE',
            `Identity's accounts could not be read: ${String(cause)}`,
          ),
        );
      }
      if (next.done === true) break;

      const account = next.value;
      seen += 1;
      const wrote = await deps.inTenant(tenantId, ({ tx }) =>
        deps.people.provision(tx, tenantId, account, ctx),
      );
      if (wrote) created += 1;
    }

    return ok({ seen, created });
  };
}
