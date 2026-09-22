import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { Requiredness } from '@kithena/contracts';

import { evaluateRequiredness, type PersonFacts } from './requiredness.js';

/**
 * Whether a field is required of *this* person, on *this* day.
 *
 * The rule that matters most is the one about failure. A predicate that cannot
 * be evaluated — it names an attribute somebody archived last week — evaluates
 * to **not required**, and raises a signal for an operational alert. Failing
 * the other way would lock a tenant out of their own records over a
 * configuration typo, and they would find out from four hundred employees at
 * once.
 */

const clock = fixedClock('2026-09-22T09:00:00.000Z');
const ENTITY = '00000000-0000-4000-8000-0000000000e1';
const OTHER_ENTITY = '00000000-0000-4000-8000-0000000000e2';

const facts: PersonFacts = {
  legalEntityId: ENTITY,
  country: 'ES',
  employmentType: 'permanent',
  workModel: 'onsite',
  status: 'active',
  values: { visa_type: 'work_permit' },
  knownAttributes: new Set(['visa_type', 'work_permit_number']),
};

const evaluate = (rule: unknown, over: Partial<PersonFacts> = {}) =>
  evaluateRequiredness(Requiredness.parse(rule), { ...facts, ...over }, clock);

describe('the simple modes', () => {
  it('never is never', () => {
    expect(evaluate({ mode: 'never' })).toMatchObject({ required: false });
  });

  it('always is always', () => {
    expect(evaluate({ mode: 'always' })).toMatchObject({ required: true });
  });
});

describe('each operand', () => {
  it('reads the legal entity', () => {
    expect(
      evaluate({ mode: 'conditional', when: { clauses: [{ operand: 'legalEntity', in: [ENTITY] }] } })
        .required,
    ).toBe(true);
    expect(
      evaluate({
        mode: 'conditional',
        when: { clauses: [{ operand: 'legalEntity', in: [OTHER_ENTITY] }] },
      }).required,
    ).toBe(false);
  });

  it('reads the country', () => {
    // The requirement this whole grammar exists for: a NIF is required in
    // Spain and meaningless in Germany.
    const spanish = { mode: 'conditional', when: { clauses: [{ operand: 'country', in: ['ES'] }] } };
    expect(evaluate(spanish).required).toBe(true);
    expect(evaluate(spanish, { country: 'DE' }).required).toBe(false);
  });

  it('reads the employment type', () => {
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'employmentType', in: ['contractor'] }] },
    };
    expect(evaluate(rule).required).toBe(false);
    expect(evaluate(rule, { employmentType: 'contractor' }).required).toBe(true);
  });

  it('reads the work model', () => {
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'workModel', in: ['remote'] }] },
    };
    expect(evaluate(rule, { workModel: 'remote' }).required).toBe(true);
    expect(evaluate(rule).required).toBe(false);
  });

  it('reads the status', () => {
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'status', in: ['active', 'on_leave'] }] },
    };
    expect(evaluate(rule).required).toBe(true);
    expect(evaluate(rule, { status: 'provisional' }).required).toBe(false);
  });

  it('reads whether another attribute is set', () => {
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'attribute', key: 'visa_type', is: 'set' }] },
    };
    expect(evaluate(rule).required).toBe(true);
    expect(evaluate(rule, { values: {} }).required).toBe(false);
  });

  it('reads whether another attribute equals a value', () => {
    const rule = {
      mode: 'conditional',
      when: {
        clauses: [
          { operand: 'attribute', key: 'visa_type', is: 'equals', equals: 'work_permit' },
        ],
      },
    };
    expect(evaluate(rule).required).toBe(true);
    expect(evaluate(rule, { values: { visa_type: 'student' } }).required).toBe(false);
  });

  it('does not let a structured value equal the string a rule names', () => {
    // An address stringifies to `[object Object]`, which would compare equal
    // to every other object of its kind — one rule quietly matching every
    // record that has any address at all.
    const rule = {
      mode: 'conditional',
      when: {
        clauses: [
          { operand: 'attribute', key: 'visa_type', is: 'equals', equals: '[object Object]' },
        ],
      },
    };
    expect(evaluate(rule, { values: { visa_type: { country: 'ES' } } }).required).toBe(false);
  });

  it('still counts a structured value as set', () => {
    // Present is present. It is only the comparison against a scalar that has
    // no meaningful answer.
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'attribute', key: 'visa_type', is: 'set' }] },
    };
    expect(evaluate(rule, { values: { visa_type: { country: 'ES' } } }).required).toBe(true);
  });

  it('treats an empty string as unset, because a form posts one', () => {
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'attribute', key: 'visa_type', is: 'set' }] },
    };
    expect(evaluate(rule, { values: { visa_type: '' } }).required).toBe(false);
  });
});

describe('combining clauses', () => {
  const clauses = [
    { operand: 'country', in: ['ES'] },
    { operand: 'employmentType', in: ['contractor'] },
  ];

  it('requires every clause under `all`', () => {
    expect(evaluate({ mode: 'conditional', when: { combine: 'all', clauses } }).required).toBe(
      false,
    );
  });

  it('requires one clause under `any`', () => {
    expect(evaluate({ mode: 'conditional', when: { combine: 'any', clauses } }).required).toBe(true);
  });
});

describe('requiredFrom', () => {
  it('is not required before the date', () => {
    // Required from the 1st, not required retroactively of a record completed
    // on the 30th of the month before.
    expect(evaluate({ mode: 'always', requiredFrom: '2026-12-01' }).required).toBe(false);
  });

  it('is required on and after the date', () => {
    expect(evaluate({ mode: 'always', requiredFrom: '2026-09-22' }).required).toBe(true);
    expect(evaluate({ mode: 'always', requiredFrom: '2026-01-01' }).required).toBe(true);
  });

  it('applies to a conditional rule too', () => {
    const rule = {
      mode: 'conditional',
      when: { clauses: [{ operand: 'country', in: ['ES'] }] },
      requiredFrom: '2027-01-01',
    };
    expect(evaluate(rule).required).toBe(false);
  });
});

describe('a predicate that cannot be evaluated', () => {
  const rule = {
    mode: 'conditional',
    when: { clauses: [{ operand: 'attribute', key: 'retired_field', is: 'set' }] },
  };

  it('is not required', () => {
    // The alternative locks a tenant out of their own records over a typo.
    expect(evaluate(rule).required).toBe(false);
  });

  it('says which attribute it could not read, so somebody can be told', () => {
    const verdict = evaluate(rule);
    expect(verdict.unevaluable).toEqual(['retired_field']);
  });

  it('does not report a signal when everything resolved', () => {
    expect(evaluate({ mode: 'always' }).unevaluable).toEqual([]);
  });

  it('is not required even when another clause would have held under `any`', () => {
    // A rule that half works is a rule nobody can reason about. The whole
    // predicate is unevaluable, and the alert says why.
    const half = {
      mode: 'conditional',
      when: {
        combine: 'any',
        clauses: [
          { operand: 'country', in: ['ES'] },
          { operand: 'attribute', key: 'retired_field', is: 'set' },
        ],
      },
    };
    const verdict = evaluate(half);
    expect(verdict.required).toBe(false);
    expect(verdict.unevaluable).toEqual(['retired_field']);
  });
});
