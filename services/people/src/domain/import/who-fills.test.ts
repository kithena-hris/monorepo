import { describe, expect, it } from 'vitest';

import {
  forExistingOf,
  ownerByRules,
  whoFillsAnswer,
  whoFillsContext,
  type FieldFacts,
} from './who-fills.js';

/**
 * Who fills in a new field for the people without a value: rules first, from
 * the field's key, label, section and classification; the model only for
 * what the rules cannot place, and never with a value.
 */

const facts = (label: string, over: Partial<FieldFacts> = {}): FieldFacts => ({
  key: label.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '_'),
  label,
  section: 'Other information',
  piiKind: 'none',
  classification: 'internal',
  ...over,
});

describe('who fills it in, by rule', () => {
  it.each([
    // Personal data the employee holds: asked of them.
    ['Driver License Number', 'employee'],
    ['Driver License Class', 'employee'],
    ['Passport Number', 'employee'],
    ['Passport Expiry', 'employee'],
    ['National ID (SSN/NI/SIN/PAN)', 'employee'],
    ['Tax ID / Steuer-ID', 'employee'],
    ['Tax Filing Status', 'employee'],
    ['Work Permit Number', 'employee'],
    ['Bank Name', 'employee'],
    ['Bank Account Number', 'employee'],
    ['IBAN', 'employee'],
    ['Routing / Sort / IFSC Code', 'employee'],
    ['Home Address Line 1', 'employee'],
    ['Home City', 'employee'],
    ['Personal Email', 'employee'],
    ['Mobile Phone', 'employee'],
    ['Emergency Contact Name', 'employee'],
    ['Emergency Contact Phone', 'employee'],
    ['Marital Status', 'employee'],
    ['Number of Dependents', 'employee'],
    ['Nationality', 'employee'],
    ['Pronouns', 'employee'],
    ['T-Shirt Size', 'employee'],
    ['Languages', 'employee'],
    ['Highest Education', 'employee'],
    ['University', 'employee'],
    ['Certifications', 'employee'],
    ['Skills', 'employee'],
    ['LinkedIn URL', 'employee'],
    // Employment data: HR fills it in.
    ['Job Title', 'hr'],
    ['Job Level', 'hr'],
    ['Department', 'hr'],
    ['Division', 'hr'],
    ['Cost Center', 'hr'],
    ['Legal Entity', 'hr'],
    ['Manager Name', 'hr'],
    ['Manager Email', 'hr'],
    ['Work Email', 'hr'],
    ['Work Phone', 'hr'],
    ['Work Location Address', 'hr'],
    ['Original Hire Date', 'hr'],
    ['Probation End Date', 'hr'],
    ['Contract End Date', 'hr'],
    ['FTE', 'hr'],
    ['Standard Weekly Hours', 'hr'],
    ['Shift', 'hr'],
    ['Pay Type', 'hr'],
    ['FLSA Status', 'hr'],
    ['Annual Base Salary', 'hr'],
    ['Bonus Target %', 'hr'],
    ['Equity Grant (Units)', 'hr'],
    ['Benefits Plan', 'hr'],
    ['Retirement Plan', 'hr'],
    ['Annual Leave Balance (days)', 'hr'],
    ['Leave Type', 'hr'],
    ['Expected Return Date', 'hr'],
    ['Performance Rating', 'hr'],
    ['Laptop Serial', 'hr'],
    ['Badge Number', 'hr'],
    ['Parking Spot', 'hr'],
    // Free notes: nobody is chased.
    ['Notes', 'leave'],
  ] as const)('%s → %s', (label, owner) => {
    expect(ownerByRules(facts(label))?.owner).toBe(owner);
  });

  it('never chases special-category data, whatever its label says', () => {
    for (const label of ['Dietary Requirements', 'Religion', 'Union Member', 'Home Clinic']) {
      expect(ownerByRules(facts(label, { classification: 'special-category' }))?.owner).toBe(
        'leave',
      );
    }
    expect(ownerByRules(facts('Blood group', { piiKind: 'health' }))?.owner).toBe('leave');
  });

  it('places a field its label does not name by its kind, then by its section', () => {
    expect(ownerByRules(facts('Ref A', { piiKind: 'financial' }))?.owner).toBe('employee');
    expect(ownerByRules(facts('Ref B', { piiKind: 'identity' }))?.owner).toBe('employee');
    expect(ownerByRules(facts('Ref C', { piiKind: 'contact' }))?.owner).toBe('employee');
    expect(ownerByRules(facts('Ref D', { section: 'Emergency contact' }))?.owner).toBe('employee');
    expect(ownerByRules(facts('Ref E', { section: 'Employment' }))?.owner).toBe('hr');
    expect(ownerByRules(facts('Ref F', { section: 'Compensation' }))?.owner).toBe('hr');
  });

  it('leaves what it cannot place to the model', () => {
    expect(ownerByRules(facts('Favourite colour'))).toBeNull();
    expect(ownerByRules(facts('Extra 1'))).toBeNull();
  });

  it('says why in one line', () => {
    expect(ownerByRules(facts('IBAN'))?.why).toBe('Bank details are the employee’s to give.');
    expect(ownerByRules(facts('Department'))?.why).toBe(
      'Employment data: HR holds it, so HR fills it in.',
    );
  });
});

describe('what happens for the people without a value', () => {
  it('asks the employee, gives HR the rest, or writes the one value every row holds for HR', () => {
    const employee = { owner: 'employee', why: 'Theirs.' } as const;
    const hr = { owner: 'hr', why: 'HR’s.' } as const;
    expect(forExistingOf(employee, null)).toEqual({
      forExisting: { kind: 'ask' },
      forExistingWhy: 'Theirs.',
    });
    // Never a guess at somebody's own detail from everybody else's.
    expect(forExistingOf(employee, 'British').forExisting).toEqual({ kind: 'ask' });
    expect(forExistingOf(hr, null).forExisting).toEqual({ kind: 'hr' });
    expect(forExistingOf(hr, 'Standard').forExisting).toEqual({
      kind: 'default',
      value: 'Standard',
    });
    expect(forExistingOf({ owner: 'leave', why: 'No.' }, 'x').forExisting).toEqual({
      kind: 'leave',
    });
  });
});

describe('the model, for what the rules cannot place', () => {
  it('is told labels, sections and kinds, never a value', () => {
    expect(
      whoFillsContext([facts('Favourite colour', { section: 'Other information' })]),
    ).toEqual({
      fields: [
        {
          key: 'favourite_colour',
          label: 'Favourite colour',
          section: 'Other information',
          kind: 'none',
          classification: 'internal',
        },
      ],
    });
  });

  it('is read strictly: one of three answers, for a key it was asked about', () => {
    const asked = new Set(['a', 'b', 'c', 'd']);
    expect(
      whoFillsAnswer(
        { a: 'employee', b: 'hr', c: 'leave', d: 'ask', e: 'hr', f: 1 },
        asked,
      ),
    ).toEqual(
      new Map([
        ['a', 'employee'],
        ['b', 'hr'],
        ['c', 'leave'],
      ]),
    );
    expect(whoFillsAnswer(['employee'], asked)).toEqual(new Map());
    expect(whoFillsAnswer(null, asked)).toEqual(new Map());
    expect(whoFillsAnswer('employee', asked)).toEqual(new Map());
  });
});
