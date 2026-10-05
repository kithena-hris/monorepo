import { sql, type SQL } from 'drizzle-orm';

/**
 * Everybody below an account in the reporting line, as the body of a
 * `WITH RECURSIVE`: `me`, the people it signs in as, and `below(id, depth)`,
 * walked down `manager_id` from their own reports (depth 1), bounded at 32 so
 * a cycle somebody typed ends.
 *
 * The walk OpenFGA's `manager_chain` answers from the same rows, written once:
 * `drizzleRelations().reach` reads it for a viewer, and Flagged's query
 * follows it for a decider (`flaggedSql`).
 */
export const reportingLine = (tenantId: string, accountId: string): SQL => sql`
  me AS (
    SELECT id FROM people.person
     WHERE tenant_id = ${tenantId}::uuid AND identity_account_id = ${accountId}::uuid
  ),
  below(id, depth) AS (
    SELECT id, 1 FROM people.person
     WHERE tenant_id = ${tenantId}::uuid AND manager_id IN (SELECT id FROM me)
    UNION
    SELECT p.id, b.depth + 1
      FROM people.person p JOIN below b ON p.manager_id = b.id
     WHERE p.tenant_id = ${tenantId}::uuid AND b.depth < 32
  )`;
