import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { fixedClock, ok, type PendingEvent } from '@kithena/domain-kit';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import type { HistoryEntry } from '../../domain/person/history.js';
import type { EmploymentPeriodRow, Person, PersonSnapshot } from '../../domain/person/person.js';
import {
  checksumOf,
  type PublishedVersion,
  type SchemaDocument,
} from '../../domain/schema/publish.js';
import type { Attribute, Section } from '../../domain/schema/draft.js';
import type { PersonFields, PersonRepository } from '../person-repository.js';
import { CORE_COLUMNS } from './core.js';
import type { PersonAccessDeps } from './person-access.js';
import type { PersonRecord, PersonSearch } from './ports.js';
import type { IdentifierReviews } from './identifier-review.js';
import type { IdentifierReview } from '../../domain/person/identifier-review.js';
import { utcCalendars } from '../org/org.js';

/**
 * The person ports, in memory, for tests that are about a rule rather than
 * about Postgres.
 *
 * The integration suite is what proves the Drizzle adapters; this is what
 * lets the authorization rule be asserted in the fast suite, and lets two
 * transports be driven over one store in a contract test.
 */

export const TENANT = '00000000-0000-4000-8000-000000000001';
const tx = {} as PostgresJsDatabase;
export { tx as noTransaction };

export const define = (over: Partial<AttributeDefinitionInput> & { key: string }): Attribute =>
  AttributeDefinition.parse({
    sectionKey: 'hr_information',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
    ownership: ['hr'],
    visibility: ['self', 'hr'],
    collectAt: 'hr_only',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'tenant',
    ...over,
  });

export function versionOf(version: number, attributes: readonly Attribute[]): PublishedVersion {
  const section: Section = {
    key: 'hr_information' as Section['key'],
    label: { default: 'HR' } as Section['label'],
    order: 0,
    defaultVisibility: ['hr'],
    origin: 'core',
    archivedAt: null,
  };
  const document: SchemaDocument = { sections: [section], attributes };
  return {
    version,
    document,
    checksum: checksumOf(document),
    publishedAt: '2026-09-01T00:00:00.000Z',
    publishedBy: null,
    rolledBackFrom: null,
  };
}

export interface Row {
  snapshot: PersonSnapshot;
  fields: PersonFields & { custom: Record<string, unknown> };
}

function toRecord(row: Row): PersonRecord {
  const values: Record<string, unknown> = { ...row.fields.custom };
  for (const [key, column] of Object.entries(CORE_COLUMNS)) {
    const value = row.fields[column];
    if (value !== null && value !== undefined) values[key] = value;
  }
  // The lifecycle dates, as `valuesOf` reads them off their columns.
  if (row.snapshot.hireDate !== null) values['hire_date'] = row.snapshot.hireDate;
  if (row.snapshot.lastWorkingDay !== null)
    values['last_working_day'] = row.snapshot.lastWorkingDay;
  return {
    snapshot: row.snapshot,
    values,
    custom: row.fields.custom,
    schemaVersion: row.fields.schemaVersion ?? null,
    legalEntityId: row.fields.legalEntityId ?? null,
    employmentType: row.fields.employmentType ?? null,
    workModel: row.fields.workModel ?? null,
  };
}

export interface InMemoryPeople {
  readonly deps: PersonAccessDeps;
  readonly rows: Map<string, Row>;
  readonly history: (HistoryEntry & { personId: string })[];
  readonly events: PendingEvent[];
  readonly secrets: Map<string, string>;
  /** Doubted national identifiers' reviews (PEO-125), oldest first. */
  readonly reviews: IdentifierReview[];
  readonly versions: PublishedVersion[];
  seed(
    id: string,
    over?: {
      account?: string | null;
      fields?: Partial<PersonFields>;
      custom?: Record<string, unknown>;
    },
  ): void;
}

export function inMemoryPeople(
  versions: PublishedVersion[],
  now = '2026-09-22T09:00:00.000Z',
): InMemoryPeople {
  const rows = new Map<string, Row>();
  const history: (HistoryEntry & { personId: string })[] = [];
  const events: PendingEvent[] = [];
  const secrets = new Map<string, string>();
  const reviews: IdentifierReview[] = [];
  let ids = 0;
  const periods = new Map<string, EmploymentPeriodRow>();
  const keepPeriod = (person: Person) => {
    for (const row of [person.drainClosedPeriod(), person.drainPeriod()]) {
      if (row) periods.set(`${person.id}:${String(row.period)}`, row);
    }
  };

  const people: PersonRepository = {
    load: (_tx, _tenant, id) => Promise.resolve(rows.get(id)?.snapshot ?? null),
    findByAccount: (_tx, _tenant, account) =>
      Promise.resolve(
        [...rows.values()].find((r) => r.snapshot.identityAccountId === account)?.snapshot ?? null,
      ),
    periods: (_tx, _tenant, personId) =>
      Promise.resolve(
        [...periods.entries()]
          .filter(([k]) => k.startsWith(`${personId}:`))
          .map(([, row]) => row)
          .toSorted((a, b) => a.period - b.period),
      ),
    create(_tx, person, fields) {
      keepPeriod(person);
      rows.set(person.id, { snapshot: person.snapshot, fields: { custom: {}, ...fields } });
      history.push(...person.drainHistory().map((e) => ({ ...e, personId: person.id })));
      events.push(...person.drainEvents());
      return Promise.resolve();
    },
    save(_tx, person, change) {
      const row = rows.get(person.id);
      if (!row) throw new Error('save of a person that was never created');
      keepPeriod(person);
      const set = Object.fromEntries(
        Object.entries(change?.fields ?? {}).filter(([, v]) => v !== undefined),
      );
      rows.set(person.id, { snapshot: person.snapshot, fields: { ...row.fields, ...set } });
      history.push(
        ...[...(change?.history ?? []), ...person.drainHistory()].map((e) => ({
          ...e,
          personId: person.id,
        })),
      );
      events.push(...person.drainEvents());
      return Promise.resolve();
    },
    history: (_tx, _tenant, personId, key) =>
      Promise.resolve(
        history.filter(
          (e) => e.personId === personId && (key === undefined || e.attributeKey === key),
        ),
      ),
  };

  /** What the Drizzle reader's predicate answers, over the rows in memory. */
  const matches = (
    r: Row,
    where: Readonly<Record<string, string>>,
    search: PersonSearch | undefined,
  ): boolean => {
    if (!Object.entries(where).every(([k, v]) => r.fields.custom[k] === v)) return false;
    const text = search?.text.trim().toLocaleLowerCase('en') ?? '';
    if (text === '') return true;
    const values = toRecord(r).values;
    const keys = new Set<string>(search?.keys ?? []);
    const texts = [...keys].map((k) => values[k]);
    for (const given of ['given_name', 'preferred_name']) {
      if (keys.has(given) && keys.has('family_name')) {
        texts.push(
          [values[given], values['family_name']]
            .filter((v): v is string => typeof v === 'string')
            .join(' '),
        );
      }
    }
    return texts.some((t) => typeof t === 'string' && t.toLocaleLowerCase('en').includes(text));
  };

  const deps: PersonAccessDeps = {
    calendars: utcCalendars,
    people,
    reader: {
      record(_tx, _tenant, id) {
        const row = rows.get(id);
        return Promise.resolve(row ? toRecord(row) : null);
      },
      page: (_tx, _tenant, after, limit, where = {}, search) =>
        Promise.resolve(
          [...rows.values()]
            .filter((r) => after === null || r.snapshot.id > after)
            .filter((r) => matches(r, where, search))
            .toSorted((a, b) => a.snapshot.id.localeCompare(b.snapshot.id))
            .slice(0, limit)
            .map(toRecord),
        ),
      count: (_tx, _tenant, where = {}, search) => {
        const found = [...rows.values()].filter((r) => matches(r, where, search));
        return Promise.resolve({
          all: found.length,
          active: found.filter((r) => r.snapshot.status === 'active').length,
        });
      },
      personOf: (_tx, _tenant, accountId) =>
        Promise.resolve(
          [...rows.values()].find((r) => r.snapshot.identityAccountId === accountId)?.snapshot.id ??
            null,
        ),
    },
    schemas: {
      current: () => Promise.resolve(versions.at(-1) ?? null),
      byNumber: (_tx, _tenant, n) => Promise.resolve(versions.find((v) => v.version === n) ?? null),
      list: () => Promise.resolve(versions.toReversed()),
    },
    relations: {
      relations(_tx, _tenant, viewer, personId) {
        const target = rows.get(personId);
        const mine = [...rows.values()].find(
          (r) => r.snapshot.identityAccountId === viewer.accountId,
        );
        return Promise.resolve({
          isSelf: target?.snapshot.identityAccountId === viewer.accountId,
          isManager: mine !== undefined && target?.fields.managerId === mine.snapshot.id,
          isInManagerChain: false,
          isHr: viewer.roles.has('hr'),
          isFinance: viewer.roles.has('finance'),
          isAdmin: viewer.roles.has('people_admin'),
        });
      },
    },
    secrets: {
      put(_tx, where, plaintext) {
        secrets.set(`${where.personId}:${where.attributeKey}`, plaintext);
        return Promise.resolve({ last4: plaintext.slice(-4) });
      },
      list: (_tx, _tenant, personId) =>
        Promise.resolve(
          [...secrets.entries()]
            .filter(([k]) => k.startsWith(`${personId}:`))
            .map(([k, v]) => ({ attributeKey: k.slice(personId.length + 1), last4: v.slice(-4) })),
        ),
    },
    reviews: inMemoryReviews(reviews),
    uniques: {
      lock: () => Promise.resolve(),
      claim: () => Promise.resolve(ok(undefined)),
      release: () => Promise.resolve(),
    },
    clock: fixedClock(now),
    newId: () => {
      ids += 1;
      return `01890000-0000-7000-8000-${String(ids).padStart(12, '0')}`;
    },
  };

  function seed(
    id: string,
    over: {
      account?: string | null;
      fields?: Partial<PersonFields>;
      custom?: Record<string, unknown>;
    } = {},
  ): void {
    rows.set(id, {
      snapshot: {
        id,
        tenantId: TENANT,
        status: 'active',
        identityAccountId: over.account ?? null,
        hireDate: '2026-01-01',
        lastWorkingDay: null,
      },
      fields: { ...over.fields, custom: over.custom ?? {} },
    });
  }

  return { deps, rows, history, events, secrets, reviews, seed, versions };
}

/**
 * Reviews in memory. The fingerprint is the normalised value in the clear —
 * a test double; the real one is a keyed hash (`drizzle-identifier-reviews`).
 */
function inMemoryReviews(rows: IdentifierReview[]): IdentifierReviews {
  const of = (personId: string, key: string) =>
    rows.filter((r) => r.personId === personId && r.attributeKey === key);
  const open = (r: IdentifierReview) => r.state === 'pending' || r.state === 'sent_back';
  return {
    latest: (_tx, _tenant, personId, key) => Promise.resolve(of(personId, key).at(-1) ?? null),
    open: (_tx, _tenant, personId) =>
      Promise.resolve(rows.filter((r) => r.personId === personId && open(r))),
    pending: (_tx, _tenant, limit) =>
      Promise.resolve(rows.filter((r) => r.state === 'pending').slice(0, limit)),
    insert(_tx, _tenant, review) {
      rows.push(review);
      return Promise.resolve();
    },
    supersede(_tx, _tenant, personId, key) {
      for (const [i, r] of rows.entries()) {
        if (r.personId === personId && r.attributeKey === key && open(r)) {
          rows[i] = { ...r, state: 'superseded' };
        }
      }
      return Promise.resolve();
    },
    decide(_tx, _tenant, next) {
      const i = rows.findIndex((r) => r.id === next.id && r.state === 'pending');
      if (i < 0) return Promise.resolve(false);
      rows[i] = next;
      return Promise.resolve(true);
    },
    publish: () => Promise.resolve(),
    fingerprint: (_tenant, key, normalised) => ({ valueHash: `${key}:${normalised}`, keyId: 'k1' }),
    matches: (_tenant, review, normalised) =>
      review.valueHash === `${review.attributeKey}:${normalised}`,
    reveal: () => Promise.resolve(null),
  };
}
