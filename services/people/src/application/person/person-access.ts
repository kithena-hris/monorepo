import { createHash } from 'node:crypto';

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Clock, type DomainFailure, type Result } from '@kithena/domain-kit';
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
} from '../../domain/person/person.js';
import { changedAttribute } from '../../domain/person/profile.js';
import type { PublishedVersion } from '../../domain/schema/publish.js';
import type { PersonFields, PersonRepository } from '../person-repository.js';
import { CORE_COLUMNS, isCoreKey, LIFECYCLE_KEYS } from './core.js';
import type {
  PersonReader,
  PersonRecord,
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
}

export interface Asking {
  readonly tenantId: string;
  readonly viewer: Viewer;
  readonly correlationId: string;
  /** The tenant's calendar, for "today". */
  readonly timeZone?: string;
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
    },
  ): Promise<Result<{ items: readonly PersonView[]; next: string | null }>>;
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
  hire(tx: Tx, asking: On<{ readonly hireDate: string }>): Promise<Result<PersonView>>;
}

const NotPublished = () =>
  failure('SCHEMA_NOT_PUBLISHED', 'This workspace has not published a People schema yet');
const PersonNotFound = () => failure('NOT_FOUND', 'No such person');
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalised as `unique.ts` normalises, then hashed. */
function digest(value: string): string {
  return createHash('sha256')
    .update(value.normalize('NFC').trim().toLocaleLowerCase('en'))
    .digest('hex');
}

export function personAccess(deps: PersonAccessDeps): PersonAccess {
  const today = (asking: Asking) => deps.clock.date(asking.timeZone ?? 'Etc/UTC') as string;
  const actorOf = (viewer: Viewer): Actor => ({ kind: 'user', userId: viewer.accountId });

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
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return deps.uniques.claim(tx, asking.tenantId, {
      ...where,
      scopeId,
      // A claim row is plaintext. A sealed value is claimed by its digest, so
      // uniqueness on a national identifier does not copy it out of the vault.
      value: definition.encrypted ? digest(text) : text,
    });
  }

  async function update(
    tx: Tx,
    asking: Asking & {
      readonly personId: string;
      readonly changes: Readonly<Record<string, unknown>>;
      /** When a dated change takes effect. Defaults to today. */
      readonly effectiveFrom?: string;
    },
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
    const day = today(asking);
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

    if ([...projected.keys()].some((k) => IDENTITY_FACT_KEYS.has(k))) {
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

    // Asked again: a write can move a manager, and the answer is shown under
    // the relations that hold after it, not the ones that held before.
    const after = await deps.reader.record(tx, asking.tenantId, asking.personId);
    if (!after) return err(PersonNotFound());
    const now = await deps.relations.relations(tx, asking.tenantId, asking.viewer, asking.personId);
    return ok(await view(tx, asking, after, version, now));
  }

  return {
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
      },
    ): Promise<Result<{ items: readonly PersonView[]; next: string | null }>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      const rows = await deps.reader.page(tx, asking.tenantId, asking.after ?? null, asking.limit);
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

    update,

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

      const day = today(asking);
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
      // unchanged. A hire-date correction may start a pre-hire (§8.1), and
      // that status change is its own event with its own id.
      if (moves && definition.key === 'hire_date') {
        const moved = aggregate.correctHireDate(
          valid.value as string,
          contextFor(asking),
          asking.timeZone,
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
        asking.timeZone,
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
      asking: Asking & { readonly personId: string; readonly hireDate: string },
    ): Promise<Result<PersonView>> {
      const version = await deps.schemas.current(tx, asking.tenantId);
      if (!version) return err(NotPublished());
      if (!CALENDAR_DATE.test(asking.hireDate)) {
        return err(failure('VALUE_INVALID', 'hireDate is a calendar date', ['hireDate']));
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
      const hired = aggregate.hire(
        asking.hireDate,
        facts.value,
        contextFor(asking),
        asking.timeZone,
      );
      if (!hired.ok) return hired;
      shareIdentityFacts(aggregate, asking, person.values, asking.hireDate);

      await deps.people.save(tx, aggregate);

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
