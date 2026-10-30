import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { EventEnvelope, ProbationReviewed } from '@kithena/contracts';
import type * as z from 'zod';

import type { PersonAccess } from './person-access.js';
import type { SchemaVersions } from './ports.js';
import { SYSTEM_VIEWER } from './subject.js';
import { valueSchemaFor } from './values.js';

/**
 * A probation decided in Onboarding, kept on People's record (Recruiting PRD
 * §O8): the outcome as `probation_outcome`, and an extension's new end as
 * `probation_end`, both from the day it was decided. Ending the employment is
 * HR's, through People's own termination; Onboarding sends them there.
 *
 * Through `PersonAccess.update`, as the system with HR's relations, as a
 * Recruiting hire is written. A field the company's schema does not define,
 * or a value it refuses, is left out rather than refusing the rest.
 */

export type Reviewed = EventEnvelope & { payload: z.infer<typeof ProbationReviewed.payload> };

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

export interface ProbationsFromOnboarding {
  reviewed(tx: PostgresJsDatabase, event: Reviewed): Promise<{ outcome: Outcome; code?: string }>;
}

export function probationsFromOnboarding(
  access: Pick<PersonAccess, 'update'>,
  schemas: Pick<SchemaVersions, 'current'>,
): ProbationsFromOnboarding {
  return {
    async reviewed(tx, event) {
      const p = event.payload;
      // A plan whose person People has not made yet has nobody here to record it on.
      if (p.personId === null) return { outcome: 'ignored', code: 'NO_PERSON' };
      const version = await schemas.current(tx, event.tenantId);
      if (version === null) return { outcome: 'ignored', code: 'NOT_PUBLISHED' };
      const live = version.document.attributes.filter((a) => a.deprecatedAt === null);
      const on = event.effectiveFrom ?? event.occurredAt.slice(0, 10);
      const wanted: Record<string, unknown> = {
        probation_outcome: p.outcome,
        ...(p.outcome === 'extended' && p.probationEnd !== null
          ? { probation_end: p.probationEnd }
          : {}),
      };
      const changes = Object.fromEntries(
        Object.entries(wanted).filter(([key, value]) => {
          const definition = live.find((a) => a.key === key);
          return (
            definition !== undefined && valueSchemaFor(definition, on).safeParse(value).success
          );
        }),
      );
      if (Object.keys(changes).length === 0) return { outcome: 'unchanged' };
      const updated = await access.update(tx, {
        tenantId: event.tenantId,
        viewer: SYSTEM_VIEWER,
        correlationId: event.correlationId,
        applySensitiveWithoutApproval: true,
        personId: p.personId,
        changes,
        effectiveFrom: on,
      });
      return updated.ok
        ? { outcome: 'applied' }
        : { outcome: 'rejected', code: updated.error.code };
    },
  };
}
