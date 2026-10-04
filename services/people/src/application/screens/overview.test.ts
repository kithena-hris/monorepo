import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { UploadIntent } from '../../domain/import/upload.js';
import { inMemoryPhotos } from '../../infrastructure/drizzle-photos.js';
import type { UploadIntents, UploadStore } from '../import/upload.js';
import { utcCalendars } from '../org/org.js';
import { define, inMemoryPeople, TENANT, versionOf } from '../person/in-memory.js';
import { personAccess } from '../person/person-access.js';
import type { PendingChangeDeps } from '../person/pending-changes.js';
import { inMemoryPendingChangeStore } from '../person/pending-store.js';
import type { PeopleService } from '../person/service.js';
import { overviewView } from './overview.js';
import { completePhotoUpload, photoView, startPhotoUpload, type PhotoDeps } from './photo.js';
import { directoryView, orgChartView, peopleHeadcount, profileView } from './people.js';
import { waitingView } from './waiting.js';

/**
 * The overview, through the application layer: the viewer's own record, the
 * line above and below them as they may read it, and what waits for them.
 */

const GRACE = '00000000-0000-4000-8000-0000000000a1';
const ALAN = '00000000-0000-4000-8000-0000000000a2';
const ADA = '00000000-0000-4000-8000-0000000000a3';
const KATE = '00000000-0000-4000-8000-0000000000a4';
const TIM = '00000000-0000-4000-8000-0000000000a5';
const EDSGER = '00000000-0000-4000-8000-0000000000a6';
const GONE = '00000000-0000-4000-8000-0000000000a7';
const ADA_ACCOUNT = '00000000-0000-4000-8000-0000000000b3';
const TIM_ACCOUNT = '00000000-0000-4000-8000-0000000000b5';
const HR_ACCOUNT = '00000000-0000-4000-8000-0000000000b9';

const everyone = ['self', 'manager', 'manager_chain', 'hr', 'directory'] as const;
const attributes = [
  define({ key: 'given_name', visibility: [...everyone] }),
  define({ key: 'family_name', visibility: [...everyone] }),
  define({
    key: 'manager_id',
    dataType: 'person_ref',
    typeConfig: { kind: 'person_ref' },
    visibility: [...everyone],
  }),
  // A title is the company's to read; a salary grade is not.
  define({ key: 'job_title', visibility: [...everyone] }),
  define({ key: 'grade', visibility: ['self', 'hr'] }),
  // Theirs to give, required of everybody.
  define({
    key: 'emergency_contact',
    ownership: ['employee'],
    collectAt: 'onboarding',
    requiredness: { mode: 'always' },
  }),
  // HR's to fill, and required.
  define({ key: 'cost_centre', requiredness: { mode: 'always' } }),
  // Required, and HR's alone to read: never in anybody else's list.
  define({ key: 'right_to_work', visibility: ['hr'], requiredness: { mode: 'always' } }),
  define({
    key: 'base_salary',
    dataType: 'money',
    typeConfig: { kind: 'money' },
    visibility: ['self', 'hr'],
    ownership: ['employee', 'hr'],
    requiresApproval: true,
    classification: {
      classification: 'confidential',
      piiKind: 'none',
      exportable: true,
      aiEligible: false,
    },
  }),
];

const person = (given: string, family: string, manager: string | null, title?: string) => ({
  fields: manager === null ? {} : { managerId: manager },
  custom: {
    given_name: given,
    family_name: family,
    ...(title === undefined ? {} : { job_title: title, grade: 'G7' }),
  },
});

function world() {
  const store = inMemoryPeople([versionOf(1, attributes)]);
  store.seed(GRACE, person('Grace', 'Hopper', null, 'Chief Executive'));
  store.seed(ALAN, person('Alan', 'Turing', GRACE, 'VP Engineering'));
  store.seed(ADA, { account: ADA_ACCOUNT, ...person('Ada', 'Lovelace', ALAN, 'Engineer') });
  store.seed(KATE, person('Katherine', 'Johnson', ALAN));
  store.seed(TIM, { account: TIM_ACCOUNT, ...person('Tim', 'Berners-Lee', ADA) });
  store.seed(EDSGER, person('Edsger', 'Dijkstra', ADA));
  // A leaver still names Ada as manager: HR's to see, nobody else's.
  store.seed(GONE, { ...person('Old', 'Hand', ADA), status: 'terminated' });

  const pending = inMemoryPendingChangeStore();
  const pendingDeps: PendingChangeDeps = {
    store: pending,
    publish: () => Promise.resolve(),
    clock: store.deps.clock,
    newId: store.deps.newId,
    access: undefined as never,
    schemas: store.deps.schemas,
    reader: store.deps.reader,
    relations: store.deps.relations,
    roles: { holdings: () => Promise.resolve(new Map([[HR_ACCOUNT, new Set(['hr'])]])) },
  };
  const access = personAccess({ ...store.deps, approvals: pendingDeps });
  const service: PeopleService = {
    access,
    schemas: store.deps.schemas,
    inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    pending: { ...pendingDeps, access },
  };
  const photos = inMemoryPhotos();
  const objects = new Map<string, Uint8Array>();
  const intents = new Map<string, UploadIntent>();
  const uploadStore: UploadStore = {
    presignPut: (key) =>
      Promise.resolve({ url: `https://bucket.test/${key}`, method: 'PUT', headers: {} }),
    read: (key) => {
      const bytes = objects.get(key);
      return Promise.resolve(
        bytes === undefined
          ? null
          : { bytes, checksum: createHash('sha256').update(bytes).digest('hex') },
      );
    },
    remove: (key) => {
      objects.delete(key);
      return Promise.resolve();
    },
    purge: () => Promise.resolve(0),
  };
  const ledger: UploadIntents = {
    save: (_tx, intent) => {
      intents.set(intent.id, intent);
      return Promise.resolve();
    },
    find: (_tx, _tenant, id) => Promise.resolve(intents.get(id) ?? null),
    complete: (_tx, _tenant, id, checksum) => {
      const found = intents.get(id);
      if (found) intents.set(id, { ...found, checksum });
      return Promise.resolve();
    },
    release: () => Promise.resolve([]),
    remove: (_tx, _tenant, id) => {
      intents.delete(id);
      return Promise.resolve();
    },
  };
  let ids = 0;
  const deps: PhotoDeps = {
    service,
    relations: store.deps.relations,
    clock: store.deps.clock,
    calendars: utcCalendars,
    personOf: (_tx, _tenant, account) =>
      Promise.resolve(
        [...store.rows.values()].find((r) => r.snapshot.identityAccountId === account)?.snapshot
          .id ?? null,
      ),
    gapTotals: () => Promise.resolve({ waiting: 3, staff: [{ key: 'cost_centre', people: 5 }] }),
    photos,
    uploads: { store: uploadStore, intents: ledger },
    newId: () => {
      ids += 1;
      return `00000000-0000-4000-8000-${String(ids).padStart(12, 'f')}`;
    },
  };
  const as = (accountId: string, ...roles: string[]) => ({
    tenantId: TENANT,
    viewer: { accountId, roles: new Set(roles) },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  });
  return { store, access, deps, photos, objects, as };
}

const overview = async (
  w: ReturnType<typeof world>,
  asking: ReturnType<ReturnType<typeof world>['as']>,
) => {
  const read = await overviewView(w.deps, asking);
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
};

describe('the overview', () => {
  it('is the viewer’s own record, as they may read it', async () => {
    const w = world();
    const { me, roles, team } = await overview(w, w.as(ADA_ACCOUNT));
    expect(me).toMatchObject({ id: ADA, name: 'Ada Lovelace', title: 'Engineer', avatarUrl: null });
    expect(roles).toEqual({ hr: false, admin: false, finance: false });
    expect(team).toBeNull();
  });

  it('walks the line up, nearest first, and counts who shares their manager', async () => {
    const w = world();
    const { reportingLine } = await overview(w, w.as(ADA_ACCOUNT));
    expect(reportingLine?.managers.map((m) => [m.name, m.title])).toEqual([
      ['Alan Turing', 'VP Engineering'],
      ['Grace Hopper', 'Chief Executive'],
    ]);
    expect(reportingLine?.moreAbove).toBe(false);
    expect(reportingLine?.peers).toBe(1);
  });

  it('names the viewer’s reports, and the directory filter for all of them, leavers left out', async () => {
    const w = world();
    const { reportingLine } = await overview(w, w.as(ADA_ACCOUNT));
    expect(reportingLine?.reports.map((r) => r.name).toSorted()).toEqual([
      'Edsger Dijkstra',
      'Tim Berners-Lee',
    ]);
    expect(reportingLine?.reportsTotal).toBe(2);
    expect(reportingLine?.reportsFilter).toBe(`manager_id:${ADA}`);
  });

  it('shows of each person in the line only what the viewer may read', async () => {
    const w = world();
    const text = JSON.stringify(await overview(w, w.as(TIM_ACCOUNT)));
    // The grade is theirs and HR's, not their report's.
    expect(text).not.toContain('G7');
    expect(text).toContain('Ada Lovelace');
  });

  it('lists the viewer’s own missing details, who fills each in, and never one they cannot see', async () => {
    const w = world();
    const { missing, me } = await overview(w, w.as(ADA_ACCOUNT));
    expect(missing).toEqual([
      expect.objectContaining({ key: 'emergency_contact', ownedBy: null }),
      expect.objectContaining({ key: 'cost_centre' }),
    ]);
    // HR's to fill, so named as somebody else's.
    expect(missing[1]?.ownedBy).not.toBeNull();
    expect(missing.map((m) => m.key)).not.toContain('right_to_work');
    expect(me?.missing).toBe(2);
  });

  it('asks them to correct what HR sent back, in HR’s words, and nothing still pending (B1)', async () => {
    const w = world();
    const review = (state: 'sent_back' | 'pending', attributeKey: string) => ({
      id: `r-${attributeKey}`,
      personId: ADA,
      attributeKey,
      historyId: 'h1',
      pendingChangeId: null,
      valueHash: 'hash',
      keyId: 'k1',
      findings: [
        { level: 'mismatch' as const, code: 'check', message: 'The check digit is wrong.' },
      ],
      state,
      createdAt: '2026-09-24T08:00:00.000Z',
      decidedBy: state === 'sent_back' ? HR_ACCOUNT : null,
      decidedAt: state === 'sent_back' ? '2026-09-24T09:00:00.000Z' : null,
      note: state === 'sent_back' ? 'The check digit doesn’t match.' : null,
    });
    w.store.reviews.push(review('sent_back', 'job_title'), review('pending', 'grade'));
    const { corrections } = await overview(w, w.as(ADA_ACCOUNT));
    expect(corrections).toEqual([
      expect.objectContaining({ key: 'job_title', reason: 'The check digit doesn’t match.' }),
    ]);
  });

  it('gives HR the team’s gaps and the changes waiting for them, first ones first', async () => {
    const w = world();
    const held = await w.access.update({} as never, {
      ...w.as(ADA_ACCOUNT),
      personId: ADA,
      changes: { base_salary: { amountMinor: 5_500_000, currency: 'EUR' } },
    });
    if (!held.ok) throw new Error(held.error.message);
    expect(held.value.held).toHaveLength(1);

    const hr = await overview(w, w.as(HR_ACCOUNT, 'hr'));
    expect(hr.me).toBeNull();
    expect(hr.team).toEqual({ waiting: 3, toFill: 5 });
    expect(hr.approvals).toMatchObject({
      isHr: true,
      total: 1,
      // Nothing about a plain change looks unusual (checks: `approvals.test.ts`).
      flagged: 0,
      flagReason: null,
      items: [{ personId: ADA, name: 'Ada Lovelace', label: 'base_salary' }],
    });

    // The requester sees their own request; somebody else sees no inbox at all.
    expect((await overview(w, w.as(ADA_ACCOUNT))).approvals).toMatchObject({
      isHr: false,
      total: 1,
      flagged: null,
    });
    expect((await overview(w, w.as(TIM_ACCOUNT))).approvals).toBeNull();
  });
});

/** The smallest PNG `readPhoto` accepts, with a text chunk it should drop. */
function png(): Uint8Array {
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...Buffer.from(type, 'latin1'),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [...u32(256), ...u32(256), 8, 6, 0, 0, 0]),
    ...chunk('tEXt', Array.from(Buffer.from('GPS 52N', 'latin1'))),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('IEND', []),
  ]);
}

describe('a person’s photo', () => {
  const upload = async (
    w: ReturnType<typeof world>,
    asking: ReturnType<ReturnType<typeof world>['as']>,
    personId: string | null,
    bytes: Uint8Array,
  ) => {
    const target = await startPhotoUpload(w.deps, asking, personId, bytes.byteLength);
    if (!target.ok) return target;
    w.objects.set(new URL(target.value.url).pathname.slice(1), bytes);
    return completePhotoUpload(w.deps, asking, personId, target.value.uploadId);
  };

  it('is set by the person, kept without its metadata, and shown wherever they are', async () => {
    const w = world();
    const saved = await upload(w, w.as(ADA_ACCOUNT), null, png());
    if (!saved.ok) throw new Error(saved.error.message);
    expect(saved.value.avatarUrl).toMatch(new RegExp(`^/people/photos/${ADA}\\?v=[0-9a-f]{16}$`));
    expect(Buffer.from(w.photos.rows.get(ADA)?.bytes ?? []).toString('latin1')).not.toContain(
      'GPS',
    );
    // The upload is let go once kept.
    expect(w.objects.size).toBe(0);

    expect((await overview(w, w.as(ADA_ACCOUNT))).me?.avatarUrl).toBe(saved.value.avatarUrl);
    const line = (await overview(w, w.as(TIM_ACCOUNT))).reportingLine;
    expect(line?.managers[0]?.avatarUrl).toBe(saved.value.avatarUrl);
    const profile = await profileView(w.deps, w.as(TIM_ACCOUNT), ADA);
    expect(profile.ok && profile.value.person).toMatchObject({
      avatarUrl: saved.value.avatarUrl,
      canChangePhoto: false,
    });
    const directory = await directoryView(w.deps, w.as(TIM_ACCOUNT), { search: '', filters: {} });
    expect(directory.ok && directory.value.people.find((p) => p.id === ADA)?.avatarUrl).toBe(
      saved.value.avatarUrl,
    );
  });

  it('is HR’s to set for anybody, and nobody else’s — not even their manager’s', async () => {
    const w = world();
    expect((await upload(w, w.as(HR_ACCOUNT, 'hr'), TIM, png())).ok).toBe(true);
    const manager = await upload(w, w.as(ADA_ACCOUNT), TIM, png());
    expect(manager.ok ? 'allowed' : manager.error.code).toBe('FORBIDDEN');
  });

  it('refuses a file that is not a photo, whatever it was called', async () => {
    const w = world();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    const refused = await upload(w, w.as(ADA_ACCOUNT), null, svg);
    expect(refused.ok ? 'kept' : refused.error.code).toBe('PHOTO_TYPE');
    expect(w.photos.rows.size).toBe(0);
    expect(w.objects.size).toBe(0);
  });

  it('opens only to somebody who may read the person', async () => {
    const w = world();
    await upload(w, w.as(ADA_ACCOUNT), null, png());
    const seen = await photoView(w.deps, w.as(TIM_ACCOUNT), ADA);
    expect(seen.ok && seen.value.mediaType).toBe('image/png');
    const nobody = await photoView(w.deps, w.as('00000000-0000-4000-8000-0000000000ff'), GONE);
    expect(nobody.ok).toBe(false);
  });
});

describe('the headcount a phone searches (MV1)', () => {
  it('is everybody the viewer could find, leavers to HR alone', async () => {
    const w = world();
    expect(await peopleHeadcount(w.deps, w.as(HR_ACCOUNT, 'hr'))).toEqual({
      ok: true,
      value: { count: 7 },
    });
    expect(await peopleHeadcount(w.deps, w.as(TIM_ACCOUNT))).toEqual({
      ok: true,
      value: { count: 6 },
    });
  });
});

describe('the org chart', () => {
  const chart = async (
    w: ReturnType<typeof world>,
    asking: ReturnType<ReturnType<typeof world>['as']>,
  ) => {
    const read = await orgChartView(w.deps, asking);
    if (!read.ok) throw new Error(read.error.message);
    return read.value;
  };

  it('is everybody the viewer may list, with their manager, in one read', async () => {
    const w = world();
    const { people, truncated } = await chart(w, w.as(TIM_ACCOUNT));
    expect(truncated).toBe(false);
    // A leaver is HR's to see, as in the directory.
    expect(people.map((p) => p.id).toSorted()).toEqual(
      [GRACE, ALAN, ADA, KATE, TIM, EDSGER].toSorted(),
    );
    expect(people.find((p) => p.id === ADA)).toEqual({
      id: ADA,
      name: 'Ada Lovelace',
      title: 'Engineer',
      managerId: ALAN,
      managerName: 'Alan Turing',
      avatarUrl: null,
      // A status is HR's.
      status: null,
      team: null,
      location: null,
    });
    expect(people.find((p) => p.id === GRACE)).toMatchObject({
      managerId: null,
      managerName: null,
    });
  });

  it('draws what the directory shows, and for HR the status and the leavers', async () => {
    const w = world();
    const asking = w.as(HR_ACCOUNT, 'hr');
    const { people } = await chart(w, asking);
    expect(people.find((p) => p.id === GONE)).toMatchObject({
      status: 'Left',
      managerName: 'Ada Lovelace',
    });
    const directory = await directoryView(w.deps, asking, { search: '', filters: {} });
    if (!directory.ok) throw new Error(directory.error.message);
    expect(directory.value.people.length).toBe(people.length);
    for (const row of directory.value.people) {
      const drawn = people.find((p) => p.id === row.id);
      expect(drawn?.title ?? undefined).toBe(row.values['job_title']);
      expect(drawn?.managerName ?? undefined).toBe(row.values['manager_id']);
    }
  });

  it('counts who is leaving beside everybody, for HR only (C1)', async () => {
    const w = world();
    w.store.seed('00000000-0000-4000-8000-0000000000a8', {
      ...person('Leaving', 'Soon', ADA),
      status: 'notice',
    });
    // The in-memory reader leaves status conditions to the database: counted, not narrowed, here.
    const hr = await directoryView(w.deps, w.as(HR_ACCOUNT, 'hr'), { search: '', filters: {} });
    expect(hr.ok && typeof hr.value.leaving).toBe('number');
    const searched = await directoryView(w.deps, w.as(HR_ACCOUNT, 'hr'), {
      search: 'Ada',
      filters: {},
    });
    expect(searched.ok && searched.value.leaving).toBeNull();
    const tim = await directoryView(w.deps, w.as(TIM_ACCOUNT), { search: '', filters: {} });
    expect(tim.ok && tim.value.leaving).toBeNull();
  });

  it('answers with one instant to read local times from, and no zone for somebody placed nowhere', async () => {
    const w = world();
    const read = await directoryView(w.deps, w.as(HR_ACCOUNT, 'hr'), { search: '', filters: {} });
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.now).toBe(w.deps.clock.instant());
    // Nobody here has a location or an entity: the tenant's default would be a guess.
    expect(new Set(read.value.people.map((p) => p.timeZone))).toEqual(new Set([null]));
  });

  it('leaves out a field the viewer cannot read on everybody, for everybody', async () => {
    const w = world();
    // A title only its holder and HR read: no column, so nobody's on the chart.
    const store = inMemoryPeople([
      versionOf(
        1,
        attributes.map((a) =>
          a.key === 'job_title' ? { ...a, visibility: ['self', 'hr'] as typeof a.visibility } : a,
        ),
      ),
    ]);
    for (const [id, row] of w.store.rows) store.rows.set(id, row);
    const service: PeopleService = {
      access: personAccess(store.deps),
      schemas: store.deps.schemas,
      inTenant: (_tenant, fn) => fn({ tx: {} as never }),
    };
    const read = await orgChartView({ ...w.deps, service }, w.as(ADA_ACCOUNT));
    if (!read.ok) throw new Error(read.error.message);
    expect(read.value.people.length).toBeGreaterThan(0);
    expect(read.value.people.map((p) => p.title)).toEqual(read.value.people.map(() => null));
  });
});

describe('what waits for a decision, counted', () => {
  it('is nothing to ask anybody without a queue, and asks nothing', async () => {
    const w = world();
    const untouched = new Proxy({} as typeof w.access, {
      get: () => {
        throw new Error('nothing should be read for an employee');
      },
    });
    const counted = await waitingView({} as never, { access: untouched }, w.as(TIM_ACCOUNT));
    expect(counted).toEqual({
      ok: true,
      value: {
        identifiers: null,
        duplicates: null,
        accessRequests: null,
        flagged: null,
        asked: null,
        exports: null,
        identifiersBy: null,
        accessRequestsBy: null,
        exportsBy: null,
      },
    });
  });

  it('is the length of HR’s queues, as their screens list them', async () => {
    const w = world();
    const asking = w.as(HR_ACCOUNT, 'hr');
    const counted = await waitingView({} as never, { access: w.access }, asking);
    const reviews = await w.access.identifierReviews({} as never, asking);
    const duplicates = await w.access.duplicates({} as never, asking);
    expect(counted).toEqual({
      ok: true,
      value: {
        identifiers: reviews.ok ? reviews.value.length : null,
        duplicates: duplicates.ok ? duplicates.value.length : null,
        // No full-values requests here at all: not a queue of anybody's.
        accessRequests: null,
        // No approvals or exports wired: no such queue either.
        flagged: null,
        asked: null,
        exports: null,
        // Nobody to name without a reader of accounts; no queue, nobody at all.
        identifiersBy: reviews.ok ? [] : null,
        accessRequestsBy: null,
        exportsBy: null,
      },
    });
  });
});
