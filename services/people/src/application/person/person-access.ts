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
import type { PersonFields, PersonRepository } from '../person-repository.js';
import { CORE_COLUMNS, isCoreKey, LIFECYCLE_KEYS } from './core.js';
import type {
  PersonReader,
  PersonRecord,
  PersonSearch,
  RelationsResolver,
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
  startLeave(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  endLeave(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
  /** A provisional record that was never a person (§8.1); the one state a hard delete may follow. */
  discard(tx: Tx, asking: On<object>): Promise<Result<PersonView>>;
}

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
  const actorOf = (viewer: Viewer): Actor => ({ kind: 'user', userId: viewer.accountId });

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
      actor: actorOf(asking.viewer),
      correlationId: asking.correlationId,
      causationId,
    });
  }

  /** One event id when a history row names the event; a fresh one per event otherwise. */
  function contextFor(asking: Asking, eventId?: string): EventContext {
    return {
      clock: deps.clock,
      newEventId: eventId === undefined ? deps.newId : () => eventId,
      actor: actorOf(asking.viewer),
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
    /*
     * A number somebody already holds — typed in another entity, or imported
     * before the scheme existed — is skipped: the register is unique in the
     * tenant (`person_employee_number_key`), and a skipped number is taken,
     * not lost.
     *
     * ponytail: bounded at 100 skips, after which the hire goes unnumbered
     * and HR types one. Only a register full of hand-typed numbers in this
     * scheme's format gets near it.
     */
    for (let skips = 0; skips < 100; skips += 1) {
      // eslint-disable-next-line no-await-in-loop -- each allocation depends on the last
      const next = await deps.numbering.allocate(tx, asking.tenantId, entity);
      if (!next) return {};
      const employeeNumber = formatNumber(next, next.sequence);
      // eslint-disable-next-line no-await-in-loop -- as above
      if (!(await deps.numbering.taken(tx, asking.tenantId, employeeNumber))) {
        return { employee_number: employeeNumber };
      }
    }
    return {};
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

    const relations = await deps.relations.relations(
      tx,
      asking.tenantId,
      asking.viewer,
      asking.personId,
    );

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
        actor: actorOf(asking.viewer),
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
    if (['org_unit_id', 'cost_centre', 'legal_entity_id', 'location_id'].some(moved)) {
      const now = (key: string) =>
        text(projected.has(key) ? projected.get(key) : person.values[key]);
      aggregate.moveOrg(
        {
          orgUnitId: now('org_unit_id'),
          costCentre: now('cost_centre'),
          legalEntityId: now('legal_entity_id'),
          locationId: now('location_id'),
        },
        contextFor(asking, deps.newId()),
        effectiveFrom,
      );
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

    // Asked again: a write can move a manager, and the answer is shown under
    // the relations that hold after it, not the ones that held before.
    const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
    if (!after) return err(PersonNotFound());
    const now = await deps.relations.relations(tx, asking.tenantId, asking.viewer, asking.personId);
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

  return {
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
     * A page of people, each filtered for this viewer.
     *
     * ponytail: one relations lookup per person on the page. Batch it when
     * OpenFGA's `ListObjects` is wired and a page of 100 is measurably slow.
     */
    async list(
      tx: Tx,
      asking: Asking & {
        readonly after?: string | null;
        readonly limit: number;
        readonly asOf?: string;
        readonly where?: Readonly<Record<string, string>>;
        readonly search?: string;
      },
    ): Promise<Result<{ items: readonly PersonView[]; next: string | null }>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const query = await narrowing(tx, asking, version);
      if (!query.ok) return query;
      const rows = await deps.reader.page(
        tx,
        asking.tenantId,
        asking.after ?? null,
        asking.limit,
        query.value.where,
        query.value.search,
      );
      const items: PersonView[] = [];
      for (const row of rows) {
        const relations = await deps.relations.relations(
          tx,
          asking.tenantId,
          asking.viewer,
          row.snapshot.id,
        );
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
        actor: actorOf(asking.viewer),
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
        const moved = aggregate.correctLastWorkingDay(valid.value as string);
        if (!moved.ok) return moved;
      } else if (moves) {
        project(fields, custom, definition.key, valid.value);
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
  };
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
