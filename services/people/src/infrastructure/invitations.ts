import { sql } from 'drizzle-orm';
import { err, failure, ok } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import type {
  IdentityInviter,
  InvitationRow,
  InvitationStore,
} from '../application/person/invitations.js';

/** `people.account_invitation`, and the person a work email names. */
export function drizzleInvitationStore(): InvitationStore {
  const day = (v: unknown): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return {
    async get(tx, tenantId, personId) {
      const [row] = await tx.execute(sql`
        SELECT person_id, send_on, sent_at, account_id FROM people.account_invitation
         WHERE tenant_id = ${tenantId}::uuid AND person_id = ${personId}::uuid
      `);
      if (row === undefined) return null;
      const sent = row['sent_at'];
      return {
        personId: String(row['person_id']),
        sendOn: day(row['send_on']),
        sentAt: sent instanceof Date ? sent.toISOString() : typeof sent === 'string' ? sent : null,
        accountId: typeof row['account_id'] === 'string' ? row['account_id'] : null,
      } satisfies InvitationRow;
    },
    async save(tx, tenantId, row, by) {
      await tx.execute(sql`
        INSERT INTO people.account_invitation (tenant_id, person_id, send_on, sent_at, account_id, invited_by)
        VALUES (${tenantId}::uuid, ${row.personId}::uuid, ${row.sendOn}::date,
                ${row.sentAt}::timestamptz, ${row.accountId}::uuid, ${by}::uuid)
        ON CONFLICT (tenant_id, person_id) DO UPDATE
           SET send_on = EXCLUDED.send_on, sent_at = EXCLUDED.sent_at,
               account_id = COALESCE(EXCLUDED.account_id, people.account_invitation.account_id),
               invited_by = COALESCE(EXCLUDED.invited_by, people.account_invitation.invited_by),
               updated_at = now()
      `);
    },
    async byEmail(tx, tenantId, email) {
      const [row] = await tx.execute(sql`
        SELECT id FROM people.person
         WHERE tenant_id = ${tenantId}::uuid AND lower(work_email) = lower(${email})
           AND status NOT IN ('discarded', 'merged')
         ORDER BY (status IN ('pre_hire', 'onboarding')) DESC, hire_date DESC NULLS LAST
         LIMIT 1
      `);
      return row === undefined ? null : String(row['id']);
    },
    async due(tx, tenantId, onOrBefore, limit) {
      const rows = await tx.execute(sql`
        SELECT person_id FROM people.account_invitation
         WHERE tenant_id = ${tenantId}::uuid AND sent_at IS NULL AND send_on <= ${onOrBefore}::date
         ORDER BY send_on LIMIT ${limit}
      `);
      return [...rows].map((r) => String(r['person_id']));
    },
  };
}

/**
 * Identity's `POST /api/internal/tenants/<id>/invitations`, with People's own
 * token (`PEOPLE_IDENTITY_TOKEN`, else `INTERNAL_API_TOKEN`), as the sign-up
 * question report goes. Null without an identity to call.
 */
export function identityInviterFrom(env: NodeJS.ProcessEnv): IdentityInviter | undefined {
  const baseUrl = env['IDENTITY_URL'];
  const token = env['PEOPLE_IDENTITY_TOKEN'] ?? env['INTERNAL_API_TOKEN'];
  if (!baseUrl || !token) return undefined;
  return {
    async invite(tenantId, input) {
      try {
        const response = await fetch(
          new URL(`/api/internal/tenants/${tenantId}/invitations`, baseUrl),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-internal-token': token },
            body: JSON.stringify(input),
            signal: AbortSignal.timeout(15_000),
          },
        );
        const body = (await response.json().catch(() => null)) as {
          accountId?: string;
          expiresAt?: string;
          code?: string;
          message?: string;
        } | null;
        if (response.ok && typeof body?.accountId === 'string')
          return ok({ accountId: body.accountId, expiresAt: body.expiresAt ?? '' });
        return err(
          failure(
            body?.code ?? 'UNAVAILABLE',
            body?.message ?? 'Identity did not send the invitation',
          ),
        );
      } catch (error) {
        logger.warn({ tenantId, err: error }, 'invitation not sent');
        return err(failure('UNAVAILABLE', 'Identity could not be reached; try again in a moment'));
      }
    },
  };
}
