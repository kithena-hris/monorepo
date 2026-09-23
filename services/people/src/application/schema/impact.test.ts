import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { AttributeDefinition, type AttributeDefinitionInput } from '@kithena/contracts';

import { computeImpact, ownersOf, type EvaluablePerson } from './impact.js';
import type { PersonFacts } from '../../domain/schema/requiredness.js';
import type { Placement, TenantCalendar } from '../../domain/org/calendar.js';

/**
 * The number that stops a Friday afternoon becoming four hundred emails.
 *
 * §9.3 shows it before anything is written: "88 of 412 people become
 * incomplete, 61 fields owned by employees, 27 owned by you". The preview is
 * the part that prevents the mistake, so the property that matters is that it
 * is computed from the same functions the recompute uses — a preview that
 * disagreed with the outcome would be worse than none, because somebody would
 * have trusted it.
 */

const clock = fixedClock('2026-09-22T09:00:00.000Z');

const define = (over: Partial<AttributeDefinitionInput> & { key: string }) =>
  AttributeDefinition.parse({
    sectionKey: 'hr_information',
    label: { default: over.key },
    dataType: 'text',
    typeConfig: { kind: 'text' },
    requiredness: { mode: 'never' },
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
  knownAttributes: new Set(['cost_centre', 'bio', 'nif']),
  ...over,
});

const NOWHERE: Placement = { legalEntityId: null, locationId: null, ownZone: null };

/** `n` people, all alike, so a count is about the rule and not about the data. */
const crowd = (n: number, over: Partial<PersonFacts> = {}): EvaluablePerson[] =>
  Array.from({ length: n }, (_, i) => ({
    personId: `person-${String(i)}`,
    facts: facts(over),
    placement: NOWHERE,
  }));

describe('tightening a requirement', () => {
  const before = [define({ key: 'cost_centre' })];
  const after = [define({ key: 'cost_centre', requiredness: { mode: 'always' } })];

  it('counts who becomes incomplete', () => {
    const impact = computeImpact(before, after, crowd(412), clock);
    expect(impact).toMatchObject({ evaluated: 412, becomingIncomplete: 412 });
  });

  it('does not count somebody who already has a value', () => {
    const answered = crowd(10, { values: { cost_centre: 'CC-1' } });
    expect(computeImpact(before, after, answered, clock).becomingIncomplete).toBe(0);
  });

  it('splits the missing fields by who has to fill them in', () => {
    // The actionable half: employee-owned gaps become tasks and reminders,
    // HR-owned gaps become one grid.
    const mixed = [
      define({ key: 'cost_centre', requiredness: { mode: 'always' }, ownership: ['hr'] }),
      define({ key: 'bio', requiredness: { mode: 'always' }, ownership: ['employee'] }),
    ];
    const impact = computeImpact(before, mixed, crowd(5), clock);
    expect(impact.fieldsByOwner).toEqual({ employee: 5, staff: 5 });
  });

  it('names the keys each person newly lacks', () => {
    const impact = computeImpact(before, after, crowd(2), clock);
    expect(impact.people).toEqual([
      { personId: 'person-0', newlyMissing: ['cost_centre'] },
      { personId: 'person-1', newlyMissing: ['cost_centre'] },
    ]);
  });
});

describe('somebody already incomplete', () => {
  const before = [define({ key: 'cost_centre', requiredness: { mode: 'always' } })];
  const after = [
    define({ key: 'cost_centre', requiredness: { mode: 'always' } }),
    define({ key: 'bio', requiredness: { mode: 'always' }, ownership: ['employee'] }),
  ];

  it('is counted as already incomplete, not as newly so', () => {
    // An admin is accepting responsibility for the people they are about to
    // affect, not for the backlog they inherited.
    const impact = computeImpact(before, after, crowd(3), clock);
    expect(impact).toMatchObject({ becomingIncomplete: 0, alreadyIncomplete: 3 });
  });

  it('still reports the field that is new to them', () => {
    const impact = computeImpact(before, after, crowd(1), clock);
    expect(impact.people).toEqual([{ personId: 'person-0', newlyMissing: ['bio'] }]);
  });
});

describe('loosening a requirement', () => {
  it('counts who becomes complete again', () => {
    // Undoing Friday's mistake is a publish too, and the admin doing it
    // deserves to see that it undoes it.
    const before = [define({ key: 'cost_centre', requiredness: { mode: 'always' } })];
    const after = [define({ key: 'cost_centre' })];

    const impact = computeImpact(before, after, crowd(88), clock);
    expect(impact).toMatchObject({ becomingComplete: 88, becomingIncomplete: 0 });
  });
});

describe('who is evaluated at all', () => {
  const before = [define({ key: 'cost_centre' })];
  const after = [define({ key: 'cost_centre', requiredness: { mode: 'always' } })];

  it('leaves provisional records out of the count', () => {
    // Nobody has been asked for anything yet. Counting them would inflate the
    // number an admin is being asked to accept.
    const impact = computeImpact(before, after, crowd(5, { status: 'provisional' }), clock);
    expect(impact).toMatchObject({ evaluated: 5, becomingIncomplete: 0 });
  });

  it('leaves discarded records out too', () => {
    const impact = computeImpact(before, after, crowd(5, { status: 'discarded' }), clock);
    expect(impact.becomingIncomplete).toBe(0);
  });

  it('counts a leaver, because a terminated record is still a record', () => {
    // Employment records outlive employment, and a statutory field missing
    // from one is still missing.
    const impact = computeImpact(before, after, crowd(2, { status: 'terminated' }), clock);
    expect(impact.becomingIncomplete).toBe(2);
  });
});

describe('a requirement that only applies to some people', () => {
  it('counts only the people it applies to', () => {
    const before = [define({ key: 'nif' })];
    const after = [
      define({
        key: 'nif',
        requiredness: {
          mode: 'conditional',
          when: { clauses: [{ operand: 'country', in: ['ES'] }] },
        },
      }),
    ];

    const people = [...crowd(3), ...crowd(7, { country: 'DE' }).map((p, i) => ({
      personId: `german-${String(i)}`,
      facts: p.facts,
      placement: NOWHERE,
    }))];

    const impact = computeImpact(before, after, people, clock);
    expect(impact).toMatchObject({ evaluated: 10, becomingIncomplete: 3 });
  });

  it('counts nobody when the date has not arrived', () => {
    // `requiredFrom` is the lever an admin reaches for once they see the
    // number. It has to actually move it.
    const before = [define({ key: 'cost_centre' })];
    const after = [
      define({
        key: 'cost_centre',
        requiredness: { mode: 'always', requiredFrom: '2027-01-01' },
      }),
    ];

    expect(computeImpact(before, after, crowd(412), clock).becomingIncomplete).toBe(0);
  });
});

describe('who owns the fields a publish requires', () => {
  it('names the roles, for the copy that tells an admin whose week this is', () => {
    const definitions = [
      define({ key: 'cost_centre', ownership: ['hr'] }),
      define({ key: 'bio', ownership: ['employee', 'hr'] }),
    ];
    expect(ownersOf(definitions, ['cost_centre', 'bio'])).toEqual(['employee', 'hr']);
  });

  it('names nobody for keys nothing defines', () => {
    expect(ownersOf([define({ key: 'cost_centre' })], ['gone'])).toEqual([]);
  });
});

describe('each person on their own day (PRD §6.8)', () => {
  const MADRID = '00000000-0000-4000-8000-0000000000e1';
  const BANGALORE = '00000000-0000-4000-8000-0000000000e2';
  const calendar: TenantCalendar = {
    defaultZone: 'Europe/Madrid',
    entities: new Map([
      [MADRID, { id: MADRID, name: 'Acme SL', country: 'ES', timeZone: 'Europe/Madrid' }],
      [BANGALORE, { id: BANGALORE, name: 'Acme India', country: 'IN', timeZone: 'Asia/Kolkata' }],
    ]),
    locations: new Map(),
  };
  const before = [define({ key: 'cost_centre' })];
  const after = [
    define({
      key: 'cost_centre',
      requiredness: { mode: 'always', requiredFrom: '2026-09-24', appliesTo: 'all_records' },
    }),
  ];
  const at = (entity: string, n: number): EvaluablePerson[] =>
    Array.from({ length: n }, (_, i) => ({
      personId: `${entity}-${String(i)}`,
      facts: facts({ legalEntityId: entity }),
      placement: { legalEntityId: entity, locationId: null, ownZone: null },
    }));

  it('requires the field in Bangalore, where the 24th has begun, and not yet in Madrid', () => {
    // 20:00 UTC on the 23rd: 01:30 on the 24th in Kolkata, 22:00 on the 23rd in Madrid.
    const impact = computeImpact(
      before,
      after,
      [...at(MADRID, 4), ...at(BANGALORE, 3)],
      fixedClock('2026-09-23T20:00:00.000Z'),
      calendar,
    );
    expect(impact).toMatchObject({ evaluated: 7, becomingIncomplete: 3 });
  });

  it('is UTC for everybody when no calendar is given', () => {
    const impact = computeImpact(
      before,
      after,
      [...at(MADRID, 4), ...at(BANGALORE, 3)],
      fixedClock('2026-09-23T20:00:00.000Z'),
    );
    expect(impact).toMatchObject({ becomingIncomplete: 0 });
  });
});
