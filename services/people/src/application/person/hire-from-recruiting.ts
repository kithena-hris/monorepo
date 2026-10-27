import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  capitalisedName,
  toPeopleTerms,
  type CandidateHired,
  type EventEnvelope,
  type PrehireCancelled,
} from '@kithena/contracts';
import { ok } from '@kithena/domain-kit';
import type * as z from 'zod';

import type { PersonAccess } from './person-access.js';
import type { Calendars } from '../org/org.js';
import type { SchemaVersions } from './ports.js';
import { SYSTEM_VIEWER } from './subject.js';
import { valueSchemaFor } from './values.js';

/**
 * A hire Recruiting made, as People's own record (Recruiting PRD §21.4,
 * REC-141): `recruiting.candidate.hired` creates the person in `pre_hire`
 * from the start date, with the name, the work email, the manager, the
 * placement, the contract's terms (probation end among them) and the offer's
 * pay (base, what it is quoted per, payments a year, variable target, sign-on, relocation,
 * equity) in the fields the company's schema has (the core ones, `CORE_PACK`),
 * and the signature they signed the contract with in the company's signature
 * field, so the first document they sign in Kithena is signed with it;
 * `recruiting.prehire.cancelled` discards it before the start.
 *
 * Through `PersonAccess.create`, the one hire path every transport and the
 * import come through, as the system with HR's relations: the record is
 * HR's, not an integration's mirror, so HR edits it as any other. A field
 * the schema does not define is left out rather than refused — a company
 * that never published `probation_end` still gets the person — and so is a
 * value the schema refuses (`left`), for HR to fill in on the record.
 *
 * Idempotent on the work email: somebody already on the books under it — a
 * second delivery, or an internal candidate who was an employee all along —
 * is left as they are and reported unchanged, but for an empty signature,
 * which the contract's fills (`signed`). The cancellation finds the record by
 * that same email, among pre-hires only.
 */

export type Hired = EventEnvelope & { payload: z.infer<typeof CandidateHired.payload> };
export type Cancelled = EventEnvelope & { payload: z.infer<typeof PrehireCancelled.payload> };

export type Outcome = 'applied' | 'unchanged' | 'ignored' | 'rejected';

export interface HiresFromRecruiting {
  /** `left`: the fields whose values the schema refused, by key, for HR to fill in. */
  hired(
    tx: PostgresJsDatabase,
    event: Hired,
  ): Promise<{ outcome: Outcome; code?: string; left?: readonly string[] }>;
  cancelled(tx: PostgresJsDatabase, event: Cancelled): Promise<{ outcome: Outcome; code?: string }>;
  /**
   * Only what is empty: whoever is on the books under the work email gets the
   * contract's signature in an empty signature field, and a hire not started
   * yet every empty field the hire fills (a job title, a salary, a probation
   * end); nobody is created and nothing set is changed. What a replay of hires
   * made before the company had those fields goes through.
   */
  filled(tx: PostgresJsDatabase, event: Hired): Promise<{ outcome: Outcome; code?: string }>;
}

/** Everything the event says, by People's attribute keys. */
export function attributesOf(payload: Hired['payload']): Record<string, unknown> {
  const terms = toPeopleTerms(payload.terms);
  return {
    // As typed on an application, often in lower case; the record holds it capitalised.
    given_name: capitalisedName(payload.candidate.givenName),
    family_name: capitalisedName(payload.candidate.familyName),
    work_email: payload.candidate.email,
    ...(payload.candidate.phone === null ? {} : { mobile_phone: payload.candidate.phone }),
    ...(payload.jobTitle === null ? {} : { job_title: payload.jobTitle }),
    ...(payload.managerId === null ? {} : { manager_id: payload.managerId }),
    ...(payload.orgUnitId === null ? {} : { org_unit_id: payload.orgUnitId }),
    ...(payload.locationId === null ? {} : { location_id: payload.locationId }),
    legal_entity_id: payload.legalEntityId,
    base_salary: payload.pay.base,
    // What the salary is quoted per; how often payroll pays is HR's to say.
    pay_basis: payload.pay.frequency,
    payments_per_year: payload.terms.paymentsPerYear,
    ...(payload.pay.variableTarget === null
      ? {}
      : { variable_pay_target: payload.pay.variableTarget }),
    ...(payload.pay.signOnBonus === null ? {} : { sign_on_bonus: payload.pay.signOnBonus }),
    ...(payload.pay.relocation === null ? {} : { relocation_allowance: payload.pay.relocation }),
    ...(payload.pay.equity === null
      ? {}
      : { equity: `${String(payload.pay.equity.units)} × ${payload.pay.equity.description}` }),
    ...Object.fromEntries(Object.entries(terms).filter(([, v]) => v !== null)),
  };
}

export function hiresFromRecruiting(
  access: Pick<PersonAccess, 'create' | 'list' | 'discard' | 'update'>,
  schemas: Pick<SchemaVersions, 'current'>,
  more: {
    /** The company's offices, to find the job's by name when Recruiting made it. */
    readonly calendars?: Pick<Calendars, 'load'>;
    /** The core fields, there before a hire is written into them (`pickedFields`). */
    readonly ensure?: (tx: PostgresJsDatabase, tenantId: string) => Promise<void>;
  } = {},
): HiresFromRecruiting {
  const asking = (event: EventEnvelope) => ({
    tenantId: event.tenantId,
    viewer: SYSTEM_VIEWER,
    correlationId: event.correlationId,
  });
  /**
   * Everything the hire says, with the job's office as People knows it: the
   * same location, else one of the same name; none when People has neither.
   */
  const attributesFor = async (
    tx: PostgresJsDatabase,
    event: Hired,
  ): Promise<Record<string, unknown>> => {
    const { location_id: _asSent, ...rest } = attributesOf(event.payload);
    if (more.calendars === undefined) return attributesOf(event.payload);
    const offices = [...(await more.calendars.load(tx, event.tenantId)).locations.values()].filter(
      (l) => l.archived !== true,
    );
    const wanted = event.payload.locationName?.trim().toLocaleLowerCase('en');
    const office =
      offices.find((l) => l.id === event.payload.locationId) ??
      (wanted === undefined || wanted === ''
        ? undefined
        : offices.find((l) => l.name.trim().toLocaleLowerCase('en') === wanted));
    return office === undefined ? rest : { ...rest, location_id: office.id };
  };
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

  const filled: HiresFromRecruiting['filled'] = async (tx, event) => {
    await more.ensure?.(tx, event.tenantId);
    const version = await schemas.current(tx, event.tenantId);
    if (version === null) return { outcome: 'ignored', code: 'NOT_PUBLISHED' };
    const found = await holder(tx, event, event.payload.candidate.email, ON_THE_BOOKS);
    if (!found.ok) return { outcome: 'rejected', code: found.error.code };
    if (found.value === null) return { outcome: 'unchanged' };
    const held = found.value.attributes;
    const empty = (key: string) => held[key] === undefined || held[key] === null || held[key] === '';
    const live = version.document.attributes.filter((a) => a.deprecatedAt === null);
    const signatureField = live.find((a) => a.dataType === 'signature');
    const signature = event.payload.signature ?? null;
    // Somebody already working keeps what they have; a hire not started takes the hire's.
    const starting = NOT_STARTED.includes(found.value.status ?? '');
    const changes = Object.fromEntries([
      ...(starting
        ? Object.entries(await attributesFor(tx, event)).filter(([key, value]) => {
            const definition = live.find((a) => a.key === key);
            return (
              definition !== undefined &&
              empty(key) &&
              valueSchemaFor(definition, event.payload.startDate).safeParse(value).success
            );
          })
        : []),
      ...(signatureField !== undefined && signature !== null && empty(signatureField.key)
        ? [[signatureField.key, signature] as const]
        : []),
    ]);
    if (Object.keys(changes).length === 0) return { outcome: 'unchanged' };
    const updated = await access.update(tx, {
      ...asking(event),
      applySensitiveWithoutApproval: true,
      personId: found.value.id,
      changes,
    });
    return updated.ok ? { outcome: 'applied' } : { outcome: 'rejected', code: updated.error.code };
  };

  return {
    filled,
    async hired(tx, event) {
      await more.ensure?.(tx, event.tenantId);
      const version = await schemas.current(tx, event.tenantId);
      if (version === null) return { outcome: 'ignored', code: 'NOT_PUBLISHED' };
      const already = await holder(tx, event, event.payload.candidate.email, ON_THE_BOOKS);
      if (!already.ok) return { outcome: 'rejected', code: already.error.code };
      if (already.value !== null) {
        // Already on the books: only what is empty is the hire's to fill.
        const done = await filled(tx, event);
        return done.outcome === 'applied' ? done : { outcome: 'unchanged' };
      }
      const live = version.document.attributes.filter((a) => a.deprecatedAt === null);
      const defined = new Set<string>(live.map((a) => a.key));
      // The signature they signed the contract with, kept where the company keeps one.
      const signatureField = live.find((a) => a.dataType === 'signature');
      const attributes = {
        ...Object.fromEntries(
          Object.entries(await attributesFor(tx, event)).filter(([key]) => defined.has(key)),
        ),
        ...(signatureField === undefined || (event.payload.signature ?? null) === null
          ? {}
          : { [signatureField.key]: event.payload.signature }),
      };
      // A value the schema refuses is left out and named, checked before anything is written.
      const left = Object.entries(attributes).flatMap(([key, value]) => {
        const definition = live.find((a) => a.key === key);
        return definition !== undefined &&
          value !== null &&
          !valueSchemaFor(definition, event.payload.startDate).safeParse(value).success
          ? [key]
          : [];
      });
      const created = await access.create(tx, {
        ...asking(event),
        applySensitiveWithoutApproval: true,
        attributes: Object.fromEntries(
          Object.entries(attributes).filter(([k]) => !left.includes(k)),
        ),
        hireDate: event.payload.startDate,
      });
      if (!created.ok)
        return { outcome: 'rejected', code: created.error.code, left: created.error.path ?? [] };
      return left.length === 0 ? { outcome: 'applied' } : { outcome: 'applied', left };
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

/** A hire not started yet: their record still takes what the hire says. */
const NOT_STARTED: readonly string[] = ['pre_hire', 'onboarding'];

/** Somebody a hire would duplicate: anybody not discarded, merged or gone. */
const ON_THE_BOOKS = ['provisional', 'pre_hire', 'onboarding', 'active', 'on_leave', 'notice'];
