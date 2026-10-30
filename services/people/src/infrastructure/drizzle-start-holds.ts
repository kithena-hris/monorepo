import { sql } from 'drizzle-orm';

import type { StartHolds } from '../application/person/start-holds.js';

/** `people.start_hold`: a hire's start, held while a pre-start condition is open. */
export function drizzleStartHolds(): StartHolds {
  const day = (v: unknown): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return {
    async hold(tx, tenantId, hold) {
      await tx.execute(sql`
        INSERT INTO people.start_hold (tenant_id, application_id, person_id, conditions, offer_id)
        VALUES (${tenantId}::uuid, ${hold.applicationId}::uuid, ${hold.personId}::uuid,
                ${[...hold.conditions]}::text[], ${hold.offerId}::uuid)
        ON CONFLICT (tenant_id, application_id) DO UPDATE
           SET conditions = EXCLUDED.conditions, person_id = EXCLUDED.person_id,
               offer_id = EXCLUDED.offer_id
      `);
    },
    async release(tx, tenantId, applicationId) {
      const gone = await tx.execute(sql`
        DELETE FROM people.start_hold
         WHERE tenant_id = ${tenantId}::uuid AND application_id = ${applicationId}::uuid
        RETURNING application_id
      `);
      return [...gone].length > 0;
    },
    async due(tx, tenantId, onOrBefore, limit) {
      const rows = await tx.execute(sql`
        SELECT h.application_id, h.person_id, h.conditions, h.offer_id, p.hire_date
          FROM people.start_hold h
          JOIN people.person p ON p.tenant_id = h.tenant_id AND p.id = h.person_id
         WHERE h.tenant_id = ${tenantId}::uuid
           AND p.status IN ('pre_hire', 'onboarding')
           AND p.hire_date <= ${onOrBefore}::date
         ORDER BY p.hire_date, h.person_id
         LIMIT ${limit}
      `);
      return [...rows].map((r) => ({
        applicationId: String(r['application_id']),
        personId: String(r['person_id']),
        conditions: Array.isArray(r['conditions']) ? r['conditions'].map(String) : [],
        offerId: typeof r['offer_id'] === 'string' ? r['offer_id'] : null,
        startsOn: day(r['hire_date']),
      }));
    },
  };
}
