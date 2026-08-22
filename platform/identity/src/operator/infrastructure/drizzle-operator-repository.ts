import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import type { Operator, OperatorSession, OperatorStatus } from '../domain/operator.js';
import { operator, operatorSession } from './operator-tables.js';

/**
 * Operators, and the sessions they hold.
 *
 * No tenant scope anywhere, because there is none — an operator belongs to no
 * customer. That is the whole point of the back-office and also what makes it
 * the most dangerous surface in the product, so what constrains this is the
 * credential required to reach it rather than a policy the database enforces.
 */
export interface OperatorRepository {
  byIdentity(identityId: string): Promise<Operator | null>;
  startSession(input: {
    id: string;
    operatorId: string;
    expiresAt: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<void>;
  sessionById(sessionId: string): Promise<(OperatorSession & { email: string }) | null>;
  touchSession(sessionId: string): Promise<void>;
  revokeSession(sessionId: string): Promise<void>;
  /** Marks an invited operator active once they have enrolled a credential. */
  markEnrolled(identityId: string): Promise<void>;
}

export function drizzleOperatorRepository(db: PostgresJsDatabase): OperatorRepository {
  return {
    async byIdentity(identityId) {
      const rows = await db
        .select()
        .from(operator)
        .where(eq(operator.identityId, identityId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;

      return {
        id: row.id,
        identityId: row.identityId,
        email: row.email,
        status: row.status as OperatorStatus,
      };
    },

    async startSession(input) {
      await db.insert(operatorSession).values({
        id: input.id,
        operatorId: input.operatorId,
        startedAt: sql`now()`,
        lastSeenAt: sql`now()`,
        expiresAt: input.expiresAt,
        ip: input.ip,
        userAgent: input.userAgent,
      });
    },

    async sessionById(sessionId) {
      const rows = await db
        .select({
          id: operatorSession.id,
          operatorId: operatorSession.operatorId,
          startedAt: operatorSession.startedAt,
          lastSeenAt: operatorSession.lastSeenAt,
          expiresAt: operatorSession.expiresAt,
          revokedAt: operatorSession.revokedAt,
          email: operator.email,
          status: operator.status,
        })
        .from(operatorSession)
        .innerJoin(operator, eq(operator.id, operatorSession.operatorId))
        .where(and(eq(operatorSession.id, sessionId), eq(operator.status, 'active')))
        .limit(1);

      const row = rows[0];
      return row ?? null;
    },

    async touchSession(sessionId) {
      // Lazily, and only the idle clock. `expires_at` is deliberately not moved:
      // a session that renews itself on use is not a session, it is a
      // credential with no end.
      await db
        .update(operatorSession)
        .set({ lastSeenAt: sql`now()` })
        .where(eq(operatorSession.id, sessionId));
    },

    async revokeSession(sessionId) {
      await db
        .update(operatorSession)
        .set({ revokedAt: sql`now()` })
        .where(eq(operatorSession.id, sessionId));
    },

    async markEnrolled(identityId) {
      await db
        .update(operator)
        .set({ status: 'active' })
        .where(and(eq(operator.identityId, identityId), eq(operator.status, 'invited')));
    },
  };
}
