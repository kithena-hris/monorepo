import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { AccountSnapshot } from '../domain/account.js';

/**
 * Which account a verified human holds at this company.
 *
 * The hinge of the whole sign-in. A passkey proves *who someone is*, globally
 * and across every employer. It says nothing about whether they may act at
 * Acme, and this is where that second question gets asked — under row-level
 * security, scoped to the tenant the hostname resolved to.
 *
 * That separation is what makes commissioning real: a perfectly valid passkey
 * belonging to somebody with no account here finds nothing, and finding nothing
 * is a refusal rather than an invitation to create one.
 */
export interface FindAccountForIdentity {
  (tx: PostgresJsDatabase, tenantId: string, identityId: string): Promise<AccountSnapshot | null>;
}
