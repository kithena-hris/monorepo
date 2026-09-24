import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  err,
  failure,
  localDate,
  ok,
  type Clock,
  type DomainFailure,
  type Result,
} from '@kithena/domain-kit';
import type { Actor, AttributeDefinition, EmploymentType, WorkModel } from '@kithena/contracts';

import {
  canWrite,
  partitionWrites,
  readable,
  visibleTo,
  type ViewerRelations,
} from '../../domain/access/field-access.js';
import { assessCompleteness, type CompletenessVerdict } from '../../domain/person/completeness.js';
import {
  arrived,
  correct,
  currentValue,
  record,
  valueAsOf,
  type HistoryEntry,
} from '../../domain/person/history.js';
import {
  hireFactsOf,
  IDENTITY_FACT_KEYS,
  identityFactsOf,
  Person,
  type EventContext,
  type EmploymentPeriodRow,
  type LeavingReason,
  type PersonSnapshot,
} from '../../domain/person/person.js';
import { checkNationalId } from '../../country-packs/national-id.js';
import { changedAttribute } from '../../domain/person/profile.js';
import { placementOf, personZone } from '../../domain/org/calendar.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import { formatNumber, sequenceOf } from '../../domain/org/numbering.js';
import type { EmployeeNumbers } from '../org/numbering.js';
import type { RecomputePerson } from '../completeness/recompute.js';
import type { Calendars } from '../org/org.js';
import type { TenantRoles } from '../roles/roles.js';
import type { PersonFields, PersonRepository } from '../person-repository.js';
import { CORE_COLUMNS, isCoreKey, LIFECYCLE_KEYS } from './core.js';
import type {
  PersonReader,
  PersonRecord,
  PersonSearch,
  RelationsResolver,
  ScheduledRefusals,
  SchemaVersions,
  Secrets,
  Uniques,
  Viewer,
} from './ports.js';
import { valueSchemaFor } from './values.js';

/**
 * Reading and writing a person, for every transport.
 *
 * GraphQL, REST, SCIM, webhooks and workers all come through here, which is
 * the only reason the authorization rule holds for all of them: every read is
 * filtered by `readable` and every write is split by `partitionWrites`, in
 * this layer, before anything is returned or stored. A resolver that wanted
 * to leak a salary would have to not call this.
 *
 * **A field the viewer may not read is absent**, not null. That is
 * `readable`'s shape and nothing here re-adds a key it removed.
 *
 * Writes validate against the version in force and stamp it on the row;
 * corrections go through `correct()` from the history module and append a row
 * carrying `supersedes`. Nothing here issues an UPDATE against history.
 */

export interface PersonAccessDeps {
  readonly people: PersonRepository;
  readonly reader: PersonReader;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly secrets: Secrets;
  readonly uniques: Uniques;
  readonly clock: Clock;
  /** UUIDv7, for history rows, events and new records. */
  readonly newId: () => string;
  /** Whose day "today" is for each person (PRD §6.8). */
  readonly calendars: Calendars;
  /**
   * Employee numbering per legal entity (PEO-101). Absent, a hire numbers
   * nobody and a typed number is held to no format.
   */
  readonly numbering?: EmployeeNumbers;
  /**
   * Re-judge one person's completeness after a write, in its transaction
   * (PEO-102). Absent only in tests about something else; every wiring that
   * writes people passes it.
   */
  readonly completeness?: RecomputePerson;
  /**
   * Revokes a leaver's tenant roles when their access ends, in the same
   * transaction (PEO-109 × PEO-112). Every wiring with roles passes it.
   */
  readonly roles?: Pick<TenantRoles, 'accessEnded'>;
  /**
   * Scheduled values refused on their day (PEO-124). Absent, a refusal fails
   * the person in `bringIntoForce` instead of being recorded once.
   */
  readonly refusals?: ScheduledRefusals;
}

export interface Asking {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
}

export interface PersonView {
  readonly id: string;
  readonly status: string;
  readonly schemaVersion: number | null;
  /** Only what this viewer may read. A withheld key is absent, never null. */
  readonly attributes: Readonly<Record<string, unknown>>;
}

/** What an encrypted value reads as. The plaintext has its own, audited, path. */
export interface SealedValue {
  readonly last4: string | null;
}

type Tx = PostgresJsDatabase;

type On<T> = Asking & { readonly personId: string } & T;

export interface PersonAccess {
  read(tx: Tx, asking: On<{ readonly asOf?: string }>): Promise<Result<PersonView>>;
  list(
    tx: Tx,
    asking: Asking & {
      readonly after?: string | null;
      readonly limit: number;
      readonly asOf?: string;
      /** Equality on tenant-defined attributes. See `filterable`. */
      readonly where?: Readonly<Record<string, string>>;
      /** A substring of a name or work email. See `searchable`. */
      readonly search?: string;
      /**
       * Only people missing one of these staff-owned keys: the completeness
       * grid (PEO-122), which asks for exactly the keys it shows. HR's alone,
       * since who is missing what is itself a read.
       */
      readonly gaps?: readonly string[];
    },
  ): Promise<Result<{ items: readonly PersonView[]; next: string | null }>>;
  /** How many people `list` would page through for the same `where` and `search`. */
  count(
    tx: Tx,
    asking: Asking & {
      readonly where?: Readonly<Record<string, string>>;
      readonly search?: string;
    },
  ): Promise<Result<{ readonly all: number; readonly active: number }>>;
  update(
    tx: Tx,
    asking: On<{
      readonly changes: Readonly<Record<string, unknown>>;
      /** When a dated change takes effect. Defaults to today. */
      readonly effectiveFrom?: string;
    }>,
  ): Promise<Result<PersonView>>;
  create(
    tx: Tx,
    asking: Asking & { readonly attributes: Readonly<Record<string, unknown>> },
  ): Promise<Result<PersonView>>;
  history(
    tx: Tx,
    asking: On<{ readonly attributeKey?: string }>,
  ): Promise<Result<readonly HistoryEntry[]>>;
  correct(
    tx: Tx,
    asking: On<{
      readonly supersedes: string;
      readonly value: unknown;
      readonly reason: string | null;
    }>,
  ): Promise<Result<HistoryEntry>>;
  completeness(tx: Tx, asking: On<object>): Promise<Result<CompletenessVerdict>>;
  /**
   * Confirm a provisional record as an employee, from a start date. The one
   * hire path: every transport and the import come through here.
   */
  hire(
    tx: Tx,
    asking: On<{
      readonly hireDate: string;
      /** Values written with the hire, as `update` writes them. */
      readonly changes?: Readonly<Record<string, unknown>>;
      readonly effectiveFrom?: string;
    }>,
  ): Promise<Result<PersonView>>;
  /**
   * The rest of §8.1, HR only, each a no-op answered with the record when it
   * already stands where it would move to (a retry, not a second event).
   * "Today" is the person's own (§6.8).
   */
  giveNotice(
    tx: Tx,
    asking: On<{ readonly lastWorkingDay: string; readonly reason?: LeavingReason }>,
  ): Promise<Result<PersonView>>;
  terminate(
    tx: Tx,
    asking: On<{
      readonly lastWorkingDay: string;
      readonly reason: LeavingReason;
      /** HR's free text, carried as `terminated.reason`. */
      readonly note?: string | null;
      readonly eligibleForRehire?: boolean | null;
      /**
       * End their access at once rather than at the end of the last working
       * day (PEO-109): a dismissal for cause. Same as `endAccess` after.
       */
      readonly endAccessNow?: boolean;
    }>,
  ): Promise<Result<PersonView>>;
  /**
   * End a leaver's access now rather than at the end of their last working
   * day (PEO-109), HR only. Raises `access_ended` with the acting user on the
   * envelope, which is the audit record; answered with the record and no
   * second event once access has ended, whoever ended it.
   */
  endAccess(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  /**
   * A leaver hired again: a new employment period on the same record
   * (PEO-110), HR only. See `rehire` below for the employee number rule.
   */
  rehire(
    tx: Tx,
    asking: On<{
      /** The new employment's first day, on the person's calendar. */
      readonly startDate: string;
      /** The legal entity they rejoin; their last one when absent. */
      readonly legalEntityId?: string;
      /** Why HR rehires somebody marked not eligible. Required then, kept on the period. */
      readonly overrideReason?: string | null;
    }>,
  ): Promise<Result<PersonView>>;
  /**
   * Withdraw a person's notice (PEO-111), HR only, until their last working
   * day has ended on their calendar: back to the status they gave it from.
   */
  withdrawNotice(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  /**
   * Whose day it is for this person, and what day (PRD §6.8): their
   * location's zone, else their entity's, else their own, else the tenant's.
   * HR only, as every lifecycle move that runs on it is (PEO-119).
   */
  calendar(
    tx: Tx,
    asking: On<object>,
  ): Promise<Result<{ readonly today: string; readonly timeZone: string }>>;
  /** Every employment period on a person, first first (PEO-110). HR only. */
  employmentPeriods(tx: Tx, asking: On<object>): Promise<Result<readonly EmploymentPeriodRow[]>>;
  startLeave(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  endLeave(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  /** A provisional record that was never a person (§8.1); the one state a hard delete may follow. */
  discard(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  /**
   * Where a person sits (PEO-123): legal entity, work location, org unit and
   * cost centre, effective from a date. HR only. See `place` below.
   */
  place(tx: Tx, asking: On<PlacementChange>): Promise<Result<PersonView>>;
  /**
   * People's own move, not a viewer's (PEO-124): bring every dated value
   * whose day has come on the person's calendar into their projection, with
   * the events a present-dated write raises. The hourly job calls it, one
   * person a transaction; see `bringIntoForce` below.
   */
  bringIntoForce(
    tx: Tx,
    on: { readonly tenantId: string; readonly personId: string; readonly correlationId: string },
  ): Promise<Result<{ readonly day: string; readonly applied: number }>>;
}

/** A placement, as HR asks for it. An absent field is not changed; null clears it. */
export interface PlacementChange {
  readonly legalEntityId?: string | null;
  readonly locationId?: string | null;
  readonly orgUnitId?: string | null;
  readonly costCentre?: string | null;
  /** On the person's new calendar; today there when absent. A date ahead comes into force on its day (PEO-124). */
  readonly effectiveFrom?: string;
}

/** Each placement field and the attribute it writes. */
const PLACEMENT_KEYS = [
  ['legalEntityId', 'legal_entity_id'],
  ['locationId', 'location_id'],
  ['orgUnitId', 'org_unit_id'],
  ['costCentre', 'cost_centre'],
] as const;

const ORG_KEYS: readonly string[] = PLACEMENT_KEYS.map(([, key]) => key);

const textOf = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** What `org_changed` carries, read off a record's values. */
const orgOf = (values: Readonly<Record<string, unknown>>) => ({
  orgUnitId: textOf(values['org_unit_id']),
  costCentre: textOf(values['cost_centre']),
  legalEntityId: textOf(values['legal_entity_id']),
  locationId: textOf(values['location_id']),
});

/** An id no person has, for asking what the viewer may see tenant-wide. */
const NOBODY = '00000000-0000-0000-0000-000000000000';

/**
 * Whether the viewer may filter the directory by these keys.
 *
 * A filter is a read of every person it passes over: who matches
 * `cost_centre = ENG-204` says each person's cost centre without showing it.
 * So a key is filterable only when the viewer can read it on **everybody**,
 * through a tenant-wide relation, never one they hold to some people and not
 * others, and only when it lives in `custom`, which is what the index covers.
 * Encrypted values are never filterable: their plaintext is not in the row.
 */
export function filterable(
  definitions: readonly AttributeDefinition[],
  keys: readonly string[],
  everyone: ViewerRelations,
): Result<void> {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  for (const key of keys) {
    const definition = byKey.get(key);
    if (
      definition === undefined ||
      definition.encrypted ||
      isCoreKey(key) ||
      LIFECYCLE_KEYS.has(key) ||
      !visibleTo(definition, everyone)
    ) {
      return err(failure('FIELD_NOT_FILTERABLE', `You cannot filter people by ${key}`, [key]));
    }
  }
  return ok(undefined);
}

/**
 * Who the viewer is to each of many people: their tenant-wide relations once,
 * and `reach` once for who they are, manage and have in their chain — not
 * one resolver round trip per person. A resolver without `reach`, or a reach
 * that hit its cap, is asked per person for whoever it could not place.
 */
export async function relationsToMany(
  resolver: RelationsResolver,
  tx: Tx,
  tenantId: string,
  viewer: Viewer,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, ViewerRelations>> {
  const out = new Map<string, ViewerRelations>();
  if (personIds.length === 0) return out;
  const reach = await resolver.reach?.(tx, tenantId, viewer);
  const everyone = reach && (await resolver.relations(tx, tenantId, viewer, NOBODY));
  for (const id of personIds) {
    const placed =
      reach !== undefined && (reach.self.has(id) || reach.direct.has(id) || reach.chain.has(id));
    if (reach === undefined || everyone === undefined || (!reach.complete && !placed)) {
      // eslint-disable-next-line no-await-in-loop -- the fallback, per person by definition
      out.set(id, await resolver.relations(tx, tenantId, viewer, id));
      continue;
    }
    out.set(id, {
      ...everyone,
      isSelf: reach.self.has(id),
      isManager: reach.direct.has(id),
      isInManagerChain: reach.chain.has(id) || reach.direct.has(id),
    });
  }
  return out;
}

const SEARCHED = ['given_name', 'family_name', 'preferred_name', 'work_email'] as const;

/**
 * What a directory search may match against: the names and work email the
 * viewer can read on **everybody**, for `filterable`'s reason — who a search
 * returns says what each person's value contains. None of them readable, and
 * a search is refused rather than quietly matching nothing.
 */
export function searchable(
  definitions: readonly AttributeDefinition[],
  everyone: ViewerRelations,
): Result<PersonSearch['keys']> {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const keys = SEARCHED.filter((key) => {
    const definition = byKey.get(key);
    return definition !== undefined && !definition.encrypted && visibleTo(definition, everyone);
  });
  return keys.length === 0
    ? err(failure('FIELD_NOT_FILTERABLE', 'You cannot search people by name', ['search']))
    : ok(keys);
}

/**
 * A write People makes itself, not somebody asking (PEO-124): the job that
 * brings a dated value into force renumbers a transfer through `update`,
 * as the system process, with HR's reach. A symbol, so no transport can put
 * it on an `Asking` built from a request body.
 */
const AS_SYSTEM = Symbol('people.system');
type SystemAsking = Asking & { readonly [AS_SYSTEM]?: Actor };
const systemOf = (asking: Asking): Actor | undefined => (asking as SystemAsking)[AS_SYSTEM];
const SYSTEM_RELATIONS: ViewerRelations = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};
const EFFECTIVE_ACTOR: Actor = { kind: 'system', process: 'people-effective' };

const NotPublished = () =>
  failure('SCHEMA_NOT_PUBLISHED', 'This workspace has not published a People schema yet');
const PersonNotFound = () => failure('NOT_FOUND', 'No such person');
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The text a unique claim is keyed on.
 *
 * A national identifier as its country's rule normalises it, so `12345678 z`
 * and `12345678Z` are one NIF rather than two people. Anything else as typed;
 * `unique.ts` trims and casefolds it, then keys it with the tenant's HMAC key.
 * The claim store never keeps this text.
 */
export function claimText(definition: AttributeDefinition, value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const config = definition.typeConfig;
  if (config.kind !== 'national_id') return text;
  const checked = checkNationalId(config.country, config.scheme, text);
  return checked.ok ? checked.value.normalised : text;
}

export function personAccess(deps: PersonAccessDeps): PersonAccess {
  const { calendars } = deps;

  /**
   * The person's zone and today on it: their location's, else their legal
   * entity's, else their own, else the tenant's (PRD §6.8). Read off the
   * values the person will have, so a write that moves somebody to another
   * office is judged on the calendar it moves them to.
   */
  async function calendarOf(
    tx: Tx,
    tenantId: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly zone: string; readonly day: string }> {
    const at = deps.clock.instant();
    const zone = personZone(await calendars.load(tx, tenantId), placementOf(values), at);
    return { zone, day: localDate(at, zone) };
  }
  const actorOf = (asking: Asking): Actor =>
    systemOf(asking) ?? { kind: 'user', userId: asking.viewer.accountId };

  /** After a write: the record's completeness, judged again in the same transaction. */
  async function rejudge(
    tx: Tx,
    asking: Asking,
    personId: string,
    causationId: string | null,
  ): Promise<void> {
    await deps.completeness?.(tx, {
      tenantId: asking.tenantId,
      personId,
      actor: actorOf(asking),
      correlationId: asking.correlationId,
      causationId,
    });
  }

  /** One event id when a history row names the event; a fresh one per event otherwise. */
  function contextFor(asking: Asking, eventId?: string): EventContext {
    return {
      clock: deps.clock,
      newEventId: eventId === undefined ? deps.newId : () => eventId,
      actor: actorOf(asking),
      correlationId: asking.correlationId,
      causationId: null,
    };
  }

  /**
   * A list's `where` and `search`, authorized: each filtered key readable on
   * everybody (`filterable`), a search only over what is (`searchable`).
   * Both read today, so neither combines with `asOf`.
   */
  async function narrowing(
    tx: Tx,
    asking: Asking & {
      readonly asOf?: string;
      readonly where?: Readonly<Record<string, string>>;
      readonly search?: string;
    },
    version: PublishedVersion,
  ): Promise<
    Result<{ where: Readonly<Record<string, string>>; search: PersonSearch | undefined }>
  > {
    const where = asking.where ?? {};
    const text = (asking.search ?? '').trim();
    if (Object.keys(where).length === 0 && text === '') return ok({ where, search: undefined });
    if (asking.asOf !== undefined) {
      return err(
        failure('FILTER_WITH_AS_OF', 'A filter reads today; it cannot be combined with asOf'),
      );
    }
    // Who the viewer is to nobody in particular: their tenant-wide relations,
    // with self and manager false. The resolver answers that for an id no
    // person has.
    const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
    const allowed = filterable(version.document.attributes, Object.keys(where), everyone);
    if (!allowed.ok) return allowed;
    if (text === '') return ok({ where, search: undefined });
    const keys = searchable(version.document.attributes, everyone);
    return keys.ok ? ok({ where, search: { text, keys: keys.value } }) : keys;
  }

  async function view(
    tx: Tx,
    asking: Asking,
    person: PersonRecord,
    version: PublishedVersion,
    relations: ViewerRelations,
    asOf?: string,
  ): Promise<PersonView> {
    const definitions = version.document.attributes;
    const values = new Map(Object.entries(person.values));

    // A sealed value reads as its last four, whatever `custom` might hold.
    const sealed = definitions.filter((d) => d.encrypted);
    if (sealed.length > 0) {
      for (const d of sealed) values.delete(d.key);
      for (const s of await deps.secrets.list(tx, asking.tenantId, person.snapshot.id)) {
        values.set(s.attributeKey, { last4: s.last4 } satisfies SealedValue);
      }
    }

    // `asOf` replays history for what is dated; the rest has no "as of".
    if (asOf !== undefined) {
      const history = await deps.people.history(tx, asking.tenantId, person.snapshot.id);
      for (const d of definitions) {
        if (!d.effectiveDated || d.encrypted) continue;
        const entry = valueAsOf(history, d.key, asOf);
        if (entry === undefined || entry.value === null) values.delete(d.key);
        else values.set(d.key, entry.value);
      }
    }

    return {
      id: person.snapshot.id,
      status: person.snapshot.status,
      schemaVersion: person.schemaVersion,
      attributes: readable(definitions, Object.fromEntries(values), relations),
    };
  }

  /** Validate one proposed value against its definition, or say which key is wrong. */
  function validate(definition: AttributeDefinition, value: unknown, day: string): Result<unknown> {
    if (value === null) {
      return definition.encrypted
        ? err(failure('VALUE_INVALID', `${definition.key} cannot be cleared`, [definition.key]))
        : ok(null);
    }
    const parsed = valueSchemaFor(definition, day).safeParse(value);
    if (!parsed.success) {
      const reason = parsed.error.issues[0]?.message ?? 'invalid';
      return err(failure('VALUE_INVALID', `${definition.key}: ${reason}`, [definition.key]));
    }
    return ok(parsed.data);
  }

  /**
   * Tell identity, in the same transaction, when a fact it caches moved.
   *
   * Read off the record as it will be after this write, with the hire date
   * from the aggregate because that is the column's owner. Its own event id:
   * the context a use case builds hands out one id, and the transition's event
   * already has it.
   */
  function shareIdentityFacts(
    aggregate: Person,
    asking: Asking,
    values: Readonly<Record<string, unknown>>,
    effectiveFrom: string | null,
  ): void {
    aggregate.shareIdentityFacts(
      identityFactsOf({ ...values, hire_date: aggregate.hireDate }),
      contextFor(asking, deps.newId()),
      effectiveFrom,
    );
  }

  /** Put a value into the projection: a typed column, or `custom`. */
  function project(
    fields: Record<string, unknown>,
    custom: Map<string, unknown>,
    key: string,
    value: unknown,
  ): void {
    if (isCoreKey(key)) fields[CORE_COLUMNS[key]] = value;
    else if (value === null) custom.delete(key);
    else custom.set(key, value);
  }

  async function claimUnique(
    tx: Tx,
    asking: Asking,
    person: PersonRecord,
    definition: AttributeDefinition,
    value: unknown,
    legalEntityId: string | null,
  ): Promise<Result<void>> {
    if (definition.uniqueScope === 'none') return ok(undefined);
    const where = { personId: person.snapshot.id, attributeKey: definition.key };
    if (value === null) {
      await deps.uniques.release(tx, asking.tenantId, where);
      return ok(undefined);
    }
    const scopeId = definition.uniqueScope === 'tenant' ? asking.tenantId : legalEntityId;
    if (scopeId === null) {
      return err(
        failure(
          'UNIQUE_SCOPE_MISSING',
          `${definition.key} is unique per legal entity, and this person has none`,
          [definition.key],
        ),
      );
    }
    return deps.uniques.claim(tx, asking.tenantId, {
      ...where,
      scopeId,
      value: claimText(definition, value),
    });
  }

  /**
   * The next employee number for a hire, when the person has none, the entity
   * they are hired into numbers its people, and the version has the field to
   * hold it (PEO-101). Taken in the hire's transaction, so a refused hire
   * hands it back.
   */
  async function numberFor(
    tx: Tx,
    asking: Asking & { readonly personId: string },
    version: PublishedVersion,
    changes: Readonly<Record<string, unknown>>,
  ): Promise<{ employee_number?: string }> {
    if (!deps.numbering || changes['employee_number'] !== undefined) return {};
    if (!version.document.attributes.some((d) => d.key === 'employee_number')) return {};
    const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
    if (!person || person.snapshot.status !== 'provisional') return {};
    if (person.values['employee_number'] !== undefined) return {};
    const entity = changes['legal_entity_id'] ?? person.legalEntityId;
    if (typeof entity !== 'string') return {};
    const next = await nextNumber(tx, asking.tenantId, entity);
    return next === null ? {} : { employee_number: next };
  }

  /**
   * The next free number in an entity's scheme, taken in this transaction;
   * null when it does not number.
   *
   * A number somebody already holds — typed in another entity, or imported
   * before the scheme existed — is skipped: the register is unique in the
   * tenant (`person_employee_number_key`), and a skipped number is taken, not
   * lost.
   *
   * ponytail: bounded at 100 skips, after which the hire goes unnumbered and
   * HR types one. Only a register full of hand-typed numbers in this scheme's
   * format gets near it.
   */
  async function nextNumber(tx: Tx, tenantId: string, entity: string): Promise<string | null> {
    if (!deps.numbering) return null;
    for (let skips = 0; skips < 100; skips += 1) {
      // eslint-disable-next-line no-await-in-loop -- each allocation depends on the last
      const next = await deps.numbering.allocate(tx, tenantId, entity);
      if (!next) return null;
      const employeeNumber = formatNumber(next, next.sequence);
      // eslint-disable-next-line no-await-in-loop -- as above
      if (!(await deps.numbering.taken(tx, tenantId, employeeNumber))) return employeeNumber;
    }
    return null;
  }

  /**
   * The number somebody moving into `entity` takes, or null to keep theirs
   * (PEO-101, PEO-110, PEO-123): kept — it is theirs in the register and on
   * every document — unless the entity numbers its people and its scheme would
   * not write it; then the scheme's next, as a new hire there would get.
   */
  async function renumbered(
    tx: Tx,
    tenantId: string,
    version: PublishedVersion,
    entity: string | null,
    held: unknown,
  ): Promise<string | null> {
    if (!deps.numbering || entity === null) return null;
    if (!version.document.attributes.some((d) => d.key === 'employee_number')) return null;
    const scheme = await deps.numbering.scheme(tx, tenantId, entity);
    if (!scheme || (typeof held === 'string' && sequenceOf(scheme, held) !== null)) return null;
    return nextNumber(tx, tenantId, entity);
  }

  async function update(
    tx: Tx,
    asking: Asking & {
      readonly personId: string;
      readonly changes: Readonly<Record<string, unknown>>;
      /** When a dated change takes effect. Defaults to today. */
      readonly effectiveFrom?: string;
    },
    /**
     * False when the caller will tell identity itself, later in the same
     * transaction: a hire that also renames somebody sends one event with the
     * final name, not one per step.
     */
    tellIdentity = true,
  ): Promise<Result<PersonView>> {
    const version = await deps.schemas.current(tx, asking.tenantId);
    if (!version) return err(NotPublished());

    const person = await deps.reader.record(tx, asking.tenantId, asking.personId, true);
    if (!person) return err(PersonNotFound());

    const relations =
      systemOf(asking) === undefined
        ? await deps.relations.relations(tx, asking.tenantId, asking.viewer, asking.personId)
        : SYSTEM_RELATIONS;

    if (asking.effectiveFrom !== undefined && !CALENDAR_DATE.test(asking.effectiveFrom)) {
      return err(failure('VALUE_INVALID', 'effectiveFrom is a calendar date', ['effectiveFrom']));
    }

    const lifecycle = Object.keys(asking.changes).filter((k) => LIFECYCLE_KEYS.has(k));
    if (lifecycle.length > 0) {
      return err(
        failure(
          'LIFECYCLE_FIELD',
          `${lifecycle.join(', ')} changes through the lifecycle, not an edit`,
          lifecycle,
        ),
      );
    }

    const definitions = version.document.attributes;
    const { allowed, refused } = partitionWrites(definitions, asking.changes, relations);
    if (refused.length > 0) {
      return err(
        failure('FIELD_NOT_WRITABLE', `Not yours to change: ${refused.join(', ')}`, refused),
      );
    }

    const byKey = new Map(definitions.map((d) => [d.key as string, d]));
    const { day } = await calendarOf(tx, asking.tenantId, { ...person.values, ...allowed });
    const effectiveFrom = asking.effectiveFrom ?? day;

    // Every value checked before anything is written, so a bad sixth field
    // does not leave five claims behind.
    const accepted: [AttributeDefinition, unknown][] = [];
    for (const [key, proposed] of Object.entries(allowed)) {
      const definition = byKey.get(key);
      if (!definition) continue; // partitionWrites refused unknown keys already
      const valid = validate(definition, proposed, day);
      if (!valid.ok) return valid;
      accepted.push([definition, valid.value]);
    }

    const legalEntityId =
      (accepted.find(([d]) => d.key === 'legal_entity_id')?.[1] as string | null | undefined) ??
      person.legalEntityId;

    /*
     * An employee number in an entity that numbers its people (PEO-101) is
     * held to the scheme's format, is claimed unique whatever the attribute's
     * own scope says, and moves the sequence past itself so a later hire is
     * never handed it.
     */
    const numbered = accepted.findIndex(([d, v]) => d.key === 'employee_number' && v !== null);
    const entry = accepted[numbered];
    if (entry && deps.numbering && legalEntityId !== null) {
      const scheme = await deps.numbering.scheme(tx, asking.tenantId, legalEntityId);
      if (scheme) {
        const sequence = sequenceOf(scheme, String(entry[1]));
        if (sequence === null) {
          return err(
            failure(
              'VALUE_INVALID',
              `employee_number: this legal entity's numbers look like ${formatNumber(scheme, 1)}`,
              ['employee_number'],
            ),
          );
        }
        await deps.numbering.observe(tx, asking.tenantId, legalEntityId, sequence);
        // Claimed tenant-wide, as `person_employee_number_key` holds it, so a
        // clash is refused as UNIQUE_VALUE_TAKEN rather than failing the write.
        if (entry[0].uniqueScope !== 'tenant') {
          accepted[numbered] = [{ ...entry[0], uniqueScope: 'tenant' }, entry[1]];
        }
      }
    }

    // Every rule this write claims under, locked in one order before the
    // first claim, so two writes naming the same attributes in opposite
    // orders queue rather than deadlock.
    await deps.uniques.lock(
      tx,
      asking.tenantId,
      accepted.flatMap(([d, v]) => {
        if (d.uniqueScope === 'none' || v === null) return [];
        const scopeId = d.uniqueScope === 'tenant' ? asking.tenantId : legalEntityId;
        return scopeId === null ? [] : [{ attributeKey: d.key, scopeId }];
      }),
    );

    const eventId = deps.newId();
    const custom = new Map(Object.entries(person.custom));
    const fields: Record<string, unknown> = {};
    const projected = new Map<string, unknown>();
    let history: readonly HistoryEntry[] = [];

    // Loaded only when something is dated: a backdated change must not
    // overwrite a later one that is already in force.
    const existing = accepted.some(([d]) => d.effectiveDated)
      ? await deps.people.history(tx, asking.tenantId, person.snapshot.id)
      : [];

    for (const [definition, value] of accepted) {
      const claimed = await claimUnique(tx, asking, person, definition, value, legalEntityId);
      if (!claimed.ok) return claimed;

      const id = deps.newId();
      history = record(history, {
        id,
        attributeKey: definition.key,
        // History never holds a sealed value. It records that it changed.
        value: definition.encrypted ? null : value,
        effectiveFrom: definition.effectiveDated ? effectiveFrom : day,
        recordedAt: deps.clock.instant(),
        actor: actorOf(asking),
        eventId,
      });

      if (definition.encrypted) {
        const plaintext = typeof value === 'string' ? value : JSON.stringify(value);
        await deps.secrets.put(
          tx,
          { tenantId: asking.tenantId, personId: person.snapshot.id, attributeKey: definition.key },
          plaintext,
        );
        continue;
      }

      // The projection holds what is in force today. A change dated in the
      // future is history now and the projection later; a backdated one moves
      // the projection only if nothing later has superseded it.
      const inForce = definition.effectiveDated
        ? valueAsOf([...existing, ...history], definition.key, day)
        : currentValue(history, definition.key);
      if (inForce?.id === id) {
        project(fields, custom, definition.key, value);
        projected.set(definition.key, value);
      }
    }

    const aggregate = Person.rehydrate(person.snapshot);
    const raised = aggregate.updateProfile(
      accepted.map(([d, v]) => changedAttribute(d, v)),
      version.version,
      contextFor(asking, eventId),
      effectiveFrom,
    );
    if (!raised.ok) return raised;

    // The reporting line and the org, as their own events: authorization is
    // derived from them (PEO-092), and `profile_updated` carries no values.
    const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
    const moved = (key: string) =>
      projected.has(key) && text(projected.get(key)) !== text(person.values[key]);
    if (moved('manager_id')) {
      aggregate.moveManager(
        text(person.values['manager_id']),
        text(projected.get('manager_id')),
        contextFor(asking, deps.newId()),
        effectiveFrom,
      );
    }
    if (ORG_KEYS.some(moved)) {
      aggregate.moveOrg(
        orgOf({ ...person.values, ...Object.fromEntries(projected) }),
        contextFor(asking, deps.newId()),
        effectiveFrom,
      );
    }
    // A new legal entity is a transfer for somebody employed elsewhere in the
    // tenant (PEO-123): one employment period closes and the next opens, from
    // the date the row takes effect. Every writer comes through here, so an
    // import or a form moves the period exactly as the placement does.
    let renumber = false;
    if (moved('legal_entity_id')) {
      const dated = byKey.get('legal_entity_id')?.effectiveDated === true;
      const placed = aggregate.place(
        text(projected.get('legal_entity_id')),
        dated ? effectiveFrom : day,
        text(person.values['legal_entity_id']),
      );
      if (!placed.ok) return placed;
      renumber =
        placed.value === 'transferred' ||
        (placed.value === 'placed' && text(person.values['legal_entity_id']) !== null);
    } else if (!projected.has('legal_entity_id') && effectiveFrom > day) {
      // Scheduled (PEO-124): the transfer happens on its day, when the hourly
      // job brings the entity in. Refused now if it would be refused now —
      // somebody on notice is leaving, not moving.
      const entity = accepted.find(([d]) => d.key === 'legal_entity_id');
      if (entity !== undefined) {
        const probe = Person.rehydrate(person.snapshot).place(
          text(entity[1]),
          effectiveFrom,
          text(person.values['legal_entity_id']),
        );
        if (!probe.ok) return probe;
      }
    }

    if (tellIdentity && [...projected.keys()].some((k) => IDENTITY_FACT_KEYS.has(k))) {
      shareIdentityFacts(
        aggregate,
        asking,
        { ...person.values, ...Object.fromEntries(projected) },
        effectiveFrom,
      );
    }

    await deps.people.save(tx, aggregate, {
      fields: {
        ...(fields as PersonFields),
        custom: Object.fromEntries(custom),
        schemaVersion: version.version,
      },
      history,
    });
    await rejudge(tx, asking, asking.personId, eventId);

    // Moved from one entity to another: the new entity's number, when its
    // scheme would not write the one they hold — as a second write, dated the same.
    if (renumber && !('employee_number' in asking.changes)) {
      const next = await renumbered(
        tx,
        asking.tenantId,
        version,
        text(projected.get('legal_entity_id')),
        person.values['employee_number'],
      );
      if (next !== null) {
        return update(tx, { ...asking, changes: { employee_number: next }, effectiveFrom }, tellIdentity);
      }
    }

    // Asked again: a write can move a manager, and the answer is shown under
    // the relations that hold after it, not the ones that held before.
    const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
    if (!after) return err(PersonNotFound());
    const now =
      systemOf(asking) === undefined
        ? await deps.relations.relations(tx, asking.tenantId, asking.viewer, asking.personId)
        : SYSTEM_RELATIONS;
    return ok(await view(tx, asking, after, version, now));
  }

  /**
   * One lifecycle move, as HR (PEO-108): §7 gives termination facts to HR,
   * and `people_admin` is the schema's owner, not a key to the lifecycle. A
   * manager moves nobody.
   *
   * `settled` says the record already stands where the move would leave it —
   * a retried request — and is answered with the record and no second event.
   * Otherwise the aggregate moves on the person's own calendar, its events and
   * dated rows are drained through the outbox in this transaction, and their
   * completeness is judged again (PEO-102), since a requiredness predicate may
   * name the state. The grid's `confirm_termination` row is read off the
   * status, so a termination closes it with nothing to clear.
   */
  async function lifecycle(
    tx: Tx,
    asking: On<object>,
    action: string,
    settled: (snapshot: PersonSnapshot) => boolean,
    move: (aggregate: Person, zone: string, ctx: EventContext) => Result<void>,
  ): Promise<Result<PersonView>> {
    const version = await deps.schemas.current(tx, asking.tenantId);
    if (!version) return err(NotPublished());
    const person = await deps.reader.record(tx, asking.tenantId, asking.personId, true);
    if (!person) return err(PersonNotFound());
    const relations = await deps.relations.relations(
      tx,
      asking.tenantId,
      asking.viewer,
      asking.personId,
    );
    if (!relations.isHr) return err(failure('FORBIDDEN', `Only HR ${action}`));

    if (!settled(person.snapshot)) {
      const aggregate = Person.rehydrate(person.snapshot);
      const { zone } = await calendarOf(tx, asking.tenantId, person.values);
      const moved = move(aggregate, zone, contextFor(asking));
      if (!moved.ok) return moved;
      await deps.people.save(tx, aggregate);
      // Access ended by this move: the leaver's tenant roles end with it.
      const account = aggregate.identityAccountId;
      const endedNow =
        (person.snapshot.accessEndedAt ?? null) === null && aggregate.accessEndedAt !== null;
      if (endedNow && account !== null) {
        await deps.roles?.accessEnded(tx, {
          tenantId: asking.tenantId,
          accountId: account,
          correlationId: asking.correlationId,
          causationId: null,
        });
      }
      await rejudge(tx, asking, asking.personId, null);
    }

    const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
    if (!after) return err(PersonNotFound());
    return ok(await view(tx, asking, after, version, relations));
  }

  const lastDayOf = (asking: { readonly lastWorkingDay: string }): Result<string> =>
    CALENDAR_DATE.test(asking.lastWorkingDay)
      ? ok(asking.lastWorkingDay)
      : err(failure('VALUE_INVALID', 'lastWorkingDay is a calendar date', ['lastWorkingDay']));

  const api: PersonAccess = {
    giveNotice: (tx, asking) => {
      const day = lastDayOf(asking);
      if (!day.ok) return Promise.resolve(day);
      return lifecycle(
        tx,
        asking,
        'puts a person on notice',
        (s) => s.status === 'notice' && s.lastWorkingDay === day.value,
        (p, zone, ctx) => p.giveNotice(day.value, ctx, zone, asking.reason),
      );
    },

    terminate: (tx, asking) => {
      const day = lastDayOf(asking);
      if (!day.ok) return Promise.resolve(day);
      const ended = (s: PersonSnapshot) =>
        s.status === 'terminated' && s.lastWorkingDay === day.value;
      const now = asking.endAccessNow === true;
      return lifecycle(
        tx,
        asking,
        'terminates a person',
        (s) => ended(s) && (!now || (s.accessEndedAt ?? null) !== null),
        (p, zone, ctx) => {
          // A retry that now also asks for access to end: the termination
          // already stands, so only the second half is new.
          if (!ended(p.snapshot)) {
            const terminated = p.terminate(day.value, ctx, zone, {
              reason: asking.reason,
              note: asking.note ?? null,
              eligibleForRehire: asking.eligibleForRehire ?? null,
            });
            if (!terminated.ok) return terminated;
          }
          // Access may already have ended at the end of the last day, before
          // HR confirmed the termination (PEO-109); nothing more to end then.
          return now && p.accessEndedAt === null ? p.endAccess(ctx, zone, 'now') : ok(undefined);
        },
      );
    },

    /**
     * Rehire (PEO-110): the aggregate opens the new period and says whether it
     * may; this places it and numbers it.
     *
     * **Employee number.** The person keeps the number they had — it is theirs
     * in the register and on every document from the first employment —
     * unless the legal entity they rejoin numbers its people and their number
     * is not one its scheme would write (another entity's prefix, say); then
     * they take that scheme's next number, as a new hire there would. A person
     * with no number joining an entity that numbers gets one. The old number
     * stays in history either way.
     *
     * `identity_facts_changed` carries the new start, which identity gates
     * enrolment on; `access_restored` (from the aggregate) reinstates the
     * account once the start has come.
     */
    async rehire(tx, asking) {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      if (!CALENDAR_DATE.test(asking.startDate)) {
        return err(failure('VALUE_INVALID', 'startDate is a calendar date', ['startDate']));
      }
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId, true);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );
      if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR rehires a person'));

      const defines = (key: string) => version.document.attributes.some((d) => d.key === key);
      if (asking.legalEntityId !== undefined && !defines('legal_entity_id')) {
        return err(
          failure('VALUE_INVALID', 'This schema has no legal entity to rehire into', [
            'legalEntityId',
          ]),
        );
      }
      const entity = asking.legalEntityId ?? person.legalEntityId;
      const facts = hireFactsOf(person.values, entity, version.version);
      if (!facts.ok) return facts;

      const aggregate = Person.rehydrate(person.snapshot);
      const placed = { ...person.values, ...(entity === null ? {} : { legal_entity_id: entity }) };
      const { zone } = await calendarOf(tx, asking.tenantId, placed);
      const moved = aggregate.rehire(
        asking.startDate,
        facts.value,
        contextFor(asking),
        zone,
        asking.overrideReason ?? null,
      );
      if (!moved.ok) return moved;
      shareIdentityFacts(aggregate, asking, person.values, asking.startDate);
      await deps.people.save(tx, aggregate);

      const changes: Record<string, unknown> = {};
      if (entity !== null && entity !== person.legalEntityId) changes['legal_entity_id'] = entity;
      const next = await renumbered(
        tx,
        asking.tenantId,
        version,
        entity,
        person.values['employee_number'],
      );
      if (next !== null) changes['employee_number'] = next;
      if (Object.keys(changes).length > 0) {
        const placedWrite = await update(
          tx,
          { ...asking, changes, effectiveFrom: asking.startDate },
          false,
        );
        if (!placedWrite.ok) return placedWrite;
      } else {
        await rejudge(tx, asking, asking.personId, null);
      }

      const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!after) return err(PersonNotFound());
      return ok(await view(tx, asking, after, version, relations));
    },

    /**
     * The notice's `last_working_day` row is the standing one when it holds
     * the date the record does; that is what the withdrawal supersedes. A
     * notice recorded before its row existed has nothing to supersede.
     * Never settled: once withdrawn the person is not on notice, and a
     * repeat is refused — a REST retry is answered by its Idempotency-Key.
     */
    async withdrawNotice(tx, asking) {
      const history = await deps.people.history(
        tx,
        asking.tenantId,
        asking.personId,
        'last_working_day',
      );
      const standing = currentValue(history, 'last_working_day');
      return lifecycle(
        tx,
        asking,
        'withdraws notice',
        () => false,
        (p, zone, ctx) =>
          p.withdrawNotice(
            ctx,
            zone,
            standing !== undefined && standing.value === p.lastWorkingDay ? standing : null,
          ),
      );
    },

    async calendar(tx, asking) {
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );
      if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR reads a person’s calendar'));
      const { zone, day } = await calendarOf(tx, asking.tenantId, person.values);
      return ok({ today: day, timeZone: zone });
    },

    async employmentPeriods(tx, asking) {
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );
      if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR reads employment periods'));
      return ok(await deps.people.periods(tx, asking.tenantId, asking.personId));
    },

    endAccess: (tx, asking) =>
      lifecycle(
        tx,
        asking,
        'ends a person’s access',
        (s) => s.status === 'terminated' && (s.accessEndedAt ?? null) !== null,
        (p, zone, ctx) => p.endAccess(ctx, zone, 'now'),
      ),

    startLeave: (tx, asking) =>
      lifecycle(
        tx,
        asking,
        'puts a person on leave',
        (s) => s.status === 'on_leave',
        (p, zone, ctx) => p.startLeave(ctx, zone),
      ),

    endLeave: (tx, asking) =>
      lifecycle(
        tx,
        asking,
        'brings a person back from leave',
        // Never settled: `active` does not say whether they were ever away, and
        // somebody who was not must be refused, not told they are back. A REST
        // retry is answered by its Idempotency-Key instead.
        () => false,
        (p, zone, ctx) => p.endLeave(ctx, zone),
      ),

    discard: (tx, asking) =>
      lifecycle(
        tx,
        asking,
        'discards a record',
        (s) => s.status === 'discarded',
        (p, _zone, ctx) => p.discard(ctx),
      ),

    async read(
      tx: Tx,
      asking: Asking & { readonly personId: string; readonly asOf?: string },
    ): Promise<Result<PersonView>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );
      return ok(await view(tx, asking, person, version, relations, asking.asOf));
    },

    /**
     * A page of people, each filtered for this viewer: who the viewer is to
     * each comes from `relationsToMany`, a handful of questions for the page.
     */
    async list(
      tx: Tx,
      asking: Asking & {
        readonly after?: string | null;
        readonly limit: number;
        readonly asOf?: string;
        readonly where?: Readonly<Record<string, string>>;
        readonly search?: string;
        readonly gaps?: readonly string[];
      },
    ): Promise<Result<{ items: readonly PersonView[]; next: string | null }>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const query = await narrowing(tx, asking, version);
      if (!query.ok) return query;
      if (asking.gaps !== undefined) {
        const everyone = await deps.relations.relations(tx, asking.tenantId, asking.viewer, NOBODY);
        if (!everyone.isHr) return err(failure('FORBIDDEN', 'Who is missing what is HR’s to list'));
      }
      const rows = await deps.reader.page(
        tx,
        asking.tenantId,
        asking.after ?? null,
        asking.limit,
        query.value.where,
        query.value.search,
        asking.gaps,
      );
      const related = await relationsToMany(
        deps.relations,
        tx,
        asking.tenantId,
        asking.viewer,
        rows.map((r) => r.snapshot.id),
      );
      const items: PersonView[] = [];
      for (const row of rows) {
        const relations = related.get(row.snapshot.id);
        if (relations === undefined) continue;
        items.push(await view(tx, asking, row, version, relations, asking.asOf));
      }
      const next = rows.length === asking.limit ? (rows.at(-1)?.snapshot.id ?? null) : null;
      return ok({ items, next });
    },

    async count(tx, asking) {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const query = await narrowing(tx, asking, version);
      if (!query.ok) return query;
      return ok(await deps.reader.count(tx, asking.tenantId, query.value.where, query.value.search));
    },

    update: (tx, asking) => update(tx, asking),

    /**
     * A new record, provisional, with its first values.
     *
     * The values go through `update`, so creating somebody is held to exactly
     * the ownership rules editing them is: an HR creator sets what HR owns.
     */
    async create(
      tx: Tx,
      asking: Asking & { readonly attributes: Readonly<Record<string, unknown>> },
    ): Promise<Result<PersonView>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());

      const id = deps.newId();
      const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, id);
      if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR creates a person record'));

      await deps.people.create(
        tx,
        Person.rehydrate({
          id,
          tenantId: asking.tenantId,
          status: 'provisional',
          identityAccountId: null,
          hireDate: null,
          lastWorkingDay: null,
        }),
        { schemaVersion: version.version },
      );
      return update(tx, { ...asking, personId: id, changes: asking.attributes });
    },

    /** Dated facts, for the attributes this viewer may read. */
    async history(
      tx: Tx,
      asking: Asking & { readonly personId: string; readonly attributeKey?: string },
    ): Promise<Result<readonly HistoryEntry[]>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );

      const byKey = new Map(version.document.attributes.map((d) => [d.key as string, d]));
      const entries = await deps.people.history(
        tx,
        asking.tenantId,
        asking.personId,
        asking.attributeKey,
      );
      return ok(
        entries.filter((e) => {
          const definition = byKey.get(e.attributeKey);
          return definition !== undefined && visibleTo(definition, relations);
        }),
      );
    },

    /**
     * Correct a fact recorded wrongly: a new row carrying `supersedes`.
     *
     * Takes effect when the fact it corrects did, which is what stops a salary
     * typo reading as a pay cut followed by a raise. The projection moves only
     * when the corrected fact is the one currently in force.
     */
    async correct(
      tx: Tx,
      asking: Asking & {
        readonly personId: string;
        readonly supersedes: string;
        readonly value: unknown;
        readonly reason: string | null;
      },
    ): Promise<Result<HistoryEntry>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId, true);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );

      const history = await deps.people.history(tx, asking.tenantId, asking.personId);
      const target = history.find((e) => e.id === asking.supersedes);
      if (!target) {
        return err(
          failure('SUPERSEDES_UNKNOWN', `No history entry called ${asking.supersedes}`, [
            'supersedes',
          ]),
        );
      }

      const definition = version.document.attributes.find((d) => d.key === target.attributeKey);
      // The same refusal as an unwritable field, so a probe cannot tell an
      // archived attribute from one it may not touch.
      if (!definition || !canWrite(definition, relations).ok) {
        return err(
          failure('FIELD_NOT_WRITABLE', `Not yours to change: ${target.attributeKey}`, [
            target.attributeKey,
          ]),
        );
      }
      if (definition.encrypted) {
        return err(
          failure(
            'ENCRYPTED_NOT_CORRECTABLE',
            'A sealed value has no history to correct; write the new value instead',
            [definition.key],
          ),
        );
      }

      const { zone, day } = await calendarOf(tx, asking.tenantId, person.values);
      const lifecycle = LIFECYCLE_KEYS.has(definition.key);
      if (lifecycle && asking.value === null) {
        return err(
          failure('VALUE_INVALID', `${definition.key} is corrected, never cleared`, [
            definition.key,
          ]),
        );
      }
      const valid = validate(definition, asking.value, day);
      if (!valid.ok) return valid;

      const eventId = deps.newId();
      const corrected = correct(history, {
        id: deps.newId(),
        supersedes: asking.supersedes,
        value: valid.value,
        recordedAt: deps.clock.instant(),
        actor: actorOf(asking),
        eventId,
      });
      if (!corrected.ok) return corrected;
      const entry = corrected.value.at(-1) as HistoryEntry;

      // A lifecycle date is the fact itself, not a value that comes into force
      // on it: a pre-hire's start date is in the future and still the date the
      // column holds. So the latest one moves the column, whatever its date.
      const inForce =
        definition.effectiveDated && !lifecycle
          ? valueAsOf(corrected.value, definition.key, day)
          : currentValue(corrected.value, definition.key);

      const custom = new Map(Object.entries(person.custom));
      const fields: Record<string, unknown> = {};
      const moves = inForce?.id === entry.id;
      const aggregate = Person.rehydrate(person.snapshot);

      // The lifecycle's dates are the aggregate's columns, not a projection:
      // written into `custom` they would leave the date every reader uses
      // unchanged. A hire-date correction may start a pre-hire or return an
      // active record to pre-hire (§8.1); that status change is its own event
      // with its own id, caused by the correction that carries `supersedes`.
      if (moves && definition.key === 'hire_date') {
        const moved = aggregate.correctHireDate(
          valid.value as string,
          { ...contextFor(asking), causationId: eventId },
          zone,
        );
        if (!moved.ok) return moved;
      } else if (moves && definition.key === 'last_working_day') {
        // Moved to a day still going on their calendar after the job ended
        // their access, a person on notice gets it back (PEO-111).
        const moved = aggregate.correctLastWorkingDay(
          valid.value as string,
          { ...contextFor(asking), causationId: eventId },
          zone,
        );
        if (!moved.ok) return moved;
      } else if (moves) {
        project(fields, custom, definition.key, valid.value);
        // A reporting line corrected is one OpenFGA has to hear about too.
        if (definition.key === 'manager_id') {
          aggregate.moveManager(
            textOf(person.values['manager_id']),
            textOf(valid.value),
            { ...contextFor(asking, deps.newId()), causationId: eventId },
            target.effectiveFrom,
          );
        }
        // Where somebody sat, corrected: the org moves as it would have, from
        // the date it did, and a legal entity re-places the period (PEO-123).
        if (ORG_KEYS.includes(definition.key)) {
          if (definition.key === 'legal_entity_id') {
            const placed = aggregate.place(
              textOf(valid.value),
              target.effectiveFrom,
              textOf(person.values['legal_entity_id']),
            );
            if (!placed.ok) return placed;
          }
          aggregate.moveOrg(
            orgOf({ ...person.values, [definition.key]: valid.value }),
            { ...contextFor(asking, deps.newId()), causationId: eventId },
            target.effectiveFrom,
          );
        }
      }

      const raised = aggregate.correctAttribute(
        changedAttribute(definition, valid.value),
        asking.supersedes,
        asking.reason,
        contextFor(asking, eventId),
        target.effectiveFrom,
      );
      if (!raised.ok) return raised;

      if (moves && IDENTITY_FACT_KEYS.has(definition.key)) {
        shareIdentityFacts(
          aggregate,
          asking,
          { ...person.values, [definition.key]: valid.value },
          target.effectiveFrom,
        );
      }

      await deps.people.save(tx, aggregate, {
        fields:
          moves && !lifecycle
            ? {
                ...(fields as PersonFields),
                custom: Object.fromEntries(custom),
                schemaVersion: version.version,
              }
            : {},
        history: [entry],
      });
      await rejudge(tx, asking, asking.personId, eventId);
      return ok(entry);
    },

    /** What is missing, limited to what this viewer may know exists. */
    async completeness(
      tx: Tx,
      asking: Asking & { readonly personId: string },
    ): Promise<Result<CompletenessVerdict>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );

      const definitions = version.document.attributes;
      const values: Record<string, unknown> = { ...person.values };
      if (definitions.some((d) => d.encrypted)) {
        for (const s of await deps.secrets.list(tx, asking.tenantId, person.snapshot.id))
          values[s.attributeKey] = true;
      }

      const verdict = assessCompleteness(
        definitions,
        {
          legalEntityId: person.legalEntityId,
          country: countryOf(values),
          employmentType: person.employmentType as EmploymentType | null,
          workModel: person.workModel as WorkModel | null,
          status: person.snapshot.status,
          values,
          knownAttributes: new Set(definitions.map((d) => d.key as string)),
        },
        deps.clock,
        (await calendarOf(tx, asking.tenantId, person.values)).zone,
      );

      const byKey = new Map(definitions.map((d) => [d.key as string, d]));
      const missing = verdict.missing.filter((m) => {
        const definition = byKey.get(m.key);
        return definition !== undefined && visibleTo(definition, relations);
      });
      return ok({ ...verdict, missing, unevaluable: [] });
    },

    /**
     * Hire a provisional record: `status_changed`, `hired` and, for a linked
     * person, `identity_facts_changed` — all through the outbox, in this
     * transaction, each with its own id.
     *
     * §8.2 step 7: identity learns the confirmed start date and the name here,
     * and a hire is where a new person's start date first exists to send.
     */
    async hire(
      tx: Tx,
      asking: Asking & {
        readonly personId: string;
        readonly hireDate: string;
        readonly changes?: Readonly<Record<string, unknown>>;
        readonly effectiveFrom?: string;
      },
    ): Promise<Result<PersonView>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      if (!CALENDAR_DATE.test(asking.hireDate)) {
        return err(failure('VALUE_INVALID', 'hireDate is a calendar date', ['hireDate']));
      }
      // The values first, without telling identity: the hire below tells it
      // once, with the name as it stands after both.
      const { changes: asked = {}, hireDate, ...rest } = asking;
      const changes = { ...asked, ...(await numberFor(tx, asking, version, asked)) };
      if (Object.keys(changes).length > 0) {
        const updated = await update(tx, { ...rest, changes }, false);
        if (!updated.ok) return updated;
      }
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId, true);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );
      if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR hires a person'));

      const facts = hireFactsOf(person.values, person.legalEntityId, version.version);
      if (!facts.ok) return facts;

      const aggregate = Person.rehydrate(person.snapshot);
      const { zone } = await calendarOf(tx, asking.tenantId, person.values);
      const hired = aggregate.hire(hireDate, facts.value, contextFor(asking), zone);
      if (!hired.ok) return hired;
      shareIdentityFacts(aggregate, asking, person.values, hireDate);

      await deps.people.save(tx, aggregate);
      await rejudge(tx, asking, asking.personId, null);

      const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!after) return err(PersonNotFound());
      return ok(await view(tx, asking, after, version, relations));
    },

    /**
     * Place a person (PEO-123, §6.8, §8.5): HR only, like the rest of where
     * somebody sits (§7).
     *
     * A location names its entity, so a location in another entity moves the
     * entity with it, and an entity change leaves no location of the old one
     * behind. Archived entities and locations still decide their people's
     * day, and take nobody new. The date is on the calendar the move takes
     * them to, today there by default. A date ahead is recorded now and
     * comes into force on its day (PEO-124): the hourly job moves the
     * projection, their calendar and, for a new entity, the employment
     * period then. A retry that asks for where they already are — or, ahead,
     * for what is already scheduled that day — is answered with the record.
     *
     * **A second placement dated the same day as the one standing is a
     * correction**: a row carrying `supersedes` and `attribute_corrected`, as
     * for a location's zone (§6.8). An earlier-dated one after it is a move
     * recorded late, with both dates, like §8.5's promotion. The rest —
     * `org_changed`, history, the transfer, the number, the completeness
     * re-judge — is `update` and `correct`, which every writer shares.
     */
    async place(tx, asking) {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      if (asking.effectiveFrom !== undefined && !CALENDAR_DATE.test(asking.effectiveFrom)) {
        return err(failure('VALUE_INVALID', 'effectiveFrom is a calendar date', ['effectiveFrom']));
      }
      const person = await deps.reader.record(tx, asking.tenantId, asking.personId, true);
      if (!person) return err(PersonNotFound());
      const relations = await deps.relations.relations(
        tx,
        asking.tenantId,
        asking.viewer,
        asking.personId,
      );
      if (!relations.isHr) return err(failure('FORBIDDEN', 'Only HR places a person'));

      const defines = (key: string) =>
        version.document.attributes.some((d) => d.key === key && d.deprecatedAt === null);
      const asked: Record<string, string | null> = {};
      for (const [field, key] of PLACEMENT_KEYS) {
        const value = asking[field];
        if (value === undefined) continue;
        if (!defines(key)) {
          return err(failure('VALUE_INVALID', `This schema has no ${key} to place`, [field]));
        }
        asked[key] = value;
      }

      const calendar = await calendars.load(tx, asking.tenantId);
      const current = (key: string) => textOf(person.values[key]);
      const locationId = asked['location_id'];
      if (locationId !== undefined && locationId !== null) {
        const location = calendar.locations.get(locationId);
        if (!location) {
          return err(failure('LOCATION_NOT_FOUND', 'No such location in this workspace', ['locationId']));
        }
        if (location.archived === true && locationId !== current('location_id')) {
          return err(failure('LOCATION_ARCHIVED', `${location.name} is archived`, ['locationId']));
        }
        if (asked['legal_entity_id'] === undefined) {
          if (defines('legal_entity_id')) asked['legal_entity_id'] = location.legalEntityId;
        } else if (asked['legal_entity_id'] !== location.legalEntityId) {
          return err(
            failure('LOCATION_NOT_IN_ENTITY', `${location.name} belongs to another legal entity`, [
              'locationId',
            ]),
          );
        }
      }
      const entity = asked['legal_entity_id'];
      if (entity !== undefined && entity !== null) {
        const found = calendar.entities.get(entity);
        if (!found) {
          return err(
            failure('LEGAL_ENTITY_NOT_FOUND', 'No such legal entity in this workspace', [
              'legalEntityId',
            ]),
          );
        }
        if (found.archived === true && entity !== current('legal_entity_id')) {
          return err(failure('LEGAL_ENTITY_ARCHIVED', `${found.name} is archived`, ['legalEntityId']));
        }
      }
      if (entity !== undefined && locationId === undefined && defines('location_id')) {
        const at = current('location_id');
        const location = at === null ? undefined : calendar.locations.get(at);
        if (location !== undefined && location.legalEntityId !== entity) asked['location_id'] = null;
      }

      const history = await deps.people.history(tx, asking.tenantId, asking.personId);
      const { day } = await calendarOf(tx, asking.tenantId, { ...person.values, ...asked });
      const effectiveFrom = asking.effectiveFrom ?? day;
      // What stands on the date asked for: today, the row; ahead, whatever is
      // already scheduled for that day (PEO-124), so a retry is a no-op there too.
      const standingOn = (key: string) =>
        effectiveFrom > day ? textOf(valueAsOf(history, key, effectiveFrom)?.value) : current(key);
      const changes = Object.fromEntries(
        Object.entries(asked).filter(([key, value]) => value !== standingOn(key)),
      );
      if (Object.keys(changes).length > 0) {
        const moves: Record<string, unknown> = {};
        const corrections: { supersedes: string; value: unknown }[] = [];
        for (const [key, value] of Object.entries(changes)) {
          const standing = valueAsOf(history, key, effectiveFrom);
          if (standing?.effectiveFrom === effectiveFrom) {
            corrections.push({ supersedes: standing.id, value });
          } else moves[key] = value;
        }
        const on = {
          tenantId: asking.tenantId,
          viewer: asking.viewer,
          correlationId: asking.correlationId,
          personId: asking.personId,
        };
        if (Object.keys(moves).length > 0) {
          const moved = await update(tx, { ...on, changes: moves, effectiveFrom });
          if (!moved.ok) return moved;
        }
        for (const correction of corrections) {
          // eslint-disable-next-line no-await-in-loop -- one correction per attribute, in order
          const fixed = await api.correct(tx, { ...on, ...correction, reason: 'Placement corrected' });
          if (!fixed.ok) return fixed;
        }
      }

      const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
      if (!after) return err(PersonNotFound());
      return ok(await view(tx, asking, after, version, relations));
    },

    /**
     * Dated values whose day has come, brought into the projection (PEO-124,
     * §8.5, §11.2: history is the truth, the row a projection of it).
     *
     * `arrived` names them: for each dated key with a row scheduled ahead and
     * now in force, the value in force today — the latest, a correction in
     * place of what it corrected — where the row does not hold it already.
     * Judged on the calendar they take the person to, as a write is. Then
     * what a present-dated write does, a date at a time, earliest first,
     * each event effective from its own day: `attribute_effective` for the
     * keys, `manager_changed` (OpenFGA's consumer rewrites the reporting
     * tuple from it and the row), `org_changed` and the transfer for a new
     * legal entity (PEO-123), identity's facts; one save, one completeness
     * re-judge, and a transfer's new number as a second write, dated the
     * same. The person's calendar and every read follow the row.
     *
     * Nothing arrived is `applied: 0` and writes nothing, so a rerun is a
     * no-op. A move the domain refuses on the day — a transfer for somebody
     * who has since given notice — is recorded once against its rows
     * (`refusals`), raises `scheduled_change_refused` once, and the person
     * is brought up to date without it; the rows are never tried again, and
     * HR's grid asks for a correction until one is recorded.
     */
    async bringIntoForce(tx, on) {
      const { tenantId, personId, correlationId } = on;
      const version = await deps.schemas.current(tx, tenantId);
      const person = await deps.reader.record(tx, tenantId, personId, true);
      const today = async (values: Readonly<Record<string, unknown>>) =>
        (await calendarOf(tx, tenantId, values)).day;
      if (!version || !person) return ok({ day: await today({}), applied: 0 });
      const status = person.snapshot.status;
      if (status === 'terminated' || status === 'discarded') {
        return ok({ day: await today(person.values), applied: 0 });
      }

      const definitions = version.document.attributes;
      const keys = definitions
        .filter((d) => d.effectiveDated && !d.encrypted && !LIFECYCLE_KEYS.has(d.key))
        .map((d) => d.key as string);
      const all = await deps.people.history(tx, tenantId, personId);
      const refused = new Set(
        (await deps.refusals?.refused(tx, tenantId, personId)) ?? [],
      );
      const asking: SystemAsking = {
        tenantId,
        viewer: { accountId: NOBODY, roles: new Set() },
        correlationId,
        [AS_SYSTEM]: EFFECTIVE_ACTOR,
      };
      // At most one pass per refused row, and one to finish.
      attempt: for (;;) {
        const history = all.filter((e) => !refused.has(e.id));
        const here = arrived(history, keys, await today(person.values), person.values);
        const day = await today({
          ...person.values,
          ...Object.fromEntries(here.map((e) => [e.attributeKey, e.value])),
        });
        const due = arrived(history, keys, day, person.values);
        if (due.length === 0) return ok({ day, applied: 0 });

        const byKey = new Map(definitions.map((d) => [d.key as string, d]));
        const aggregate = Person.rehydrate(person.snapshot);
        const custom = new Map(Object.entries(person.custom));
        const fields: Record<string, unknown> = {};
        let values: Record<string, unknown> = { ...person.values };
        let renumberInto: { entity: string | null; on: string } | null = null;

        for (const date of new Set(due.map((e) => e.effectiveFrom))) {
          const group = due.filter((e) => e.effectiveFrom === date);
          const before = values;
          values = { ...values };
          const changed = [];
          for (const entry of group) {
            const definition = byKey.get(entry.attributeKey);
            if (!definition) continue;
            project(fields, custom, entry.attributeKey, entry.value);
            values[entry.attributeKey] = entry.value;
            changed.push(changedAttribute(definition, entry.value));
          }
          const raised = aggregate.attributesInForce(changed, version.version, contextFor(asking), date);
          if (!raised.ok) return raised;

          const moved = (key: string) => group.some((e) => e.attributeKey === key);
          if (moved('manager_id')) {
            aggregate.moveManager(
              textOf(before['manager_id']),
              textOf(values['manager_id']),
              contextFor(asking),
              date,
            );
          }
          if (moved('legal_entity_id')) {
            const placed = aggregate.place(
              textOf(values['legal_entity_id']),
              date,
              textOf(before['legal_entity_id']),
            );
            if (!placed.ok) {
              // Refused on its day (§8.5): recorded once, told once, and the
              // person tried again without it — never an hourly failure.
              const refusedHere = group.filter(
                (e) => e.attributeKey === 'legal_entity_id' || e.attributeKey === 'location_id',
              );
              if (deps.refusals === undefined) return placed;
              const told = Person.rehydrate(person.snapshot);
              for (const entry of refusedHere) {
                const first = await deps.refusals.record(tx, tenantId, {
                  historyId: entry.id,
                  personId,
                  attributeKey: entry.attributeKey,
                  reason: placed.error.code,
                  refusedAt: deps.clock.instant(),
                });
                if (first) {
                  told.refuseScheduled(
                    { historyId: entry.id, attributeKey: entry.attributeKey, code: placed.error.code },
                    contextFor(asking),
                    date,
                  );
                }
                refused.add(entry.id);
              }
              await deps.people.save(tx, told);
              continue attempt;
            }
            if (
              placed.value === 'transferred' ||
              (placed.value === 'placed' && textOf(before['legal_entity_id']) !== null)
            ) {
              renumberInto = { entity: textOf(values['legal_entity_id']), on: date };
            }
          }
          if (ORG_KEYS.some(moved)) aggregate.moveOrg(orgOf(values), contextFor(asking), date);
          if ([...IDENTITY_FACT_KEYS].some(moved)) shareIdentityFacts(aggregate, asking, values, date);
        }

        await deps.people.save(tx, aggregate, {
          fields: {
            ...(fields as PersonFields),
            custom: Object.fromEntries(custom),
            schemaVersion: version.version,
          },
        });
        await rejudge(tx, asking, personId, null);

        // Moved to another entity: its number, when its scheme would not
        // write the one they hold, dated the day they moved (PEO-123).
        const next =
          renumberInto === null
            ? null
            : await renumbered(tx, tenantId, version, renumberInto.entity, values['employee_number']);
        if (next !== null && renumberInto !== null) {
          const written = await update(tx, {
            ...asking,
            personId,
            changes: { employee_number: next },
            effectiveFrom: renumberInto.on,
          });
          if (!written.ok) return written;
        }
        return ok({ day, applied: due.length });
      }
    },
  };
  return api;
}

/** The same convention `drizzlePeopleFacts` reads: an address's country, else a plain one. */
function countryOf(values: Record<string, unknown>): string | null {
  const address = values['home_address'];
  if (typeof address === 'object' && address !== null) {
    const country = (address as { country?: unknown }).country;
    if (typeof country === 'string') return country;
  }
  const direct = values['country'];
  return typeof direct === 'string' ? direct : null;
}

/**
 * Run a use case in one tenant transaction, rolling back when it refuses.
 *
 * A refused write may already have claimed a unique value or written a
 * secret; committing that half would leave a claim nobody holds. Throwing out
 * of the callback is how Drizzle is told to roll back, and the refusal comes
 * back out as the `Result` it was.
 */
export async function inTenantResult<T>(
  inTenant: <R>(tenantId: string, fn: (scope: { tx: Tx }) => Promise<R>) => Promise<R>,
  tenantId: string,
  fn: (tx: Tx) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await inTenant(tenantId, async ({ tx }) => {
      const result = await fn(tx);
      if (!result.ok) throw new Refused(result.error);
      return result;
    });
  } catch (cause) {
    if (cause instanceof Refused) return err(cause.failure);
    throw cause;
  }
}

class Refused extends Error {
  readonly failure: DomainFailure;
  constructor(failure: DomainFailure) {
    super(failure.message);
    this.failure = failure;
  }
}
