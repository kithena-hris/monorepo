import { describe, expect, it } from 'vitest';

import { planOf, type PlanInput } from './plan.js';

/**
 * Everything an import will do, in words, before anything happens: the one
 * screen HR approves (design AI11), and the short version a phone shows (MA9).
 */

const ROWS = { create: 298, update: 71, unchanged: 31, blocked: 9, duplicate: 0 };

const ACME: PlanInput = {
  setup: null,
  version: 8,
  fields: [
    { label: 'Cost centre', section: 'Employment', newSection: false, forExisting: { kind: 'hr' }, missing: 0 },
    { label: 'T-shirt size', section: 'Equipment', newSection: true, forExisting: { kind: 'ask' }, missing: 14 },
    { label: 'Laptop serial', section: 'Equipment', newSection: true, forExisting: { kind: 'hr' }, missing: 32 },
  ],
  rows: ROWS,
  leftOut: ['Dietary requirements'],
};

describe('the plan', () => {
  it('says every consequence, in order: fields, people, who is asked, HR’s work, what is left out', () => {
    const { steps } = planOf(ACME);
    expect(steps.map((s) => [s.kind, s.title])).toEqual([
      ['fields', 'Create 3 fields in Settings › Employee fields'],
      ['people', 'Create 298 people and update 71'],
      ['ask', 'Ask 14 people for their T-shirt size'],
      ['hr', 'Give HR 32 laptop serial values to fill in'],
      ['skip', 'Leave out Dietary requirements'],
    ]);
    expect(steps[0]?.detail).toBe(
      'Cost centre in Employment, and T-shirt size and Laptop serial in a new Equipment section. Published as version 8.',
    );
    expect(steps[1]?.detail).toBe(
      '31 rows are unchanged. 9 blocked rows are left out, in a file you can fix and import again.',
    );
    expect(steps[4]?.detail).toBe(
      'The column is skipped and isn’t stored anywhere. Its values aren’t kept.',
    );
  });

  it('in one sentence, for a phone', () => {
    expect(planOf(ACME).short).toBe(
      'Create 3 fields, import 369 people, ask 14 for their T-shirt size, give HR 32 laptop serial values, and leave out Dietary requirements.',
    );
  });

  it('sets up a company with nothing published, in the same approval', () => {
    const { steps, short } = planOf({
      ...ACME,
      setup: { countryName: 'United States' },
      version: 1,
      fields: ACME.fields.slice(0, 1),
      leftOut: [],
      rows: { create: 20, update: 0, unchanged: 0, blocked: 0, duplicate: 0 },
    });
    expect(steps.map((s) => s.title)).toEqual([
      'Set up the employee record with the United States pack',
      'Create 1 field in Settings › Employee fields',
      'Create 20 people',
    ]);
    expect(steps[1]?.detail).toBe('Cost centre in Employment. Published with the pack as version 1.');
    expect(steps[2]?.detail).toBe('Every row of the file imports.');
    expect(short).toBe('Set up the United States pack, create 1 field, and import 20 people.');
  });

  it('sets up with the core fields alone where the country has no pack', () => {
    const { steps } = planOf({ ...ACME, setup: { countryName: null }, version: 1 });
    expect(steps[0]?.title).toBe('Set up the employee record');
  });

  it('names who is asked, who joins later, a default and an empty field for what they are', () => {
    const { steps } = planOf({
      ...ACME,
      fields: [
        { label: 'Locker', section: 'Equipment', newSection: true, forExisting: { kind: 'new' }, missing: 5 },
        { label: 'Work country', section: 'Employment', newSection: false, forExisting: { kind: 'default', value: 'ES' }, missing: 3 },
        { label: 'Parking spot', section: 'Equipment', newSection: true, forExisting: { kind: 'leave' }, missing: 2 },
      ],
      leftOut: ['Notes', 'Allergies'],
    });
    expect(steps.slice(2).map((s) => s.title)).toEqual([
      'Ask people who join from now on for their locker',
      'Give 3 people “ES” as their work country',
      'Leave parking spot empty for 2 people',
      'Leave out Notes and Allergies',
    ]);
  });

  it('with no new fields, is just the people', () => {
    const { steps, short } = planOf({ ...ACME, fields: [], leftOut: [] });
    expect(steps.map((s) => s.kind)).toEqual(['people']);
    expect(short).toBe('Import 369 people.');
  });

  it('says so when no row would import', () => {
    const { steps } = planOf({
      ...ACME,
      fields: [],
      leftOut: [],
      rows: { create: 0, update: 0, unchanged: 3, blocked: 2, duplicate: 1 },
    });
    expect(steps[0]?.title).toBe('Nobody is created or updated');
  });
});
