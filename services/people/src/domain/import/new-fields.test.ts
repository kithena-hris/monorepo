import { describe, expect, it } from 'vitest';

import { shapeOf } from './column-shape.js';
import {
  asDefinition,
  localProposal,
  nearly,
  PlanBudget,
  withKeys,
  withModel,
  type ColumnSeen,
} from './new-fields.js';

/**
 * New information in an imported file: People's own proposal when there is
 * no model, the model's laid over it when there is, what applying means for
 * people already here, and the review in words.
 */

const SECTIONS = [
  { key: 'personal', label: 'Personal information' },
  { key: 'employment', label: 'Employment' },
];

const seen = (column: number, header: string, cells: readonly string[]): ColumnSeen => {
  const distinct = [...new Set(cells.filter((c) => c.trim() !== ''))];
  return {
    column,
    header,
    local: shapeOf(cells),
    single: distinct.length === 1 && cells.length > 1 ? (distinct[0] ?? null) : null,
  };
};

const FILE = {
  emergency: seen(3, 'Emergency contact', ['Ana López', 'Bo Chen', 'Cy Diaz']),
  cost: seen(4, 'Cost centre', ['CC-10', 'CC-20', 'CC-10']),
  shirt: seen(5, 'T-shirt size', ['S', 'M', 'S', 'L']),
  iban: seen(6, 'IBAN', ['ES91 2100 0418 4502 0005 1332', 'ES79 2100 0813 6101 2345 6789']),
  country: seen(7, 'Work country', ['ES', 'ES', 'ES']),
  diet: seen(8, 'Dietary requirements', ['Vegetarian', '', 'Halal', 'Vegetarian']),
};

describe('with no model: People’s own proposal', () => {
  it('an emergency contact: contact data the employee fills in; ask the people already here', () => {
    expect(localProposal(FILE.emergency, SECTIONS)).toMatchObject({
      field: {
        piiKind: 'contact',
        classification: 'confidential',
        ownership: ['employee', 'hr'],
        aiEligible: false,
      },
      placement: { newSection: 'Emergency contact' },
      forExisting: { kind: 'ask' },
    });
  });

  it('a cost centre: organisational, HR fills it in, in the Employment section', () => {
    expect(localProposal(FILE.cost, SECTIONS)).toMatchObject({
      field: { ownership: ['hr'], classification: 'internal', aiEligible: true },
      placement: { sectionKey: 'employment' },
      forExisting: { kind: 'hr' },
    });
  });

  it('a T-shirt size: a choice from the file, ordinary, left empty for people already here', () => {
    expect(localProposal(FILE.shirt, SECTIONS)).toMatchObject({
      field: {
        dataType: 'select',
        options: ['S', 'M', 'L'],
        classification: 'internal',
        aiEligible: true,
      },
      forExisting: { kind: 'leave' },
    });
  });

  it('an IBAN: financial, sealed, not for the assistant; ask them', () => {
    expect(localProposal(FILE.iban, SECTIONS)).toMatchObject({
      field: {
        dataType: 'bank_account',
        country: 'ES',
        piiKind: 'financial',
        encrypted: true,
        aiEligible: false,
      },
      placement: { newSection: 'Bank and pay' },
      forExisting: { kind: 'ask' },
    });
  });

  it('one value in every row: that value for everybody missing it', () => {
    expect(localProposal(FILE.country, SECTIONS).forExisting).toEqual({
      kind: 'default',
      value: 'ES',
    });
  });

  it('never duplicates a field the company has: a column named like one is left out, and says where it goes', () => {
    const given = localProposal(seen(8, 'Given name', ['Ana', 'Bo']), SECTIONS, [
      { key: 'given_name', label: 'Legal first name' },
    ]);
    expect(given.include).toBe(false);
    expect(given.why).toMatch(/existing field “Legal first name”/u);
  });

  it('nor one spelled a little differently', () => {
    expect(
      localProposal(seen(9, 'Cost center', ['CC-1', 'CC-2']), SECTIONS, [
        { key: 'cost_centre', label: 'Cost centre' },
      ]).include,
    ).toBe(false);
    expect(nearly('Cost center', 'Cost centre')).toBe(true);
    expect(nearly('Parking spot', 'Parking lot')).toBe(false);
    expect(nearly('Region', 'Religion')).toBe(false);
  });

  it('a column that can reveal health or religion is held back, explained, and never chased', () => {
    expect(localProposal(FILE.diet, SECTIONS)).toMatchObject({
      include: false,
      field: { classification: 'special-category', aiEligible: false, required: false },
      forExisting: { kind: 'leave' },
    });
    expect(localProposal(FILE.diet, SECTIONS).why).toMatch(
      /special-category data\. I suggest not importing it/u,
    );
  });

  it('is surer when the values or the header decide the field than of plain free text', () => {
    expect(localProposal(FILE.cost, SECTIONS).confidence).toBe('high');
    expect(localProposal(FILE.shirt, SECTIONS).confidence).toBe('high');
    expect(localProposal(FILE.emergency, SECTIONS).confidence).toBe('high');
    const serial = seen(10, 'Laptop serial', ['C02XK1Y2JG5H', 'FVFZ81Q2P3', 'C02AB']);
    expect(localProposal(serial, SECTIONS).confidence).toBe('medium');
  });

  it('every proposal says why, in one line', () => {
    for (const s of Object.values(FILE)) {
      const p = localProposal(s, SECTIONS);
      expect(p.why.length).toBeGreaterThan(10);
      expect(p.forExistingWhy.length).toBeGreaterThan(10);
    }
  });
});

describe('with a model', () => {
  const local = Object.values(FILE).map((s) => localProposal(s, SECTIONS));

  it('takes a valid proposal, keeps People’s where it said nothing, and never its choices or defaults', () => {
    const { proposals, summary, unreadable } = withModel(
      local,
      [
        {
          proposals: [
            {
              column: 5,
              field: {
                label: 'Shirt size',
                dataType: 'select',
                options: ['invented'],
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
              forExisting: 'default',
              forExistingWhy: 'Most people are M.',
            },
            // Not the shape: dropped and counted, the rest kept.
            { column: 99 },
          ],
          skipped: [{ column: 7, why: 'Already held as the legal entity’s country.' }],
          summary: 'Three new fields.',
        },
        'not an answer at all',
      ],
      SECTIONS,
      Object.values(FILE),
    );
    const shirt = proposals.find((p) => p.column === 5);
    expect(shirt).toMatchObject({
      field: { label: 'Shirt size', options: ['S', 'M', 'L'] },
      placement: { newSection: 'Equipment' },
      // No single value in the file, so no default: the model never saw one.
      forExisting: { kind: 'leave' },
    });
    expect(proposals.find((p) => p.column === 7)).toMatchObject({ include: false });
    expect(proposals.find((p) => p.column === 3)?.forExisting).toEqual({ kind: 'ask' });
    expect(summary).toBe('Three new fields.');
    expect(unreadable).toBe(2);
  });

  it('cannot put back a column held back as special category, and holds back one it calls that', () => {
    const field = {
      label: 'X',
      dataType: 'text',
      required: false,
      ownership: ['employee'],
      visibility: ['self', 'hr', 'manager'],
      classification: 'internal',
      piiKind: 'none',
      encrypted: false,
      aiEligible: true,
    };
    const { proposals } = withModel(
      local,
      [
        {
          proposals: [
            { column: 8, field, newSection: 'Food', why: 'Catering.', forExisting: 'ask', forExistingWhy: 'Ask.' },
            {
              column: 5,
              field: { ...field, classification: 'special-category', piiKind: 'health', aiEligible: false },
              newSection: 'Health',
              why: 'Sizes can say something about health.',
              forExisting: 'leave',
              forExistingWhy: 'Never chased.',
            },
          ],
        },
      ],
      SECTIONS,
      Object.values(FILE),
    );
    expect(proposals.find((p) => p.column === 8)).toMatchObject({
      include: false,
      field: { classification: 'special-category' },
    });
    expect(proposals.find((p) => p.column === 5)).toMatchObject({
      include: false,
      field: { classification: 'special-category' },
    });
  });

  it('gives each field a key its label makes, never one already taken', () => {
    const keyed = withKeys(local.slice(0, 2), new Set(['emergency_contact']));
    expect(keyed.map((p) => p.key)).toEqual(['emergency_contact_2', 'cost_centre']);
  });
});

describe('what applying means for people already here', () => {
  const keyed = withKeys(
    [FILE.cost, FILE.shirt].map((s) => localProposal(s, SECTIONS)),
    new Set(),
  );
  const must = <T>(x: T | undefined): T => {
    if (x === undefined) throw new Error('missing');
    return x;
  };
  const cost = must(keyed[0]);
  const shirt = must(keyed[1]);

  it('asked: theirs to fill in, required of everybody', () => {
    const rules = asDefinition({ ...cost, forExisting: { kind: 'ask' } });
    expect(rules.ownership).toEqual(['hr', 'employee']);
    // HR writes the file's values: always among who fills it in.
    expect(
      asDefinition({ ...shirt, field: { ...shirt.field, ownership: ['employee'] } }).ownership,
    ).toEqual(['employee', 'hr']);
    expect(rules.visibility).toContain('self');
    expect(rules.requiredness).toEqual({ mode: 'always', appliesTo: 'all_records' });
  });

  it('HR fills it: required, and HR’s', () => {
    expect(asDefinition(cost).requiredness).toEqual({ mode: 'always', appliesTo: 'all_records' });
  });

  it('only new joiners: required of people added from now on', () => {
    expect(asDefinition({ ...shirt, forExisting: { kind: 'new' } }).requiredness).toEqual({
      mode: 'always',
      appliesTo: 'new_records',
    });
  });

  it('left empty: optional, or required of new people only', () => {
    expect(asDefinition(shirt).requiredness).toEqual({ mode: 'never' });
    expect(
      asDefinition({ ...shirt, field: { ...shirt.field, required: true } }).requiredness,
    ).toEqual({
      mode: 'always',
      appliesTo: 'new_records',
    });
  });
});

describe('the budget', () => {
  it('allows so many proposals a window per company, then says when the next is free', () => {
    const budget = new PlanBudget(1, 60_000);
    expect(budget.take('t1', '2026-09-29T10:00:00.000Z').ok).toBe(true);
    expect(budget.take('t2', '2026-09-29T10:00:00.000Z').ok).toBe(true);
    expect(budget.take('t1', '2026-09-29T10:00:20.000Z')).toEqual({
      ok: false,
      retryAfterSeconds: 40,
    });
  });
});
