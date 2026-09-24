import { randomBytes } from 'node:crypto';

import type { Clock, PendingEvent } from '@kithena/domain-kit';

import { localObjectStore } from '../export/object-store.js';

import {
  define,
  inMemoryPeople,
  TENANT,
  versionOf,
  type InMemoryPeople,
} from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { Viewer } from '../person/ports.js';
import type {
  CommitDeps,
  ImportCounts,
  ImportLedger,
  ReportIndex,
  RowScope,
} from './commit.js';
import { utcCalendars } from '../org/org.js';

/**
 * Priya's 412 rows (PRD §14.4, story 6), for the import tests.
 *
 * Built rather than checked in so the arithmetic is visible: every block
 * below produces exactly one line of the dry run §14.4 prints.
 *
 *     412 rows read
 *       368  create
 *        21  update      (matched on work_email)
 *         4  unchanged
 *        14  blocked     11 missing work email · 3 invalid hire date
 *         5  duplicate
 *     Of the 389 rows that will import, 88 will be incomplete.
 *       61  missing Cost centre
 *       27  missing Home address  (required in Spain)
 */

export const HR: Viewer = {
  accountId: '00000000-0000-4000-8000-0000000000ff',
  roles: new Set(['hr']),
};

export const attributes = [
  define({ key: 'given_name', label: { default: 'Given name' } }),
  define({ key: 'family_name', label: { default: 'Family name' } }),
  define({
    key: 'work_email',
    label: { default: 'Work email' },
    dataType: 'email',
    typeConfig: { kind: 'email' },
    uniqueScope: 'tenant',
  }),
  define({
    key: 'cost_centre',
    label: { default: 'Cost centre' },
    requiredness: { mode: 'always' },
  }),
  define({
    key: 'country',
    label: { default: 'Country' },
    dataType: 'country',
    typeConfig: { kind: 'country' },
  }),
  define({
    key: 'home_address',
    label: { default: 'Home address' },
    dataType: 'address',
    typeConfig: { kind: 'address' },
    requiredness: { mode: 'conditional', when: { clauses: [{ operand: 'country', in: ['ES'] }] } },
  }),
  define({
    key: 'date_of_birth',
    label: { default: 'Date of birth' },
    dataType: 'date',
    typeConfig: { kind: 'date', range: 'past' },
  }),
];

export const HEADERS = [
  'Given name',
  'Family name',
  'Work email',
  'Hire date',
  'Cost centre',
  'Country',
  'Home address',
  'Date of birth',
];

const existingId = (i: number) => `00000000-0000-4000-8000-${String(900 + i).padStart(12, '0')}`;

/** A store holding the 25 people the file updates or leaves alone, and 2 lookalikes. */
export function priyasTenant(): InMemoryPeople {
  const store = inMemoryPeople([versionOf(1, attributes)]);
  for (let i = 1; i <= 25; i++) {
    store.seed(existingId(i), {
      fields: {
        givenName: `Existing${String(i)}`,
        familyName: 'Person',
        workEmail: `e${String(i)}@acme.test`,
      },
      custom: { cost_centre: 'CC-1', country: 'GB' },
    });
  }
  for (const i of [26, 27]) {
    store.seed(existingId(i), {
      fields: {
        givenName: `Twin${String(i)}`,
        familyName: 'Lookalike',
        workEmail: `twin${String(i)}@old.test`,
      },
      custom: { cost_centre: 'CC-1', country: 'GB', date_of_birth: '1990-01-01' },
    });
  }
  return store;
}

const q = (s: string) => (/[",\n]/u.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
const line = (cells: readonly string[]) => cells.map(q).join(',');

export function priyasRows(): string[][] {
  const rows: string[][] = [];
  const person = (over: Partial<Record<(typeof HEADERS)[number], string>>) =>
    HEADERS.map((h) => over[h] ?? '');

  // 368 create: 61 with no cost centre, 27 in Spain with no address.
  for (let i = 0; i < 368; i++) {
    rows.push(
      person({
        'Given name': `New${String(i)}`,
        'Family name': 'Hire',
        'Work email': `c${String(i)}@acme.test`,
        'Hire date': '2026-03-01',
        'Cost centre': i < 61 ? '' : 'CC-2',
        Country: i >= 61 && i < 88 ? 'ES' : 'GB',
      }),
    );
  }
  // 21 update: matched on work email, a new cost centre.
  for (let i = 1; i <= 21; i++) {
    rows.push(
      person({
        'Given name': `Existing${String(i)}`,
        'Family name': 'Person',
        'Work email': `e${String(i)}@acme.test`,
        'Cost centre': 'CC-9',
        Country: 'GB',
      }),
    );
  }
  // 4 unchanged: exactly what is held.
  for (let i = 22; i <= 25; i++) {
    rows.push(
      person({
        'Given name': `Existing${String(i)}`,
        'Family name': 'Person',
        'Work email': `e${String(i)}@acme.test`,
        'Cost centre': 'CC-1',
        Country: 'GB',
      }),
    );
  }
  // 11 blocked: a new person with no work email.
  for (let i = 0; i < 11; i++) {
    rows.push(
      person({
        'Given name': `NoEmail${String(i)}`,
        'Family name': 'Hire',
        'Hire date': '2026-03-01',
        'Cost centre': 'CC-2',
      }),
    );
  }
  // 3 blocked: a hire date that is not a day.
  for (let i = 0; i < 3; i++) {
    rows.push(
      person({
        'Given name': `BadDate${String(i)}`,
        'Family name': 'Hire',
        'Work email': `bad${String(i)}@acme.test`,
        'Hire date': '2026-02-30',
        'Cost centre': 'CC-2',
      }),
    );
  }
  // 5 duplicate: 3 repeat an earlier row, 2 look like somebody already held.
  for (let i = 0; i < 3; i++) {
    rows.push(
      person({
        'Given name': `Again${String(i)}`,
        'Family name': 'Hire',
        'Work email': `c${String(i)}@acme.test`,
        'Hire date': '2026-03-01',
      }),
    );
  }
  for (const i of [26, 27]) {
    rows.push(
      person({
        'Given name': `Twin${String(i)}`,
        'Family name': 'Lookalike',
        'Work email': `twin${String(i)}@new.test`,
        'Hire date': '2026-03-01',
        'Cost centre': 'CC-2',
        'Date of birth': '1990-01-01',
      }),
    );
  }
  return rows;
}

export const csv = (headers: readonly string[], rows: readonly (readonly string[])[]): Uint8Array =>
  new TextEncoder().encode([headers, ...rows].map(line).join('\n'));

export const asking = {
  tenantId: TENANT,
  viewer: HR,
  correlationId: '00000000-0000-4000-8000-0000000000c1',
};

/** The ledger's constraint, in memory: one import per tenant per checksum. */
export function inMemoryLedger(): ImportLedger & {
  readonly imports: Map<string, { importId: string; counts: ImportCounts | null }>;
  readonly events: PendingEvent[];
} {
  const imports = new Map<string, { importId: string; counts: ImportCounts | null }>();
  const events: PendingEvent[] = [];
  return {
    imports,
    events,
    claim(_tx, entry) {
      const key = `${entry.tenantId}:${entry.checksum}`;
      const held = imports.get(key);
      if (held) return Promise.resolve({ claimed: false, importId: held.importId });
      imports.set(key, { importId: entry.importId, counts: null });
      return Promise.resolve({ claimed: true });
    },
    complete(_tx, _tenant, importId, counts) {
      for (const entry of imports.values()) if (entry.importId === importId) entry.counts = counts;
      return Promise.resolve();
    },
    publish(_tx, published) {
      events.push(...published);
      return Promise.resolve();
    },
  };
}

/** No savepoints in memory; a refused row writes nothing before it is refused. */
export const directRowScope: RowScope = (tx, fn) => fn(tx);

/** The report index, in memory: `people.import_report`'s rows. */
export function inMemoryReportIndex(): ReportIndex & {
  readonly rows: Map<string, { personIds: readonly string[]; expiresAt: string }>;
} {
  const rows = new Map<string, { personIds: readonly string[]; expiresAt: string }>();
  const id = (tenantId: string, checksum: string) => `${tenantId}:${checksum}`;
  return {
    rows,
    save(_tx, e) {
      rows.set(id(e.tenantId, e.checksum), { personIds: e.personIds, expiresAt: e.expiresAt });
      return Promise.resolve();
    },
    expiresAt: (_tx, tenantId, checksum) =>
      Promise.resolve(rows.get(id(tenantId, checksum))?.expiresAt ?? null),
    containing: (_tx, tenantId, personId) =>
      Promise.resolve(
        [...rows.entries()]
          .filter(([k, r]) => k.startsWith(`${tenantId}:`) && r.personIds.includes(personId))
          .map(([k]) => k.slice(tenantId.length + 1)),
      ),
    remove(_tx, tenantId, checksums) {
      for (const c of checksums) rows.delete(id(tenantId, c));
      return Promise.resolve();
    },
  };
}

/** Sealed and in memory, as a dev box keeps export files, with the index beside. */
export function reportStore(clock: Clock): {
  readonly store: ReturnType<typeof localObjectStore>;
  readonly index: ReturnType<typeof inMemoryReportIndex>;
} {
  return {
    store: localObjectStore({
      encryptionKey: randomBytes(32),
      signingKey: randomBytes(32),
      clock,
      baseUrl: 'https://people.test/v1/exports/files',
    }),
    index: inMemoryReportIndex(),
  };
}

export function commitDeps(
  store: InMemoryPeople,
  ledger: ImportLedger = inMemoryLedger(),
  reports: CommitDeps['reports'] = reportStore(store.deps.clock),
): CommitDeps {
  return {
    reports,
    calendars: utcCalendars,
    access: personAccess(store.deps),
    schemas: store.deps.schemas,
    relations: store.deps.relations,
    clock: store.deps.clock,
    newId: store.deps.newId,
    ledger,
    rowScope: directRowScope,
  };
}
