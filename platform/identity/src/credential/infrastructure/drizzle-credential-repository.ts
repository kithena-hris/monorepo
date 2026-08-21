import { and, eq, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { Credential, CredentialKind } from '../domain/credential.js';
import { credential } from './credential-tables.js';

/**
 * Reading and updating credentials.
 *
 * Deliberately not tenant-scoped, because the table is not. That is safe only
 * so long as nothing tenant-facing reaches this: a verified passkey identifies
 * a *human*, and turning that into "may this person act at Acme" is the
 * account lookup's job, under row-level security, on the other side of this
 * file.
 */
export interface CredentialRepository {
  byExternalId(externalId: string): Promise<Credential | null>;
  publicKeyOf(
    credentialId: string,
  ): Promise<{ publicKey: Uint8Array<ArrayBuffer>; signCount: number } | null>;
  recordUse(credentialId: string, state: { signCount: number; backedUp: boolean }): Promise<void>;
}

export function drizzleCredentialRepository(db: PostgresJsDatabase): CredentialRepository {
  return {
    async byExternalId(externalId) {
      const rows = await db
        .select()
        .from(credential)
        // Revoked rows are excluded here as well as refused by the domain.
        // Belt and braces on purpose: this is the query an unauthenticated
        // caller reaches, and a revoked credential that never loads cannot be
        // mishandled by a caller that forgot to check.
        .where(and(eq(credential.externalId, externalId), isNull(credential.revokedAt)))
        .limit(1);

      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        identityId: row.identityId,
        kind: row.kind as CredentialKind,
        externalId: row.externalId,
        provider: row.provider,
        signCount: row.signCount,
        backedUp: row.backedUp,
        revokedAt: row.revokedAt,
      };
    },

    async publicKeyOf(credentialId) {
      const rows = await db
        .select({ publicKey: credential.publicKey, signCount: credential.signCount })
        .from(credential)
        .where(eq(credential.id, credentialId))
        .limit(1);

      const row = rows[0];
      // A passkey with no public key is a row written by the federated or
      // password path. Returning null refuses it rather than handing the
      // verifier an empty key to fail on obscurely.
      if (!row?.publicKey) return null;

      return { publicKey: row.publicKey, signCount: row.signCount };
    },

    async recordUse(credentialId, state) {
      await db
        .update(credential)
        .set({ signCount: state.signCount, backedUp: state.backedUp, lastUsedAt: sql`now()` })
        .where(eq(credential.id, credentialId));
    },
  };
}
