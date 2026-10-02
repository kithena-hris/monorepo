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
    {
      label: 'Cost centre',
      section: 'Employment',
      newSection: false,
      forExisting: { kind: 'hr' },
      missing: 0,
    },
    {
      label: 'T-shirt size',
      section: 'Equipment',
      newSection: true,
      forExisting: { kind: 'ask' },
      missing: 14,
    },
    {
      label: 'Laptop serial',
      section: 'Equipment',
      newSection: true,
      forExisting: { kind: 'hr' },
      missing: 32,
    },
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
      '31 rows are unchanged. 9 rows have no name and no work email, so they’re skipped: nobody to create.',
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
    expect(steps[1]?.detail).toBe(
      'Cost centre in Employment. Published with the pack as version 1.',
    );
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
        {
          label: 'Locker',
          section: 'Equipment',
          newSection: true,
          forExisting: { kind: 'new' },
          missing: 5,
        },
        {
          label: 'Work country',
          section: 'Employment',
          newSection: false,
          forExisting: { kind: 'default', value: 'ES' },
          missing: 3,
        },
        {
          label: 'Parking spot',
          section: 'Equipment',
          newSection: true,
          forExisting: { kind: 'leave' },
          missing: 2,
        },
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
    expect(steps[0]?.detail).toBe(
      '3 rows are unchanged. 2 rows have no name and no work email, so they’re skipped: nobody to create. 1 row repeats somebody, so it’s skipped.',
    );
  });
});

describe('a file from another system, or another Kithena', () => {
  const DEV_EXPORT: PlanInput = {
    setup: { countryName: 'United States' },
    version: 1,
    fields: [],
    rows: { create: 30, update: 1, unchanged: 0, blocked: 0, duplicate: 0 },
    leftOut: [],
    identifiers: { inFile: true, numbered: true },
    newLocations: { names: ['Corporate, New York', 'Scranton Branch'], added: true },
    leftEmpty: { count: 2, labels: ['Manager'] },
  };

  it('says in one line that its employee IDs are ignored and Kithena gives each new person one', () => {
    const ids = planOf(DEV_EXPORT).steps.find((s) => s.kind === 'ids');
    expect(ids?.title).toBe(
      'Employee IDs in the file are ignored; Kithena gives each new person one',
    );
    expect(ids?.detail).toBe(
      'Rows match people already here by work email; a row that matches nobody is a new person.',
    );
  });

  it('says so too when nobody will be numbered yet, and who can change that', () => {
    const ids = planOf({ ...DEV_EXPORT, identifiers: { inFile: true, numbered: false } }).steps.find(
      (s) => s.kind === 'ids',
    );
    expect(ids?.title).toBe('Employee IDs in the file are ignored');
    expect(ids?.detail).toContain('an administrator turns numbering on in Settings › Organisation');
  });

  it('adds the work locations it names before the people, and lists what it leaves empty', () => {
    const { steps } = planOf(DEV_EXPORT);
    expect(steps.map((s) => s.kind)).toEqual(['setup', 'places', 'people', 'ids', 'refs']);
    expect(steps[1]?.title).toBe('Add 2 work locations: Corporate, New York and Scranton Branch');
    expect(steps[4]?.title).toBe('Leave 2 values empty for HR');
    expect(steps[4]?.detail).toBe(
      'Manager on those rows can’t be read, or points at nobody here. The rows import without it, and nothing is blocked; each is listed below.',
    );
  });

  it('leaves the work locations empty when only an administrator could add them', () => {
    const places = planOf({
      ...DEV_EXPORT,
      newLocations: { names: ['Scranton Branch'], added: false },
    }).steps.find((s) => s.kind === 'places');
    expect(places?.title).toBe('Leave work location empty where the file names Scranton Branch');
  });

  it('says which values HR mapped to work locations here, beside the ones it adds', () => {
    const mapped = { value: 'NYC HQ', to: 'New York' };
    const both = planOf({
      ...DEV_EXPORT,
      newLocations: { names: ['Scranton', 'Stamford'], added: true, mapped: [mapped] },
    }).steps.find((s) => s.kind === 'places');
    expect(both?.title).toBe('Add 2 work locations: Scranton and Stamford; map “NYC HQ” to New York');
    const only = planOf({
      ...DEV_EXPORT,
      newLocations: { names: [], added: true, mapped: [mapped] },
    });
    expect(only.steps.find((s) => s.kind === 'places')?.title).toBe('Map “NYC HQ” to New York');
    expect(only.short).toContain('map 1 work location value');
  });

  it('says nothing about identifiers when the file holds none', () => {
    const { steps } = planOf({ ...DEV_EXPORT, identifiers: { inFile: false, numbered: true } });
    expect(steps.some((s) => s.kind === 'ids')).toBe(false);
  });
});
