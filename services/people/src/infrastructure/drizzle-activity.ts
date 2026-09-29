import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Instant, SettingsActivityRecorded } from '@kithena/contracts';
import { publish } from '@kithena/db-kit';
import type { PendingEvent } from '@kithena/domain-kit';

import type { ActivityEntry, ActivityStore } from '../application/settings/activity-store.js';
import { outbox } from './tables.js';

/**
 * The Settings activity log, over `people.settings_activity`
 * (`migrations/20260927190000_people_settings_activity.sql`): appended here,
 * and read in the central activity log (`docs/audit.md`), which each entry's
 * event feeds.
 */
export function drizzleActivity(): ActivityStore {
  return {
    async record(tx, tenantId, e) {
      const rows = await tx.execute(sql`
        INSERT INTO people.settings_activity
          (tenant_id, id, at, actor, action, subject, detail, area, idempotency_key,
           on_behalf_of, reason)
        VALUES (${tenantId}::uuid, ${e.id}::uuid, ${e.at}::timestamptz, ${e.actor}::uuid,
                ${e.action}, ${e.subject}, ${e.detail}, ${e.area}, ${e.idempotencyKey},
                ${e.onBehalfOf ?? null}::uuid, ${e.reason ?? null})
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING id`);
      // A retry of the same command is no new entry, and so no new event.
      if ([...rows].length > 0) await publish(tx, outbox, [activityRecorded(tenantId, e)]);
    },

  };
}

/* --------------------------------------------- the central activity log -- */

/**
 * The entry, as `people.settings.activity_recorded` for the central activity
 * log (`docs/audit.md`), in the transaction that appended it. The event's id
 * is the entry's, so the entry and its event are one fact, and the backfill
 * of older entries (`20260929160100_people_settings_activity_event.sql`)
 * follows the same rule.
 */
function activityRecorded(tenantId: string, e: ActivityEntry): PendingEvent {
  return {
    eventId: e.id,
    eventName: SettingsActivityRecorded.name,
    eventVersion: SettingsActivityRecorded.version,
    tenantId: tenantId as PendingEvent['tenantId'],
    occurredAt: Instant.parse(new Date(e.at).toISOString()),
    effectiveFrom: null,
    aggregate: { type: 'SettingsActivity', id: e.id, version: 1 },
    actor:
      e.onBehalfOf == null
        ? { kind: 'user', userId: e.actor }
        : { kind: 'user', userId: e.actor, onBehalfOf: e.onBehalfOf },
    correlationId: randomUUID(),
    causationId: null,
    payload: SettingsActivityRecorded.payload.parse({
      area: e.area,
      action: e.action,
      subject: e.subject,
      detail: e.detail,
      reason: e.reason ?? null,
    }),
  };
}
