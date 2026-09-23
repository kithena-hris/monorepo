import { describe, expect, it } from 'vitest';

import type { ViewerRelations } from '../../domain/access/field-access.js';
import { SchemaDraft } from '../../domain/schema/draft.js';
import { define, versionOf } from '../person/in-memory.js';
import {
  attributeFromColumn,
  keyFromHeader,
  proposeMapping,
  resolveMapping,
  type AttributeAdvisor,
  type ColumnJudgment,
} from './mapping.js';

const relations = (over: Partial<ViewerRelations> = {}): ViewerRelations => ({
  isSelf: false,
  isManager: false,
  isInManagerChain: false,
  isHr: true,
  isFinance: false,
  isAdmin: false,
  ...over,
});

const costCentre = define({
  key: 'cost_centre',
  label: { default: 'Cost centre', translations: { es: 'Centro de coste' } },
});
const workEmail = define({
  key: 'work_email',
  dataType: 'email',
  typeConfig: { kind: 'email' },
  label: { default: 'Work email' },
});
const salary = define({
  key: 'base_salary',
  label: { default: 'Base salary' },
  dataType: 'money',
  typeConfig: { kind: 'money' },
  ownership: ['finance'],
  visibility: ['finance'],
});
const version = versionOf(1, [costCentre, workEmail, salary]);

const advisor = (
  answers: Record<string, ColumnJudgment>,
  seen: string[][] = [],
): AttributeAdvisor => ({
  mapColumns(headers) {
    seen.push([...headers]);
    return Promise.resolve(new Map(Object.entries(answers)));
  },
});

describe('the cheap rules, with no advisor at all', () => {
  it('maps by key, by label in any locale, and by the export key row', async () => {
    const mapping = await proposeMapping({
      file: {
        headers: ['work_email', 'Centro de coste', 'Renamed hire date', 'Mystery'],
        keys: ['work_email', '', 'hire_date', ''],
      },
      version,
      relations: relations(),
      advisor: null,
    });
    expect(mapping.map((m) => [m.status, m.key, m.source])).toEqual([
      ['mapped', 'work_email', 'key'],
      ['mapped', 'cost_centre', 'label'],
      ['mapped', 'hire_date', 'system'],
      // Never silently dropped: ignored, and it says why.
      ['ignored', null, null],
    ]);
    expect(mapping[3]?.reason).toMatch(/no attribute/);
  });

  it('recognises its own report and export columns', async () => {
    const mapping = await proposeMapping({
      file: {
        headers: ['__person_id', '__reason', '__source_row', '__missing_required'],
        keys: null,
      },
      version,
      relations: relations(),
      advisor: null,
    });
    expect(mapping.map((m) => m.status)).toEqual(['mapped', 'ignored', 'ignored', 'ignored']);
  });
});

describe('the judgment', () => {
  const file = { headers: ['Email (work)', 'CC', 'Shoe size'], keys: null };

  it('auto-maps at 0.9 and above, asks below, and ignores no_match', async () => {
    const mapping = await proposeMapping({
      file,
      version,
      relations: relations(),
      advisor: advisor({
        'Email (work)': { key: 'work_email', confidence: 0.97 },
        CC: { key: 'cost_centre', confidence: 0.62 },
        'Shoe size': { key: null, confidence: 0.99 },
      }),
    });
    expect(mapping.map((m) => [m.status, m.key, m.confidence])).toEqual([
      ['mapped', 'work_email', 0.97],
      ['review', 'cost_centre', 0.62],
      ['ignored', null, null],
    ]);
  });

  it('is asked only about headers — never a cell', async () => {
    const seen: string[][] = [];
    await proposeMapping({ file, version, relations: relations(), advisor: advisor({}, seen) });
    expect(seen).toEqual([file.headers]);
  });

  it('cannot name a key that is not a candidate', async () => {
    const mapping = await proposeMapping({
      file,
      version,
      relations: relations(),
      advisor: advisor({ CC: { key: 'made_up', confidence: 1 } }),
    });
    expect(mapping[1]?.status).toBe('ignored');
  });
});

describe('authorization at mapping time', () => {
  it('refuses a salary column to HR without the finance relation, by label or by hand', async () => {
    const mapping = await proposeMapping({
      file: { headers: ['Base salary', 'Pay'], keys: null },
      version,
      relations: relations(),
      advisor: null,
    });
    expect(mapping[0]).toMatchObject({ status: 'refused', key: 'base_salary' });

    const byHand = resolveMapping(
      mapping,
      { 0: { kind: 'ignore' }, 1: { kind: 'map', key: 'base_salary' } },
      version,
      relations(),
    );
    expect(!byHand.ok && byHand.error.code).toBe('MAPPING_UNRESOLVED');

    const finance = resolveMapping(
      mapping,
      { 0: { kind: 'map', key: 'base_salary' }, 1: { kind: 'ignore' } },
      version,
      relations({ isFinance: true }),
    );
    expect(finance.ok).toBe(true);
  });

  it('refuses the lifecycle columns to anybody who is not HR', async () => {
    const mapping = await proposeMapping({
      file: { headers: ['Hire date'], keys: null },
      version,
      relations: relations({ isHr: false, isFinance: true }),
      advisor: null,
    });
    expect(mapping[0]?.status).toBe('refused');
  });

  it('will not run with a suggestion undecided, an unknown key, or one key twice', async () => {
    const mapping = await proposeMapping({
      file: { headers: ['CC', 'Cost centre'], keys: null },
      version,
      relations: relations(),
      advisor: advisor({ CC: { key: 'cost_centre', confidence: 0.5 } }),
    });
    expect(resolveMapping(mapping, {}, version, relations()).ok).toBe(false);
    const unknown = resolveMapping(
      mapping,
      { 0: { kind: 'map', key: 'nope' } },
      version,
      relations(),
    );
    expect(!unknown.ok && unknown.error.code).toBe('MAPPING_UNRESOLVED');
    const twice = resolveMapping(
      mapping,
      { 0: { kind: 'map', key: 'cost_centre' } },
      version,
      relations(),
    );
    expect(!twice.ok && twice.error.code).toBe('MAPPING_DUPLICATE');
    expect(resolveMapping(mapping, { 0: { kind: 'ignore' } }, version, relations()).ok).toBe(true);
  });
});

describe('an unmatched column becoming an attribute', () => {
  const draft = () => {
    const d = SchemaDraft.empty();
    d.addSection({
      key: 'hr_information',
      label: { default: 'HR' },
      order: 0,
      defaultVisibility: ['hr'],
      origin: 'core',
    });
    return d;
  };
  const spec = {
    sectionKey: 'hr_information',
    dataType: 'long_text' as const,
    typeConfig: { kind: 'long_text' as const },
    requiredness: { mode: 'never' as const },
    ownership: ['hr' as const],
    visibility: ['hr' as const],
    collectAt: 'hr_only' as const,
  };

  it('cannot, without a classification policy — and the draft is untouched', () => {
    const d = draft();
    const refused = attributeFromColumn(d, 'Medical notes', spec as never);
    expect(!refused.ok && refused.error.code).toBe('CLASSIFICATION_REQUIRED');
    expect(d.attribute('medical_notes')).toBeUndefined();
  });

  it('can, with one, keyed from its header', () => {
    const d = draft();
    const made = attributeFromColumn(d, 'Medical notes', {
      ...spec,
      classification: {
        classification: 'special-category',
        piiKind: 'health',
        exportable: true,
        aiEligible: false,
      },
      classificationSource: 'human',
    });
    expect(made.ok).toBe(true);
    expect(d.attribute('medical_notes')?.classification.classification).toBe('special-category');
  });

  it('slugs a header into a key', () => {
    expect(keyFromHeader('Coste (€) — año')).toBe('coste_ano');
    expect(keyFromHeader('2nd phone')).toBe('field_2nd_phone');
  });
});
