import { describe, expect, it } from 'vitest';

import { Requiredness, RequirednessPredicate, attributesReferenced } from './requiredness.js';

/**
 * The closed grammar, and where it closes.
 *
 * The ticket names one property and it is the whole point: **an unknown
 * operand is refused at parse time, not at evaluation time.** The difference
 * is who finds out. A predicate checked when it is written is a message on the
 * settings screen in front of the admin who wrote it. A predicate checked when
 * it is evaluated is a line in the nightly recompute's log, and by then four
 * hundred people have been told their profile is fine when it is not.
 */
const ENTITY = '00000000-0000-4000-8000-0000000000e1';

describe('an unknown operand', () => {
  it('is refused when the rule is written', () => {
    expect(
      RequirednessPredicate.safeParse({
        clauses: [{ operand: 'favouriteColour', in: ['blue'] }],
      }).success,
    ).toBe(false);
  });

  it('is refused even when it looks like a field somebody has', () => {
    // `department` is a real attribute in the shipped registry. It is still
    // not an operand: reading another field goes through the `attribute`
    // clause, which names the key explicitly.
    expect(
      RequirednessPredicate.safeParse({
        clauses: [{ operand: 'department', in: ['engineering'] }],
      }).success,
    ).toBe(false);
  });

  it('is refused for a value the operand cannot take', () => {
    // A country clause holds country codes. It cannot hold an employment type,
    // which is what a discriminated union buys over a bag of strings.
    expect(
      RequirednessPredicate.safeParse({
        clauses: [{ operand: 'country', in: ['permanent'] }],
      }).success,
    ).toBe(false);
  });
});

describe('a clause', () => {
  it('needs something to compare against', () => {
    expect(RequirednessPredicate.safeParse({ clauses: [{ operand: 'country', in: [] }] }).success).toBe(
      false,
    );
  });

  it('accepts the requirement that actually turns up', () => {
    // "Required in Spain and Germany, for permanent staff."
    const parsed = RequirednessPredicate.parse({
      clauses: [
        { operand: 'country', in: ['ES', 'DE'] },
        { operand: 'employmentType', in: ['permanent'] },
      ],
    });
    expect(parsed.combine).toBe('all');
  });

  it('refuses an equals clause with nothing to equal', () => {
    expect(
      RequirednessPredicate.safeParse({
        clauses: [{ operand: 'attribute', key: 'work_model', is: 'equals' }],
      }).success,
    ).toBe(false);
  });

  it('accepts an attribute being merely set', () => {
    expect(
      RequirednessPredicate.safeParse({
        clauses: [{ operand: 'attribute', key: 'visa_type', is: 'set' }],
      }).success,
    ).toBe(true);
  });

  it('refuses an attribute key that could never exist', () => {
    expect(
      RequirednessPredicate.safeParse({
        clauses: [{ operand: 'attribute', key: 'Visa-Type', is: 'set' }],
      }).success,
    ).toBe(false);
  });

  it('caps how many clauses one rule may carry', () => {
    const one = { operand: 'workModel', in: ['remote'] };
    expect(RequirednessPredicate.safeParse({ clauses: Array.from({ length: 10 }, () => one) }).success).toBe(
      true,
    );
    expect(RequirednessPredicate.safeParse({ clauses: Array.from({ length: 11 }, () => one) }).success).toBe(
      false,
    );
  });
});

describe('requiredness', () => {
  it('has a mode that cannot be anything else', () => {
    expect(Requiredness.safeParse({ mode: 'sometimes' }).success).toBe(false);
  });

  it('defaults a dated mode to every record, with no date', () => {
    // `all_records` does not mean "block". §8.4: it means the record becomes
    // incomplete, which is a task, not a locked door.
    expect(Requiredness.parse({ mode: 'always' })).toEqual({
      mode: 'always',
      requiredFrom: null,
      appliesTo: 'all_records',
    });
  });

  it('carries no dates at all when the answer is never', () => {
    // A `requiredFrom` on a rule that never requires anything is a field two
    // readers would interpret differently.
    expect(Requiredness.parse({ mode: 'never' })).toEqual({ mode: 'never' });
  });

  it('keeps a conditional rule with its predicate and its date', () => {
    const parsed = Requiredness.parse({
      mode: 'conditional',
      when: { clauses: [{ operand: 'legalEntity', in: [ENTITY] }] },
      requiredFrom: '2026-10-01',
      appliesTo: 'new_records',
    });
    expect(parsed).toMatchObject({ requiredFrom: '2026-10-01', appliesTo: 'new_records' });
  });
});

describe('which attributes a rule depends on', () => {
  it('names them, so archiving one can be refused', () => {
    const rule = Requiredness.parse({
      mode: 'conditional',
      when: {
        combine: 'any',
        clauses: [
          { operand: 'attribute', key: 'visa_type', is: 'set' },
          { operand: 'country', in: ['ES'] },
          { operand: 'attribute', key: 'work_permit_number', is: 'equals', equals: 'pending' },
        ],
      },
    });
    expect(attributesReferenced(rule)).toEqual(['visa_type', 'work_permit_number']);
  });

  it('names none for a rule that reads no field', () => {
    expect(attributesReferenced(Requiredness.parse({ mode: 'always' }))).toEqual([]);
    expect(attributesReferenced(Requiredness.parse({ mode: 'never' }))).toEqual([]);
  });
});
