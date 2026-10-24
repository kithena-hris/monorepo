import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  toPeopleTerms,
  type CandidateHired,
  type EventEnvelope,
  type PrehireCancelled,
} from '@kithena/contracts';
import { ok } from '@kithena/domain-kit';
import type * as z from 'zod';

import type { PersonAccess } from './person-access.js';
import type { SchemaVersions } from './ports.js';
import { SYSTEM_VIEWER } from './subject.js';

/**
 * A hire Recruiting made, as People's own record (Recruiting PRD §21.4,
 * REC-141): `recruiting.candidate.hired` creates the person in `pre_hire`
 * from the start date, with the name, the work email, the manager, the
 * placement and the employment terms the company's schema has a field for,
 * and the signature they signed the contract with in the company's signature
 * field, so the first document they sign in Kithena is signed with it;
 * `recruiting.prehire.cancelled` discards it before the start.
 *
 * Through `PersonAccess.create`, the one hire path every transport and the
 * import come through, as the system with HR's relations: the record is
 * HR's, not an integration's mirror, so HR edits it as any other. A field
 * the schema does not define is left out rather than refused — a company
 * that never published `probation_end` still gets the person.
 *
 * Idempotent on the work email: somebody already on the books under it — a
 * second delivery, or an internal candidate who was an employee all along —
 * is left as they are and reported unchanged. The cancellation finds the
 * record by that same email, among pre-hires only.
 */

export type Hired = EventEnvelope & { payload: z.infer<typeof CandidateHired.payload> };
export type Cancelled = EventEnvelope & { payload: z.infer<typeof PrehireCancelled.payload> };

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

export interface HiresFromRecruiting {
  hired(tx: PostgresJsDatabase, event: Hired): Promise<{ outcome: Outcome; code?: string }>;
  cancelled(tx: PostgresJsDatabase, event: Cancelled): Promise<{ outcome: Outcome; code?: string }>;
}

/** Everything the event says, by People's attribute keys. */
export function attributesOf(payload: Hired['payload']): Record<string, unknown> {
  const terms = toPeopleTerms(payload.terms);
  return {
    given_name: payload.candidate.givenName,
    family_name: payload.candidate.familyName,
    work_email: payload.candidate.email,
    ...(payload.candidate.phone === null ? {} : { mobile_phone: payload.candidate.phone }),
    ...(payload.managerId === null ? {} : { manager_id: payload.managerId }),
    ...(payload.orgUnitId === null ? {} : { org_unit_id: payload.orgUnitId }),
    ...(payload.locationId === null ? {} : { location_id: payload.locationId }),
    legal_entity_id: payload.legalEntityId,
    base_salary: payload.pay.base,
    pay_frequency: payload.pay.frequency,
    ...Object.fromEntries(Object.entries(terms).filter(([, v]) => v !== null)),
  };
}

export function hiresFromRecruiting(
  access: Pick<PersonAccess, 'create' | 'list' | 'discard'>,
  schemas: Pick<SchemaVersions, 'current'>,
): HiresFromRecruiting {
  const asking = (event: EventEnvelope) => ({
    tenantId: event.tenantId,
    viewer: SYSTEM_VIEWER,
    correlationId: event.correlationId,
  });
  /** Whoever holds this work email, in one of `statuses`; HR's read, so the status is on the answer. */
  const holder = async (
    tx: PostgresJsDatabase,
    event: EventEnvelope,
    email: string,
    statuses: readonly string[],
  ) => {
    const page = await access.list(tx, { ...asking(event), limit: 20, search: email });
    if (!page.ok) return page;
    const wanted = email.toLowerCase();
    return ok(
      page.value.items.find(
        (p) =>
          statuses.includes(p.status ?? '') &&
          typeof p.attributes['work_email'] === 'string' &&
          p.attributes['work_email'].toLowerCase() === wanted,
      ) ?? null,
    );
  };

  return {
    async hired(tx, event) {
      const version = await schemas.current(tx, event.tenantId);
      if (version === null) return { outcome: 'ignored', code: 'NOT_PUBLISHED' };
      const already = await holder(tx, event, event.payload.candidate.email, ON_THE_BOOKS);
      if (!already.ok) return { outcome: 'rejected', code: already.error.code };
      if (already.value !== null) return { outcome: 'unchanged' };
      const live = version.document.attributes.filter((a) => a.deprecatedAt === null);
      const defined = new Set<string>(live.map((a) => a.key));
      // The signature they signed the contract with, kept where the company keeps one.
      const signatureField = live.find((a) => a.dataType === 'signature');
      const attributes = {
        ...Object.fromEntries(
          Object.entries(attributesOf(event.payload)).filter(([key]) => defined.has(key)),
        ),
        ...(signatureField === undefined || (event.payload.signature ?? null) === null
          ? {}
          : { [signatureField.key]: event.payload.signature }),
      };
      const created = await access.create(tx, {
        ...asking(event),
        applySensitiveWithoutApproval: true,
        attributes,
        hireDate: event.payload.startDate,
      });
      return created.ok
        ? { outcome: 'applied' }
        : { outcome: 'rejected', code: created.error.code };
    },
    async cancelled(tx, event) {
      if (event.payload.email === null) return { outcome: 'ignored' };
      const found = await holder(tx, event, event.payload.email, ['pre_hire', 'onboarding']);
      if (!found.ok) return { outcome: 'rejected', code: found.error.code };
      if (found.value === null) return { outcome: 'unchanged' };
      const discarded = await access.discard(tx, { ...asking(event), personId: found.value.id });
      return discarded.ok
        ? { outcome: 'applied' }
        : { outcome: 'rejected', code: discarded.error.code };
    },
  };
}

/** Somebody a hire would duplicate: anybody not discarded, merged or gone. */
const ON_THE_BOOKS = ['provisional', 'pre_hire', 'onboarding', 'active', 'on_leave', 'notice'];
