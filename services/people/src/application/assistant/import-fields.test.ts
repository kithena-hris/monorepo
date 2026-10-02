import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';
import type { Prompt } from '@kithena/telemetry';

import { PlanBudget } from '../../domain/import/new-fields.js';
import type { Attribute, Section } from '../../domain/schema/draft.js';
import { define, versionOf } from '../person/in-memory.js';
import { proposeMapping, resolveMapping } from '../import/mapping.js';
import type { NewFieldsFile } from '../screens/operations.js';
import {
  draftWithNewFields,
  planImport,
  proposeNewFields,
  runImport,
  type NewFieldsDeps,
  type NewFieldsView,
} from './import-fields.js';

/**
 * New information in an import, end to end below REST, with a fake model
 * deterministic from a recorded answer: proposed from headers and shapes,
 * planned over a dry run against the version they would make, and run on
 * one approval — or not at all.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADMIN = {
  accountId: '00000000-0000-4000-8000-0000000000a1',
  roles: new Set(['people_admin', 'hr']),
};
const HR_ONLY = {
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
};
const HR = { accountId: '00000000-0000-4000-8000-0000000000a2', roles: new Set(['hr']) };
const [P1, P2, P3] = [
  '00000000-0000-4000-8000-0000000000b1',
  '00000000-0000-4000-8000-0000000000b2',
  '00000000-0000-4000-8000-0000000000b3',
];

// The file: work email (known), then emergency contact, cost centre, T-shirt size, IBAN, work country.
const ROWS = [
  ['ana@acme.es', 'Luis López', 'CC-10', 'S', 'ES91 2100 0418 4502 0005 1332', 'ES'],
  ['bo@acme.es', 'Mia Chen', 'CC-20', 'M', 'ES79 2100 0813 6101 2345 6789', 'ES'],
  ['new@acme.es', 'Rui Diaz', '', 'S', '', 'ES'],
];
const VALUES = ROWS.flatMap((r) => r.slice(1)).filter((v) => v !== '');
const FILE: NewFieldsFile = {
  identifiers: false,
  unmatched: ['Emergency contact', 'Cost centre', 'T-shirt size', 'IBAN', 'Work country'].map(
    (header, i) => ({
      index: i + 1,
      header,
      cells: ROWS.map((r) => r[i + 1] ?? ''),
    }),
  ),
  rows: [
    { outcome: 'update', personId: P1, cells: ROWS[0] ?? [] },
    { outcome: 'update', personId: P2, cells: ROWS[1] ?? [] },
    { outcome: 'create', personId: null, cells: ROWS[2] ?? [] },
  ],
};

const section = (key: string, label: string, order: number): Section =>
  ({
    key,
    label: { default: label, translations: {} },
    order,
    defaultVisibility: ['self', 'hr'],
    origin: 'core',
    archivedAt: null,
  }) as Section;

function world(
  options: {
    viewer?: typeof ADMIN;
    answer?: unknown;
    pending?: boolean;
    /** A company with nothing published, its legal entity in Spain. */
    unpublished?: boolean;
  } = {},
) {
  const sections = new Map<string, Section>(
    options.unpublished === true
      ? []
      : [
          ['personal', section('personal', 'Personal information', 0)],
          ['employment', section('employment', 'Employment', 1)],
        ],
  );
  const workEmail = define({ key: 'work_email', sectionKey: 'employment' });
  const attributes = new Map<string, Attribute>(
    options.unpublished === true ? [] : [['work_email', workEmail]],
  );
  const reviewed: { mapping: unknown; version: { version: number; keys: string[] } }[] = [];
  const committed: unknown[] = [];
  if (options.pending === true) {
    attributes.set('draft_only', define({ key: 'draft_only', sectionKey: 'employment' }));
  }
  const prompts: Prompt[] = [];
  const written: { ids: readonly string[]; values: Readonly<Record<string, unknown>> }[] = [];
  let publishes = 0;
  const viewer = options.viewer ?? ADMIN;
  const deps = {
    service: {
      inTenant: (_t: string, fn: (s: { tx: never }) => unknown) => fn({ tx: {} as never }),
      access: {
        count: () => Promise.resolve(ok({ all: 5 })),
        list: () =>
          Promise.resolve(
            ok({ items: [P1, P2, P3, 'p4', 'p5'].map((id) => ({ id })), next: null }),
          ),
      },
      org: {
        legalEntities: () =>
          Promise.resolve(
            ok([
              {
                id: 'e1',
                name: 'Acme SL',
                country: 'ES',
                timeZone: 'Europe/Madrid',
                archived: false,
              },
            ]),
          ),
        numberings: () => Promise.resolve(ok([])),
      },
    },
    relations: {
      relations: () =>
        Promise.resolve({
          isAdmin: viewer.roles.has('people_admin'),
          isHr: viewer.roles.has('hr'),
        }),
    },
    clock: fixedClock('2026-09-30T10:00:00.000Z'),
    schema: {
      loadDraft: () =>
        Promise.resolve({ sections: [...sections.values()], attributes: [...attributes.values()] }),
      currentVersion: () =>
        Promise.resolve(
          options.unpublished === true
            ? null
            : { version: 4, document: { sections: [], attributes: [workEmail] } },
        ),
    },
    draft: {
      saveSection: (_tx: never, _t: string, s: Section) => (
        sections.set(s.key, s),
        Promise.resolve()
      ),
      saveAttribute: (_tx: never, _t: string, a: Attribute) => (
        attributes.set(a.key, a),
        Promise.resolve()
      ),
    },
    publisher: {
      publish: () => {
        publishes += 1;
        return Promise.resolve(ok({ version: { version: 5 } }));
      },
    },
    artifactUrl: (v: number) => `https://people.test/v1/schema/versions/${String(v)}`,
    planBudget: new PlanBudget(20, 3_600_000),
    importFile: () => Promise.resolve(ok(FILE)),
    importReview: (
      _a: unknown,
      step: { mapping: unknown },
      version: { version: number; document: { attributes: readonly Attribute[] } },
    ) => {
      reviewed.push({
        mapping: step.mapping,
        version: { version: version.version, keys: version.document.attributes.map((a) => a.key) },
      });
      return Promise.resolve(
        ok({
          step: 'review',
          file: { name: 'people.csv', rows: 3, sheet: null },
          dryRun: {
            counts: { create: 1, update: 2, unchanged: 0, blocked: 0, duplicate: 0 },
            leftEmpty: [],
            leftEmptyCount: 0,
            newLocations: [],
            createdIn: [],
          },
          blockedUrl: null,
        }),
      );
    },
    importCommit: (_a: unknown, step: unknown) => {
      committed.push(step);
      return Promise.resolve(
        ok({
          step: 'done',
          file: { name: 'people.csv', rows: 3, sheet: null },
          created: 1,
          updated: 2,
          blocked: 0,
          reportUrl: 'https://store.test/report',
          forReview: 0,
          held: 0,
          appliedWithoutApproval: false,
        }),
      );
    },
    writeSame: (
      _tx: never,
      _a: unknown,
      ids: readonly string[],
      values: Readonly<Record<string, unknown>>,
    ) => {
      written.push({ ids, values });
      return Promise.resolve(ok(ids.length));
    },
    ...(options.answer === undefined
      ? {}
      : {
          fieldPlanner: {
            loadPolicies: () => Promise.resolve(),
            complete: (_t: string, prompt: Prompt) => {
              prompts.push(prompt);
              return Promise.resolve({ ok: true as const, value: JSON.stringify(options.answer) });
            },
          },
        }),
  } as unknown as NewFieldsDeps;
  const asking = {
    tenantId: TENANT,
    viewer,
    correlationId: '00000000-0000-4000-8000-0000000000c1',
  };
  const step = { uploadId: '00000000-0000-4000-8000-0000000000f1', mapping: { '0': 'work_email' } };
  return {
    deps,
    asking,
    step,
    sections,
    attributes,
    prompts,
    written,
    reviewed,
    committed,
    publishes: () => publishes,
  };
}

const proposed = async (w: ReturnType<typeof world>): Promise<NewFieldsView> => {
  const got = await proposeNewFields(w.deps, w.asking, w.step);
  if (!got.ok) throw new Error(got.error.message);
  return got.value;
};
const strip = (v: NewFieldsView) => v.proposals.map(({ counts: _c, sensitive: _s, ...p }) => p);

describe('proposing fields for new columns', () => {
  it('with no model, People’s own proposal: one field per column, and a recommendation for everybody else', async () => {
    const v = await proposed(world());
    expect(v.byModel).toBe(false);
    expect(v.proposals.map((p) => [p.header, p.key, p.forExisting.kind])).toEqual([
      ['Emergency contact', 'emergency_contact', 'ask'],
      ['Cost centre', 'cost_centre', 'hr'],
      ['T-shirt size', 't_shirt_size', 'leave'],
      ['IBAN', 'iban', 'ask'],
      ['Work country', 'work_country', 'default'],
    ]);
    expect(v.proposals.find((p) => p.key === 'iban')?.sensitive).toBe('Financial');
    // Five people here and one row that creates somebody: six once it is in.
    // The file gives three of them an emergency contact, two a cost centre.
    expect(v.totalPeople).toBe(6);
    expect(v.proposals[0]?.counts).toEqual({ have: 3, missing: 3, existingWithout: 3 });
    expect(v.proposals[1]?.counts).toEqual({ have: 2, missing: 4, existingWithout: 3 });
    expect(v.version).toBe(5);
    expect(v.setup).toBeNull();
  });

  it('sends the model the headers and shapes, never a value', async () => {
    const w = world({
      answer: { proposals: [], skipped: [], summary: 'Five fields.' },
    });
    const v = await proposed(w);
    expect(v.byModel).toBe(true);
    const sent = JSON.stringify(w.prompts);
    for (const value of VALUES) expect(sent).not.toContain(`"${value}"`);
    expect(sent).not.toMatch(/López|CC-10|2100/u);
    expect(sent).toContain('"header":"IBAN","shape":"IBAN-like, country ES"');
    expect(sent).toContain(
      '"header":"Work country","shape":"one short value, the same in every row","sameInEveryRow":true',
    );
    expect(w.prompts[0]?.about).toBe('configuration');
  });

  it('takes the model’s proposal for a column, with the file’s own choices', async () => {
    const v = await proposed(
      world({
        answer: {
          proposals: [
            {
              column: 3,
              field: {
                label: 'Shirt size',
                dataType: 'select',
                options: ['XXXL'],
                required: false,
                ownership: ['employee'],
                visibility: ['self', 'hr'],
                classification: 'internal',
                piiKind: 'none',
                encrypted: false,
                aiEligible: true,
              },
              newSection: 'Equipment',
              why: 'For the welcome pack.',
              forExisting: 'leave',
              forExistingWhy: 'Nice to have.',
            },
          ],
        },
      }),
    );
    expect(v.proposals.find((p) => p.column === 3)).toMatchObject({
      key: 'shirt_size',
      field: { options: ['S', 'M'] },
      placement: { newSection: 'Equipment' },
    });
  });

  it('asks about a wide file in chunks, side by side, and falls back where a chunk fails', async () => {
    const w = world();
    const wide: NewFieldsFile = {
      identifiers: false,
      unmatched: Array.from({ length: 30 }, (_, i) => ({
        index: i + 1,
        header: `Extra ${String(i + 1)}`,
        cells: ['a', 'b', 'a'],
      })),
      rows: FILE.rows,
    };
    const sent: Prompt[] = [];
    const deps = {
      ...w.deps,
      importFile: () => Promise.resolve(ok(wide)),
      fieldPlanner: {
        loadPolicies: () => Promise.resolve(),
        complete: (_t: string, prompt: Prompt) => {
          sent.push(prompt);
          // The second chunk's model times out.
          if (sent.length === 2) return Promise.reject(new Error('the model answered 504'));
          return Promise.resolve({
            ok: true as const,
            value: JSON.stringify({ proposals: [], skipped: [] }),
          });
        },
      },
    } as NewFieldsDeps;
    const got = await proposeNewFields(deps, w.asking, w.step);
    expect(sent.map((p) => (p.context['columns'] as unknown[]).length)).toEqual([12, 12, 6]);
    expect(got.ok && got.value.proposals.length).toBe(30);
    expect(got.ok && got.value.byModel).toBe(true);
  });

  it('keeps People’s own proposal when the model does not answer in JSON', async () => {
    const w = world();
    const deps = {
      ...w.deps,
      fieldPlanner: {
        loadPolicies: () => Promise.resolve(),
        complete: () =>
          Promise.resolve({ ok: true as const, value: 'Sure! Here are some fields…' }),
      },
    } as NewFieldsDeps;
    const got = await proposeNewFields(deps, w.asking, w.step);
    expect(got.ok && got.value.byModel).toBe(false);
    expect(got.ok && got.value.proposals.map((p) => p.key)).toContain('iban');
  });

  it('shows HR without an administrator the whole proposal, read-only, and never asks the model', async () => {
    const w = world({ viewer: HR, answer: { proposals: [] } });
    const v = await proposed(w);
    expect(v.canCreate).toBe(false);
    expect(v.blocked).toMatch(/Only a People administrator/u);
    expect(w.prompts).toEqual([]);
    // Their plan imports without the new columns, and adds nothing.
    const plan = await planImport(w.deps, w.asking, { ...w.step, proposals: strip(v) });
    expect(plan.ok && plan.value.fields).toEqual([]);
    expect(plan.ok && plan.value.steps.map((s) => s.kind)).toEqual(['people', 'skip']);
    const ran = await runImport(w.deps, w.asking, { ...w.step, proposals: strip(v) });
    expect(ran.ok).toBe(true);
    expect(w.attributes.size).toBe(1);
    expect(w.publishes()).toBe(0);
  });
});

describe('the plan', () => {
  it('is a dry run against the version the kept fields would make, and writes nothing', async () => {
    const w = world();
    const v = await proposed(w);
    const proposals = strip(v).map((p) =>
      p.key === 't_shirt_size' ? { ...p, include: false } : p,
    );
    const plan = await planImport(w.deps, w.asking, { ...w.step, proposals });
    if (!plan.ok) throw new Error(plan.error.message);
    expect(w.reviewed).toEqual([
      {
        mapping: {
          '0': 'work_email',
          '1': 'emergency_contact',
          '2': 'cost_centre',
          '4': 'iban',
          '5': 'work_country',
        },
        version: {
          version: 5,
          keys: ['work_email', 'emergency_contact', 'iban', 'work_country', 'cost_centre'],
        },
      },
    ]);
    expect(plan.value.steps.map((s) => s.title)).toEqual([
      'Create 4 fields in Settings › Employee fields',
      'Create 1 person and update 2',
      'Ask 3 people for their emergency contact',
      'Give HR 4 cost centre values to fill in',
      'Ask 4 people for their IBAN',
      'Give 3 people “ES” as their work country',
      'Leave out T-shirt size',
    ]);
    expect(plan.value.asked).toBe(7);
    expect(plan.value.forHr).toBe(4);
    expect(plan.value.blocked).toBeNull();
    // Nothing written.
    expect(w.attributes.size).toBe(1);
    expect(w.publishes()).toBe(0);
  });

  it('sets up a company with nothing published, in the same plan', async () => {
    const w = world({ unpublished: true });
    const v = await proposed(w);
    expect(v.setup).toEqual({ country: 'ES', countryName: 'Spain' });
    expect(v.version).toBe(1);
    const plan = await planImport(w.deps, w.asking, { ...w.step, proposals: strip(v) });
    if (!plan.ok) throw new Error(plan.error.message);
    expect(plan.value.steps[0]?.title).toBe('Set up the employee record with the Spain pack');
    expect(plan.value.version).toBe(1);
    // The file is read against setup's fields and the new ones, together.
    expect(w.reviewed[0]?.version.keys).toEqual(
      expect.arrayContaining(['given_name', 'work_email', 'emergency_contact']),
    );
    expect(w.sections.size).toBe(0);
  });
});

describe('approving and running it', () => {
  it('adds the kept fields and a new section, publishes once, writes the default, imports, and never touches an existing field', async () => {
    const w = world();
    const v = await proposed(w);
    const before = w.attributes.get('work_email');
    const proposals = strip(v).map((p) =>
      p.key === 't_shirt_size' ? { ...p, include: false } : p,
    );
    const ran = await runImport(w.deps, w.asking, { ...w.step, proposals });
    if (!ran.ok) throw new Error(ran.error.message);
    expect(ran.value).toMatchObject({ created: 1, updated: 2, version: 5, asked: 7, forHr: 4 });
    expect(ran.value.fields.map((f) => [f.label, f.section, f.newSection])).toEqual([
      ['Emergency contact', 'Emergency contact', true],
      ['Cost centre', 'Employment', false],
      ['IBAN', 'Bank and pay', true],
      ['Work country', 'Other information', true],
    ]);
    expect(w.publishes()).toBe(1);
    expect(w.attributes.get('work_email')).toBe(before);
    expect(w.attributes.has('t_shirt_size')).toBe(false);
    expect(w.attributes.get('emergency_contact')).toMatchObject({
      sectionKey: 'emergency_contact',
      requiredness: { mode: 'always', appliesTo: 'all_records' },
      ownership: ['employee', 'hr'],
      classificationSource: 'suggested',
    });
    expect(w.attributes.get('iban')).toMatchObject({
      encrypted: true,
      classification: { aiEligible: false },
    });
    expect(w.sections.get('emergency_contact')?.label.default).toBe('Emergency contact');
    // The default goes to the people the file gives no value: everybody but P1 and P2.
    expect(w.written).toEqual([{ ids: [P3, 'p4', 'p5'], values: { work_country: 'es' } }]);
    // Then the import, with every new column going to its new field.
    expect(w.committed).toEqual([
      {
        uploadId: w.step.uploadId,
        mapping: {
          '0': 'work_email',
          '1': 'emergency_contact',
          '2': 'cost_centre',
          '4': 'iban',
          '5': 'work_country',
        },
      },
    ]);
  });

  it('adds only fields the import can then write: the dry run maps every kept column', async () => {
    const w = world();
    const v = await proposed(w);
    const built = draftWithNewFields(
      { sections: [...w.sections.values()], attributes: [...w.attributes.values()] },
      strip(v),
    );
    const version = versionOf(5, [...w.attributes.values(), ...built.attributes]);
    const headers = ['Work email', ...FILE.unmatched.map((c) => c.header)];
    const columns = await proposeMapping({
      file: { headers, keys: null },
      version,
      relations: HR_ONLY,
      advisor: null,
    });
    const choices = Object.fromEntries(
      v.proposals.map((p) => [p.column, { kind: 'map' as const, key: p.key }]),
    );
    const resolved = resolveMapping(columns, choices, version, HR_ONLY);
    expect(resolved.ok ? resolved.value.map((c) => c.status) : resolved.error.message).toEqual([
      'mapped',
      'mapped',
      'mapped',
      'mapped',
      'mapped',
      'mapped',
    ]);
  });

  it('is all or nothing: one field the draft refuses and nothing is stored, published or imported', async () => {
    const w = world();
    const v = await proposed(w);
    const proposals = strip(v).map((p) =>
      p.key === 'cost_centre'
        ? { ...p, field: { ...p.field, dataType: 'select' as const, encrypted: true } }
        : p,
    );
    const ran = await runImport(w.deps, w.asking, { ...w.step, proposals });
    expect(ran).toMatchObject({ ok: false, error: { code: 'DEFINITION_INVALID' } });
    expect(ran.ok ? '' : ran.error.message).toMatch(/Nothing was added/u);
    expect(w.attributes.size).toBe(1);
    expect(w.sections.size).toBe(2);
    expect(w.publishes()).toBe(0);
    expect(w.committed).toEqual([]);
  });

  it('is refused while the draft holds other unpublished changes, so a publish carries only its own', async () => {
    const w = world({ pending: true });
    const v = await proposed(w);
    expect(v.blocked).toMatch(/1 unpublished change/u);
    const ran = await runImport(w.deps, w.asking, { ...w.step, proposals: strip(v) });
    expect(ran).toMatchObject({ ok: false, error: { code: 'DRAFT_HAS_CHANGES' } });
    expect(w.publishes()).toBe(0);
    expect(w.committed).toEqual([]);
  });

  it('refuses a column that is not one of the file’s new ones', async () => {
    const w = world();
    const v = await proposed(w);
    const [first] = strip(v);
    if (first === undefined) throw new Error('no proposal');
    const forged = [{ ...first, column: 0, header: 'Work email' }];
    const ran = await runImport(w.deps, w.asking, { ...w.step, proposals: forged });
    expect(ran).toMatchObject({ ok: false, error: { code: 'VALUE_INVALID' } });
  });
});
