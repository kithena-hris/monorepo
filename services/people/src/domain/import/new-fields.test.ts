import { describe, expect, it } from 'vitest';

import { shapeOf, typeFor } from './column-shape.js';
import {
  asDefinition,
  fitted,
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

  it('a T-shirt size: a choice from the file, ordinary, and theirs to give: ask them', () => {
    expect(localProposal(FILE.shirt, SECTIONS)).toMatchObject({
      field: {
        dataType: 'select',
        options: ['S', 'M', 'L'],
        classification: 'internal',
        aiEligible: true,
      },
      forExisting: { kind: 'ask' },
      forExistingWhy: 'About them, not their job: the employee tells us.',
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

  it('a column that can reveal health or religion is imported, HR’s alone, approved, and never chased', () => {
    // A list cannot be sealed: special category, unsealed, changes approved.
    expect(localProposal(FILE.diet, SECTIONS)).toMatchObject({
      include: true,
      field: {
        classification: 'special-category',
        encrypted: false,
        requiresApproval: true,
        ownership: ['hr'],
        visibility: ['hr'],
        aiEligible: false,
        required: false,
      },
      forExisting: { kind: 'leave' },
    });
    expect(localProposal(FILE.diet, SECTIONS).why).toMatch(/not encrypted, because it’s a list/u);
    // Free text can be: sealed.
    const note = seen(9, 'Medical notes', ['Asthma', 'None', 'Knee surgery 2019']);
    expect(localProposal(note, SECTIONS)).toMatchObject({
      include: true,
      field: { classification: 'special-category', encrypted: true, visibility: ['hr'] },
    });
  });

  it('pay is confidential, HR’s and finance’s, approved; a percentage is a percentage, an amount money', () => {
    const bonus = seen(10, 'Bonus Target %', ['15', '20', '60', '15']);
    expect(localProposal({ ...bonus, local: typeFor(bonus.header, bonus.local) }, SECTIONS).field).toMatchObject({
      dataType: 'percentage',
      classification: 'confidential',
      piiKind: 'none',
      encrypted: false,
      requiresApproval: true,
      ownership: ['hr'],
      visibility: ['hr', 'finance'],
    });
    const raise = seen(11, 'Last Raise %', ['2.0', '9.4', '3.15']);
    expect(localProposal({ ...raise, local: typeFor(raise.header, raise.local) }, SECTIONS).field)
      .toMatchObject({ dataType: 'percentage', decimals: 2, encrypted: false });
    const salary = seen(12, 'Annual Base Salary', ['463600.00', '98000.50']);
    expect(
      localProposal(
        { ...salary, local: typeFor(salary.header, salary.local, { hasCurrency: true }) },
        SECTIONS,
      ).field,
    ).toMatchObject({ dataType: 'money', classification: 'confidential', visibility: ['hr', 'finance'] });
  });

  it('a list of pay or identity data is never proposed sealed', () => {
    for (const [header, cells] of [
      ['Tax Filing Status', ['Single', 'Head of household', 'Single']],
      ['Currency', ['USD', 'INR', 'USD']],
      ['Driver License Class', ['C', 'CDL-A', 'C', 'C']],
      ['Work Authorization', ['Citizen', 'Work permit', 'Citizen']],
      ['Commission Plan', ['Standard', 'Standard', 'Gold']],
    ] as const) {
      const p = localProposal(seen(13, header, cells), SECTIONS);
      expect(p.field.encrypted, header).toBe(false);
      expect(p.field.piiKind, header).not.toBe('financial');
      expect(p.include, header).toBe(true);
    }
  });

  it('personal identifiers are sealed text: never a phone, a number or a list', () => {
    for (const [header, cells] of [
      ['Passport Number', ['M9109171', 'L7149883', 'X1234567']],
      ['National ID (SSN/NI/SIN/PAN)', ['992-83-8749', 'TN 12 34 56 A', 'ABCDE1234F']],
      ['Bank Account Number', ['027217940', '462136141', '011518355']],
      ['Routing / Sort / IFSC Code', ['011518355', '20-00-00', 'HDFC0001234']],
      ['Tax ID / Steuer-ID', ['12345678901', '98765432109']],
      ['Driver License Number', ['C185-3212-1617', 'B330-7014-5027']],
      ['IBAN', ['DE18200551922393904808', 'GB29NWBK60161331926819']],
    ] as const) {
      const s = seen(14, header, cells);
      const p = localProposal({ ...s, local: typeFor(header, s.local) }, SECTIONS);
      expect(p.field, header).toMatchObject({ dataType: 'text', encrypted: true, aiEligible: false });
    }
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

  it('is fitted to what the settings take: no sealed list, no identifier without its scheme, no list for a number', () => {
    const raise = seen(11, 'Last Raise %', ['2.0', '9.4', '3.15']);
    const columns = [
      seen(9, 'Currency', ['USD', 'INR', 'USD']),
      seen(10, 'National ID', ['992-83-8749', 'TN 12 34 56 A']),
      { ...raise, local: typeFor(raise.header, raise.local) },
    ];
    const mine = columns.map((s) => localProposal(s, SECTIONS));
    const model = (column: number, field: Record<string, unknown>) => ({
      column,
      field: {
        label: 'X',
        required: false,
        ownership: ['hr'],
        visibility: ['hr'],
        classification: 'confidential',
        aiEligible: false,
        ...field,
      },
      newSection: 'Bank and pay',
      why: 'Pay.',
      forExisting: 'hr',
      forExistingWhy: 'HR.',
    });
    const { proposals, unreadable } = withModel(
      mine,
      [
        {
          proposals: [
            // As the production model answered: a list of pay data, sealed.
            model(9, { label: 'Currency', dataType: 'select', piiKind: 'financial', encrypted: true }),
            // An identifier with no country's scheme: the draft needs one.
            model(10, { label: 'National ID', dataType: 'national_id', piiKind: 'identity', encrypted: true }),
            // A percentage the model took for choices.
            model(11, { label: 'Last raise', dataType: 'select', piiKind: 'financial', encrypted: true }),
          ],
        },
      ],
      SECTIONS,
      columns,
    );
    expect(unreadable).toBe(0);
    const at = (c: number) => proposals.find((p) => p.column === c);
    expect(at(9)?.field).toMatchObject({
      dataType: 'currency',
      encrypted: false,
      piiKind: 'none',
      requiresApproval: true,
    });
    expect(at(9)?.why).toMatch(/not encrypted/u);
    expect(at(10)?.field).toMatchObject({ dataType: 'text', encrypted: true });
    expect(at(11)?.field).toMatchObject({ dataType: 'percentage', decimals: 2, encrypted: false });
  });

  it('fits any field: a sealed choice is unsealed and approved; financial data that cannot be sealed is not called financial', () => {
    const base = {
      label: '',
      dataType: 'select' as const,
      options: ['A'],
      required: true,
      ownership: ['hr' as const],
      visibility: ['hr' as const],
      classification: 'internal' as const,
      piiKind: 'financial' as const,
      encrypted: true,
      aiEligible: true,
    };
    expect(fitted(base, 'Pay Type')).toEqual({
      field: {
        ...base,
        label: 'Pay Type',
        encrypted: false,
        piiKind: 'none',
        classification: 'confidential',
        requiresApproval: true,
        aiEligible: false,
      },
      note: 'Stored as confidential, with changes approved, not encrypted, because it’s a list.',
    });
    // A choice with no choices is text; a sealed text stays sealed.
    expect(fitted({ ...base, options: [] }, 'Pay Type').field).toMatchObject({
      dataType: 'text',
      encrypted: true,
      piiKind: 'financial',
    });
  });

  it('cannot lower special category, and keeps HR-only and sealed what it calls that', () => {
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
      include: true,
      field: { classification: 'special-category', visibility: ['hr'], aiEligible: false },
    });
    // Text, as the model said: special category, sealed, HR's alone, changes approved.
    expect(proposals.find((p) => p.column === 5)).toMatchObject({
      include: true,
      field: {
        dataType: 'text',
        classification: 'special-category',
        visibility: ['hr'],
        encrypted: true,
        requiresApproval: true,
      },
      forExisting: { kind: 'leave' },
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
    const left = { ...shirt, forExisting: { kind: 'leave' as const } };
    expect(asDefinition(left).requiredness).toEqual({ mode: 'never' });
    expect(
      asDefinition({ ...left, field: { ...left.field, required: true } }).requiredness,
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
