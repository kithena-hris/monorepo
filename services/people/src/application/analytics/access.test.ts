import { describe, expect, it } from 'vitest';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import {
  authorizeFields,
  chartExport,
  chartTooltip,
  cohortMinimum,
  expiryKinds,
  readableExpiries,
  suppressSmallCohorts,
  type ChartViewer,
  type ExpiryCandidate,
} from './access.js';
import type { ViewerRelations } from '../../domain/access/field-access.js';

/**
 * Who may draw which chart, and the cohort minimum.
 *
 * A chart is a read (§16.1 rule 1): a breakdown by a field the viewer cannot
 * read is refused, not drawn with the field blanked. Special-category data is
 * the exception in the other direction — nobody may read a value, and HR may
 * still see the aggregate, above the cohort minimum and nowhere else.
 */

const define = (over: Partial<AttributeDefinitionInput> & { key: string }) =>
  AttributeDefinition.parse({
    sectionKey: 'hr_information',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
    ownership: ['hr'],
    visibility: ['hr', 'manager_chain'],
    collectAt: 'hr_only',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'core',
    ...over,
  });

const special = (key: string) =>
  define({
    key,
    sectionKey: 'diversity',
    dataType: 'select',
    typeConfig: {
      kind: 'select',
      options: [
        { value: 'a', label: { default: 'A' } },
        { value: 'prefer_not_to_say', label: { default: 'Prefer not to say' } },
      ],
    },
    ownership: ['employee'],
    visibility: [],
    classification: {
      classification: 'special-category',
      piiKind: 'none',
      exportable: true,
      aiEligible: false,
    },
    includeInEvents: false,
    origin: 'tenant',
  });

const hr: ChartViewer = { kind: 'hr' };
const manager: ChartViewer = { kind: 'manager', personId: '00000000-0000-4000-8000-0000000000m1' };

const definitions = [
  define({ key: 'org_unit' }),
  define({ key: 'work_location', visibility: ['hr'] }),
  special('ethnicity'),
];

describe('field-level authorization over a chart', () => {
  it('lets a viewer chart a field they can read', () => {
    expect(authorizeFields(definitions, manager, ['org_unit'])).toEqual({
      ok: true,
      value: { special: false },
    });
  });

  it('refuses a breakdown by a field the viewer cannot read', () => {
    const result = authorizeFields(definitions, manager, ['work_location']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_READABLE');
  });

  it('refuses a field the tenant has not published, rather than guessing', () => {
    const result = authorizeFields(definitions, hr, ['cost_centre']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_READABLE');
  });

  it('lets HR see a special-category aggregate although nobody may read a value', () => {
    expect(authorizeFields(definitions, hr, ['ethnicity'])).toEqual({
      ok: true,
      value: { special: true },
    });
  });

  it('never shows a special-category aggregate to a manager', () => {
    const result = authorizeFields(definitions, manager, ['ethnicity']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SPECIAL_CATEGORY_HR_ONLY');
  });

  it('lets HR chart employment status, which is not an attribute', () => {
    expect(authorizeFields(definitions, hr, ['status'])).toEqual({
      ok: true,
      value: { special: false },
    });
  });

  it('never breaks a manager’s team down by status, whatever a tenant field says', () => {
    // A team of three with one "on_leave" names who is on leave (§6.3).
    const named = [...definitions, define({ key: 'status', visibility: ['manager_chain'] })];
    const result = authorizeFields(named, manager, ['status']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_READABLE');
  });

  it('marks a breakdown special when any field in it is, including a filter', () => {
    const result = authorizeFields(definitions, hr, ['org_unit', 'ethnicity']);
    expect(result).toEqual({ ok: true, value: { special: true } });
  });
});

describe('the cohort minimum', () => {
  it('defaults to ten', () => {
    expect(cohortMinimum(undefined)).toBe(10);
  });

  it('may be raised', () => {
    expect(cohortMinimum(25)).toBe(25);
  });

  it('may never be lowered', () => {
    expect(cohortMinimum(3)).toBe(10);
    expect(cohortMinimum(Number.NaN)).toBe(10);
    expect(cohortMinimum(12.5)).toBe(10);
  });
});

describe('suppression', () => {
  const cells = (...counts: number[]) =>
    counts.map((count, i) => ({ bucket: `b${String(i)}`, count }));

  it('serves a breakdown where every cell meets the minimum', () => {
    expect(suppressSmallCohorts(cells(10, 12), 10)).toEqual({
      status: 'ok',
      cells: cells(10, 12),
    });
  });

  /*
   * All or nothing, not cell by cell.
   *
   * Suppressing only the small cell leaves it recoverable: headcount is on the
   * next card, and headcount minus the cells shown is the cell hidden.
   */
  it('withholds the whole breakdown when any one cell is below it', () => {
    expect(suppressSmallCohorts(cells(40, 9), 10)).toEqual({
      status: 'insufficient_data',
      minimum: 10,
    });
  });

  it('withholds an empty breakdown too, rather than answering "nobody"', () => {
    expect(suppressSmallCohorts([], 10)).toEqual({ status: 'insufficient_data', minimum: 10 });
  });
});

describe('the tooltip and the export', () => {
  const withheld = { status: 'insufficient_data', minimum: 10 } as const;
  const served = {
    status: 'ok',
    cells: [
      { bucket: 'a', count: 14 },
      { bucket: 'prefer_not_to_say', count: 11 },
    ],
  } as const;

  it('carry no number when the query withheld one', () => {
    expect(chartTooltip(withheld, 'a')).toEqual({ bucket: 'a', value: 'insufficient data' });
    expect(chartExport(withheld)).toEqual([
      ['bucket', 'count'],
      ['insufficient data', ''],
    ]);
  });

  it('carry the served numbers otherwise', () => {
    expect(chartTooltip(served, 'a')).toEqual({ bucket: 'a', value: 14 });
    expect(chartExport(served)).toEqual([
      ['bucket', 'count'],
      ['a', 14],
      ['prefer_not_to_say', 11],
    ]);
  });
});

describe('the expiry timeline, item by item (PEO-122)', () => {
  const expiring = [
    define({ key: 'work_permit_expiry', visibility: ['self', 'hr'] }),
    define({ key: 'contract_end' }),
    define({ key: 'probation_end', visibility: ['hr'] }),
    define({ key: 'given_name', visibility: ['directory'] }),
    define({ key: 'family_name', visibility: ['directory'] }),
  ];
  const none: ViewerRelations = {
    isSelf: false,
    isManager: false,
    isInManagerChain: false,
    isHr: false,
    isFinance: false,
    isAdmin: false,
  };
  const names = { given_name: 'Sana', family_name: 'Khan', preferred_name: null };
  const candidate = (over: Partial<ExpiryCandidate>): ExpiryCandidate => ({
    personId: 'p1',
    kind: 'work_permit',
    day: '2026-10-24',
    names,
    ...over,
  });
  const chain = { ...none, isManager: true, isInManagerChain: true };

  it('offers a kind only when its field is published and readable at the viewer’s level', () => {
    expect(expiryKinds(expiring, hr)).toEqual(['work_permit', 'fixed_term', 'probation']);
    // A manager reads contract ends in their chain; permits and probation are HR's.
    expect(expiryKinds(expiring, manager)).toEqual(['fixed_term']);
    expect(expiryKinds([special('work_permit_expiry')], hr)).toEqual([]);
  });

  it('keeps an item only when this viewer reads that field on that person', () => {
    const items = readableExpiries(
      [
        candidate({}),
        candidate({ kind: 'fixed_term', day: '2026-11-01' }),
        candidate({ personId: 'p2' }),
      ],
      expiring,
      new Map([
        ['p1', chain],
        ['p2', { ...none, isSelf: true }],
      ]),
    );
    // p1's permit is HR's and theirs, so their manager sees only the contract.
    expect(items).toEqual([
      { personId: 'p1', kind: 'fixed_term', day: '2026-11-01', name: 'Sana Khan' },
      { personId: 'p2', kind: 'work_permit', day: '2026-10-24', name: 'Sana Khan' },
    ]);
  });

  it('drops a person nobody resolved relations for, and a special-category field', () => {
    expect(readableExpiries([candidate({})], expiring, new Map())).toEqual([]);
    expect(
      readableExpiries(
        [candidate({})],
        [special('work_permit_expiry')],
        new Map([['p1', { ...none, isHr: true }]]),
      ),
    ).toEqual([]);
  });

  it('names a person only by what the viewer may read of their name', () => {
    const hidden = expiring.map((d) =>
      d.key === 'family_name' ? define({ key: 'family_name', visibility: ['hr'] }) : d,
    );
    const [item] = readableExpiries(
      [candidate({ kind: 'fixed_term', names: { ...names, preferred_name: 'Sanu' } })],
      hidden,
      new Map([['p1', chain]]),
    );
    // No preferred-name field is published, so it is not read either.
    expect(item?.name).toBe('Sana');
  });
});
