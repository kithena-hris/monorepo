import { describe, expect, it } from 'vitest';

import { shapeOf } from './column-shape.js';
import {
  asDefinition,
  localProposal,
  PlanBudget,
  summaryOf,
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
};

describe('with no model: People’s own proposal', () => {
  it('an emergency contact: contact data the employee fills in; ask the people already here', () => {
    expect(localProposal(FILE.emergency, SECTIONS)).toMatchObject({
      field: {
        piiKind: 'contact',
        classification: 'confidential',
        ownership: ['employee'],
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
          name: 'propose_field',
          input: {
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
        },
        {
          name: 'skip_column',
          input: { column: 7, why: 'Already held as the legal entity’s country.' },
        },
        { name: 'propose_field', input: { column: 99 } },
        { name: 'finish', input: { summary: 'Three new fields.' } },
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
    expect(unreadable).toBe(1);
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
    expect(rules.visibility).toContain('self');
    expect(rules.requiredness).toEqual({ mode: 'always', appliesTo: 'all_records' });
  });

  it('HR fills it: required, and HR’s', () => {
    expect(asDefinition(cost).requiredness).toEqual({ mode: 'always', appliesTo: 'all_records' });
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

describe('the review in words, with the counts', () => {
  it('says what is added where, how many from the file, and what happens for everybody else', () => {
    const proposals = withKeys(
      [FILE.emergency, FILE.cost, FILE.shirt, FILE.iban].map((s) => localProposal(s, SECTIONS)),
      new Set(),
    );
    const counts = new Map([
      [3, { fromFile: 128, existingWithout: 342 }],
      [4, { fromFile: 128, existingWithout: 60 }],
      [5, { fromFile: 128, existingWithout: 342 }],
      [6, { fromFile: 100, existingWithout: 0 }],
    ]);
    expect(summaryOf(proposals, counts, 128, SECTIONS)).toBe(
      'Adds 4 fields: 1 to a new Emergency contact section, 1 to Employment, 1 to a new Other information section, 1 to a new Bank and pay section. ' +
        'Values for 128 people from this file. 342 people will be asked for their emergency contact. ' +
        'HR will fill in 60 cost centre values. T-shirt size stays empty for 342 people.',
    );
  });

  it('says so when nothing is added', () => {
    expect(summaryOf([], new Map(), 0, SECTIONS)).toMatch(/^Adds no fields/u);
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
