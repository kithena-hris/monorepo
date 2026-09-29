import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type { ViewAsIdentity } from '../application/person/view-as.js';

/**
 * Viewing as an employee: who a person signs in as, and identity's half
 * (`POST /api/internal/view-as/start`, People's own token).
 */

export async function drizzleAccountOf(
  tx: PostgresJsDatabase,
  tenantId: string,
  personId: string,
): Promise<{ accountId: string | null; active: boolean } | null> {
  const [row] = [
    ...(await tx.execute<{ account: string | null; active: boolean }>(sql`
      SELECT identity_account_id AS account,
             (access_ended_at IS NULL
               AND status NOT IN ('terminated', 'discarded', 'merged')) AS active
        FROM people.person
       WHERE tenant_id = ${tenantId}::uuid AND id = ${personId}::uuid
    `)),
  ];
  return row ? { accountId: row.account, active: row.active } : null;
}

/** From `IDENTITY_URL` and `PEOPLE_IDENTITY_TOKEN` (else `INTERNAL_API_TOKEN`); absent without both. */
export function viewAsIdentityFrom(env: NodeJS.ProcessEnv): ViewAsIdentity | undefined {
  const baseUrl = env['IDENTITY_URL'];
  const token = env['PEOPLE_IDENTITY_TOKEN'] ?? env['INTERNAL_API_TOKEN'];
  if (!baseUrl || !token) return undefined;
  return {
    async start(input) {
      try {
        const response = await fetch(new URL('/api/internal/view-as/start', baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-token': token },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(10_000),
        });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (response.status === 201 && typeof body['code'] === 'string') {
          return ok({ code: body['code'], expiresAt: String(body['expiresAt']) });
        }
        // Identity's own refusal — it keeps its rules whatever People decided.
        if (typeof body['code'] === 'string' && typeof body['message'] === 'string') {
          return err(failure(body['code'], body['message']));
        }
        logger.warn({ status: response.status }, 'identity did not start viewing as');
      } catch (error) {
        logger.warn({ err: error }, 'identity could not be asked to start viewing as');
      }
      return err(failure('UNAVAILABLE', 'Viewing as somebody is unavailable right now'));
    },
  };
}

/**
 * `identity.view_as.started` and `.ended`, into `people.view_as_notice`:
 * what tells the employee afterwards. Either may arrive first, and either
 * twice; the row ends up the same.
 */
export async function recordViewAs(
  tx: PostgresJsDatabase,
  tenantId: string,
  seen: {
    readonly sessionId: string;
    readonly subjectAccountId: string;
    readonly adminAccountId: string;
    readonly specialCategory: boolean;
    readonly startedAt: string;
    readonly expiresAt: string;
    readonly endedAt: string | null;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO people.view_as_notice
      (tenant_id, session_id, subject_account_id, admin_account_id, special_category,
       started_at, expires_at, ended_at)
    VALUES (${tenantId}::uuid, ${seen.sessionId}::uuid, ${seen.subjectAccountId}::uuid,
            ${seen.adminAccountId}::uuid, ${seen.specialCategory},
            ${seen.startedAt}::timestamptz, ${seen.expiresAt}::timestamptz,
            ${seen.endedAt}::timestamptz)
    ON CONFLICT (tenant_id, session_id) DO UPDATE
       SET ended_at = coalesce(people.view_as_notice.ended_at, EXCLUDED.ended_at)
  `);
}

/** Views of this account that are over, newest first: its notices. */
export async function drizzleViewedAs(
  tx: PostgresJsDatabase,
  tenantId: string,
  accountId: string,
  now: string,
): Promise<
  { id: string; by: string | null; at: string; endedAt: string; specialCategory: boolean }[]
> {
  const rows = await tx.execute<{
    id: string;
    by: string | null;
    at: Date | string;
    ended_at: Date | string;
    special_category: boolean;
  }>(sql`
    SELECT n.session_id AS id,
           nullif(concat_ws(' ', coalesce(p.preferred_name, p.given_name), p.family_name), '') AS by,
           n.started_at AS at,
           coalesce(n.ended_at, n.expires_at) AS ended_at,
           n.special_category
      FROM people.view_as_notice n
      LEFT JOIN people.person p
        ON p.tenant_id = n.tenant_id AND p.identity_account_id = n.admin_account_id
       AND p.status NOT IN ('merged', 'discarded')
     WHERE n.tenant_id = ${tenantId}::uuid AND n.subject_account_id = ${accountId}::uuid
       AND coalesce(n.ended_at, n.expires_at) <= ${now}::timestamptz
     ORDER BY n.started_at DESC
     LIMIT 20
  `);
  const iso = (v: Date | string) => new Date(v).toISOString();
  return [...rows].map((r) => ({
    id: r.id,
    by: r.by,
    at: iso(r.at),
    endedAt: iso(r.ended_at),
    specialCategory: r.special_category,
  }));
}
