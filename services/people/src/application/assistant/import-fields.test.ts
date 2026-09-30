import { describe, expect, it } from 'vitest';
import { fixedClock, ok } from '@kithena/domain-kit';
import type { Prompt } from '@kithena/telemetry';

import { PlanBudget } from '../../domain/import/new-fields.js';
import type { Attribute, Section } from '../../domain/schema/draft.js';
import { define } from '../person/in-memory.js';
import type { NewFieldsFile } from '../screens/operations.js';
import {
  applyNewFields,
  proposeNewFields,
  reviewNewFields,
  type NewFieldsDeps,
  type NewFieldsView,
} from './import-fields.js';

/**
 * New information in an import, end to end below REST, with a fake model
 * deterministic from a recorded answer: proposed from headers and shapes,
 * reviewed, and added in one transaction — or not at all.
 */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ADMIN = {
  accountId: '00000000-0000-4000-8000-0000000000a1',
  roles: new Set(['people_admin', 'hr']),
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

function world(options: { viewer?: typeof ADMIN; answer?: unknown; pending?: boolean } = {}) {
  const sections = new Map<string, Section>([
    ['personal', section('personal', 'Personal information', 0)],
    ['employment', section('employment', 'Employment', 1)],
  ]);
  const workEmail = define({ key: 'work_email', sectionKey: 'employment' });
  const attributes = new Map<string, Attribute>([['work_email', workEmail]]);
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
      currentVersion: () => Promise.resolve({ version: 4, document: { attributes: [workEmail] } }),
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
  return { deps, asking, step, sections, attributes, prompts, written, publishes: () => publishes };
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
    // Five people here; the file gives two of them an emergency contact.
    expect(v.proposals[0]?.counts).toEqual({ fromFile: 3, existingWithout: 3 });
    expect(v.proposals[1]?.counts).toEqual({ fromFile: 2, existingWithout: 3 });
    expect(v.summary).toContain('3 people will be asked for their emergency contact.');
    expect(v.summary).toContain('HR will fill in 3 cost centre values.');
  });

  it('sends the model the headers and shapes, never a value', async () => {
    const w = world({
      answer: { calls: [{ name: 'finish', input: { summary: 'Five fields.' } }] },
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
          calls: [
            {
              name: 'propose_field',
              input: {
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

  it('shows HR without an administrator the whole proposal, read-only, and never asks the model', async () => {
    const w = world({ viewer: HR, answer: { calls: [] } });
    const v = await proposed(w);
    expect(v.canCreate).toBe(false);
    expect(v.blocked).toMatch(/Only a People administrator/u);
    expect(w.prompts).toEqual([]);
    const applied = await applyNewFields(w.deps, w.asking, {
      ...w.step,
      proposals: strip(v),
      summary: v.summary,
    });
    expect(applied).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(w.attributes.size).toBe(1);
  });
});

describe('adding them', () => {
  it('adds the kept fields and a new section, publishes once, writes the default, and never touches an existing field', async () => {
    const w = world();
    const v = await proposed(w);
    const before = w.attributes.get('work_email');
    const proposals = strip(v).map((p) =>
      p.key === 't_shirt_size' ? { ...p, include: false } : p,
    );
    const review = await reviewNewFields(w.deps, w.asking, { ...w.step, proposals });
    expect(review.ok && review.value.problems).toEqual([]);
    // Reviewing writes nothing.
    expect(w.attributes.size).toBe(1);
    const applied = await applyNewFields(w.deps, w.asking, {
      ...w.step,
      proposals,
      summary: v.summary,
    });
    expect(applied).toEqual(
      ok({
        version: 5,
        mapped: { '1': 'emergency_contact', '2': 'cost_centre', '4': 'iban', '5': 'work_country' },
        defaults: 3,
      }),
    );
    expect(w.publishes()).toBe(1);
    expect(w.attributes.get('work_email')).toBe(before);
    expect(w.attributes.has('t_shirt_size')).toBe(false);
    expect(w.attributes.get('emergency_contact')).toMatchObject({
      sectionKey: 'emergency_contact',
      requiredness: { mode: 'always', appliesTo: 'all_records' },
      ownership: ['employee'],
      classificationSource: 'suggested',
    });
    expect(w.attributes.get('iban')).toMatchObject({
      encrypted: true,
      classification: { aiEligible: false },
    });
    expect(w.sections.get('emergency_contact')?.label.default).toBe('Emergency contact');
    // The default goes to the people the file gives no value: everybody but P1 and P2.
    expect(w.written).toEqual([{ ids: [P3, 'p4', 'p5'], values: { work_country: 'es' } }]);
  });

  it('is all or nothing: one field the draft refuses and nothing is stored or published', async () => {
    const w = world();
    const v = await proposed(w);
    const proposals = strip(v).map((p) =>
      p.key === 'cost_centre'
        ? { ...p, field: { ...p.field, dataType: 'select' as const, encrypted: true } }
        : p,
    );
    const applied = await applyNewFields(w.deps, w.asking, {
      ...w.step,
      proposals,
      summary: v.summary,
    });
    expect(applied).toMatchObject({ ok: false, error: { code: 'DEFINITION_INVALID' } });
    expect(applied.ok ? '' : applied.error.message).toMatch(/Nothing was added/u);
    expect(w.attributes.size).toBe(1);
    expect(w.sections.size).toBe(2);
    expect(w.publishes()).toBe(0);
  });

  it('is refused while the draft holds other unpublished changes, so a publish carries only its own', async () => {
    const w = world({ pending: true });
    const v = await proposed(w);
    expect(v.blocked).toMatch(/1 unpublished change/u);
    const applied = await applyNewFields(w.deps, w.asking, {
      ...w.step,
      proposals: strip(v),
      summary: v.summary,
    });
    expect(applied).toMatchObject({ ok: false, error: { code: 'DRAFT_HAS_CHANGES' } });
    expect(w.publishes()).toBe(0);
  });

  it('refuses a column that is not one of the file’s new ones', async () => {
    const w = world();
    const v = await proposed(w);
    const [first] = strip(v);
    if (first === undefined) throw new Error('no proposal');
    const forged = [{ ...first, column: 0, header: 'Work email' }];
    const applied = await applyNewFields(w.deps, w.asking, {
      ...w.step,
      proposals: forged,
      summary: 'x',
    });
    expect(applied).toMatchObject({ ok: false, error: { code: 'VALUE_INVALID' } });
  });
});
