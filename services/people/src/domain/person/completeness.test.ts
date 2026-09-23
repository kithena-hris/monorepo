import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import { assessCompleteness, notApplicable } from './completeness.js';
import type { PersonFacts } from '../schema/requiredness.js';

/**
 * Whether a record has everything the published version asks of it.
 *
 * Derived, never stored as a decision somebody made: a record becomes
 * incomplete because a version was published, not because anybody edited it.
 * And **nothing is blocked** — §8.4 is explicit. Completeness produces a task
 * and a banner, not a locked door, which is why this returns a description of
 * what is missing and who owns it rather than a yes or a no.
 */

const clock = fixedClock('2026-09-22T09:00:00.000Z');

const define = (over: Partial<AttributeDefinitionInput> & { key: string }) =>
  AttributeDefinition.parse({
    sectionKey: 'hr_information',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'always' },
    ownership: ['hr'],
    visibility: ['self', 'hr'],
    collectAt: 'hr_only',
    classification: {
      classification: 'internal',
      piiKind: 'none',
      exportable: true,
      aiEligible: true,
    },
    classificationSource: 'human',
    origin: 'tenant',
    ...over,
  });

const facts = (over: Partial<PersonFacts> = {}): PersonFacts => ({
  legalEntityId: '00000000-0000-4000-8000-0000000000e1',
  country: 'ES',
  employmentType: 'permanent',
  workModel: 'onsite',
  status: 'active',
  values: {},
  knownAttributes: new Set(['cost_centre', 'nif', 'bio']),
  ...over,
});

describe('a provisional record', () => {
  it('is not applicable rather than incomplete', () => {
    // An account exists and nobody has told us anything about the person yet.
    // Counting that as incomplete would nag somebody on day zero for fields
    // nobody has asked them for.
    const verdict = assessCompleteness(
      [define({ key: 'cost_centre' })],
      facts({ status: 'provisional' }),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('not_applicable');
    expect(verdict.missing).toEqual([]);
  });

  it('is not applicable once discarded', () => {
    expect(
      assessCompleteness(
        [define({ key: 'cost_centre' })],
        facts({ status: 'discarded' }),
        clock,
        'Etc/UTC',
      ).state,
    ).toBe('not_applicable');
  });
});

describe('a live record', () => {
  it('is complete when every applicable required field has a value', () => {
    const verdict = assessCompleteness(
      [define({ key: 'cost_centre' })],
      facts({ values: { cost_centre: 'CC-100' } }),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('complete');
  });

  it('is incomplete with the missing key and who owns it', () => {
    // Both halves are what drives the next step: an employee-owned gap is a
    // task and a decaying reminder, an HR-owned gap aggregates into one grid.
    const verdict = assessCompleteness(
      [
        define({ key: 'cost_centre', ownership: ['hr'] }),
        define({ key: 'bio', ownership: ['employee'] }),
      ],
      facts(),
      clock,
      'Etc/UTC',
    );

    expect(verdict.state).toBe('incomplete');
    expect(verdict.missing).toEqual([
      { key: 'cost_centre', sectionKey: 'hr_information', owners: ['hr'] },
      { key: 'bio', sectionKey: 'hr_information', owners: ['employee'] },
    ]);
  });

  it('ignores a field nobody is required to fill in', () => {
    const verdict = assessCompleteness(
      [define({ key: 'bio', requiredness: { mode: 'never' } })],
      facts(),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('complete');
  });

  it('ignores a deprecated field, which no form is still asking for', () => {
    const verdict = assessCompleteness(
      [define({ key: 'cost_centre', deprecatedAt: '2026-01-01T00:00:00.000Z' })],
      facts(),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('complete');
  });

  it('treats an empty string as missing, because that is what a skipped form posts', () => {
    const verdict = assessCompleteness(
      [define({ key: 'cost_centre' })],
      facts({ values: { cost_centre: '  ' } }),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('incomplete');
  });
});

describe('a requirement that has not started yet', () => {
  it('leaves the record complete until its date', () => {
    // The whole point of `requiredFrom`: an admin scheduling a field for
    // January does not make four hundred people incomplete in September.
    const verdict = assessCompleteness(
      [
        define({
          key: 'cost_centre',
          requiredness: { mode: 'always', requiredFrom: '2027-01-01' },
        }),
      ],
      facts(),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('complete');
  });
});

describe('a requirement that depends on the person', () => {
  const nif = define({
    key: 'nif',
    requiredness: {
      mode: 'conditional',
      when: { clauses: [{ operand: 'country', in: ['ES'] }] },
    },
  });

  it('applies in the country that asks for it', () => {
    expect(assessCompleteness([nif], facts(), clock, 'Etc/UTC').state).toBe('incomplete');
  });

  it('does not apply anywhere else', () => {
    // A Spanish tax identifier is not a thing to nag a German employee about.
    expect(assessCompleteness([nif], facts({ country: 'DE' }), clock, 'Etc/UTC').state).toBe(
      'complete',
    );
  });
});

describe('a rule that cannot be evaluated', () => {
  it('leaves the record complete and reports the broken rule', () => {
    // Failing towards "required" would lock a tenant out of their own records
    // over a configuration typo.
    const broken = define({
      key: 'cost_centre',
      requiredness: {
        mode: 'conditional',
        when: { clauses: [{ operand: 'attribute', key: 'retired_field', is: 'set' }] },
      },
    });

    const verdict = assessCompleteness([broken], facts(), clock, 'Etc/UTC');
    expect(verdict.state).toBe('complete');
    expect(verdict.unevaluable).toEqual([{ key: 'cost_centre', reads: ['retired_field'] }]);
  });
});

describe('not applicable (PRD §15.4)', () => {
  const nif = define({
    key: 'nif',
    requiredness: { mode: 'conditional', when: { clauses: [{ operand: 'country', in: ['ES'] }] } },
  });
  const bio = define({ key: 'bio', requiredness: { mode: 'never' } });
  const scheduled = define({
    key: 'cost_centre',
    requiredness: { mode: 'always', requiredFrom: '2027-01-01' },
  });

  it('is a blank a rule could ask for but does not ask of this person', () => {
    // Grey in the XLSX: distinguishable from missing (amber) and from an
    // optional field nobody filled (no fill).
    expect(notApplicable([nif, bio], facts({ country: 'DE' }), clock, 'Etc/UTC')).toEqual(['nif']);
  });

  it('is not a field that is required of them, or one that has a value', () => {
    expect(notApplicable([nif], facts(), clock, 'Etc/UTC')).toEqual([]);
    expect(
      notApplicable([nif], facts({ country: 'DE', values: { nif: 'X' } }), clock, 'Etc/UTC'),
    ).toEqual([]);
  });

  it('includes a rule that has not started yet, on the day being asked about', () => {
    expect(notApplicable([scheduled], facts(), clock, 'Etc/UTC')).toEqual(['cost_centre']);
    const january = fixedClock('2027-01-02T09:00:00.000Z');
    expect(notApplicable([scheduled], facts(), january, 'Etc/UTC')).toEqual([]);
  });

  it('is nothing at all for a record with nothing to be complete about', () => {
    expect(
      notApplicable([nif], facts({ country: 'DE', status: 'provisional' }), clock, 'Etc/UTC'),
    ).toEqual([]);
  });
});

describe('a pre-hire (PRD §8.1)', () => {
  // Asked only for what is collected before the first day: at signup, at
  // enrolment or during onboarding. An HR-only or any-time field is for later.
  const definitions = [
    define({ key: 'cost_centre', collectAt: 'hr_only' }),
    define({ key: 'bio', collectAt: 'anytime' }),
    define({ key: 'nif', collectAt: 'onboarding', ownership: ['employee'] }),
    define({ key: 'mobile', collectAt: 'enrolment', ownership: ['employee'] }),
    define({ key: 'given_name', collectAt: 'signup', ownership: ['employee'] }),
  ];
  const known = new Set(definitions.map((d) => d.key as string));

  it('is asked only for fields collected at signup, enrolment or onboarding', () => {
    const verdict = assessCompleteness(
      definitions,
      facts({ status: 'pre_hire', knownAttributes: known }),
      clock,
      'Etc/UTC',
    );
    expect(verdict.missing.map((m) => m.key)).toEqual(['nif', 'mobile', 'given_name']);
  });

  it('is complete once those are filled, whatever HR has still to add', () => {
    const verdict = assessCompleteness(
      definitions,
      facts({
        status: 'pre_hire',
        knownAttributes: known,
        values: { nif: 'x', mobile: 'y', given_name: 'z' },
      }),
      clock,
      'Etc/UTC',
    );
    expect(verdict.state).toBe('complete');
  });

  it('is asked for everything once active', () => {
    const verdict = assessCompleteness(
      definitions,
      facts({ status: 'active', knownAttributes: known }),
      clock,
      'Etc/UTC',
    );
    expect(verdict.missing).toHaveLength(5);
  });

  it('greys what is not asked of them yet in an export', () => {
    expect(
      notApplicable(
        definitions,
        facts({ status: 'pre_hire', knownAttributes: known }),
        clock,
        'Etc/UTC',
      ),
    ).toEqual(['cost_centre', 'bio']);
  });
});
