import type { Clock } from '@kithena/domain-kit';
import type { AttributeDefinition, WriterRole } from '@kithena/contracts';

import { assessCompleteness, gapsByOwner } from '../../domain/person/completeness.js';
import type { PersonFacts } from '../../domain/schema/requiredness.js';

/**
 * What publishing a version would do to the people already on file.
 *
 * This is the number that stops a Friday afternoon becoming four hundred
 * emails. §9.3 shows it before anything is written — "88 of 412 people become
 * incomplete, 61 fields owned by employees, 27 owned by you" — and an HR admin
 * who can see that consequence picks a sensible `requiredFrom`, while one who
 * cannot marks six fields required and finds out from the inbox.
 *
 * Computed the same way the recompute computes it, from the same pure
 * functions, because a preview that disagreed with the result would be worse
 * than no preview: it would be a number somebody trusted.
 */

export interface PersonImpact {
  readonly personId: string;
  /** Keys that are missing under the candidate version and were not before. */
  readonly newlyMissing: readonly string[];
}

export interface PublishImpact {
  /** Everybody the candidate version was evaluated against. */
  readonly evaluated: number;
  /** Complete today, incomplete under the candidate. */
  readonly becomingIncomplete: number;
  /** Already incomplete, and staying that way. */
  readonly alreadyIncomplete: number;
  /**
   * Incomplete today and complete under the candidate.
   *
   * Loosening a requirement is a publish too, and an admin undoing Friday's
   * mistake deserves to see that it undoes it.
   */
  readonly becomingComplete: number;
  /**
   * Missing fields by who has to fill them in, counted across everybody.
   *
   * The split is the actionable half: employee-owned gaps become tasks and
   * reminders, HR-owned gaps become one bulk-edit grid. A single total would
   * hide which of those two an admin is about to cause.
   */
  readonly fieldsByOwner: Readonly<Record<'employee' | 'staff', number>>;
  /** Per person, for the grid that comes after the publish. */
  readonly people: readonly PersonImpact[];
}

/**
 * One person's facts, paired with the id the impact is reported against.
 *
 * A pair rather than an id on `PersonFacts`, because the domain's requiredness
 * evaluation has no business knowing which record it is looking at — it reads
 * facts and answers a question about them.
 */
export interface EvaluablePerson {
  readonly personId: string;
  readonly facts: PersonFacts;
}

export function computeImpact(
  before: readonly AttributeDefinition[],
  after: readonly AttributeDefinition[],
  people: Iterable<EvaluablePerson>,
  clock: Clock,
  timeZone = 'Etc/UTC',
): PublishImpact {
  let evaluated = 0;
  let becomingIncomplete = 0;
  let alreadyIncomplete = 0;
  let becomingComplete = 0;
  let employeeFields = 0;
  let staffFields = 0;
  const affected: PersonImpact[] = [];

  for (const { personId, facts } of people) {
    evaluated += 1;

    const was = assessCompleteness(before, facts, clock, timeZone);
    const will = assessCompleteness(after, facts, clock, timeZone);

    /*
     * A provisional record is `not_applicable` under both, and counting it
     * either way would inflate the number an admin is being asked to accept.
     * Nobody has been asked for anything yet.
     */
    if (will.state === 'not_applicable') continue;

    if (will.state === 'incomplete') {
      if (was.state === 'incomplete') alreadyIncomplete += 1;
      else becomingIncomplete += 1;

      const owners = gapsByOwner(will);
      employeeFields += owners.employee.length;
      staffFields += owners.staff.length;

      const previously = new Set(was.missing.map((m) => m.key));
      const newlyMissing = will.missing.map((m) => m.key).filter((key) => !previously.has(key));
      if (newlyMissing.length > 0) affected.push({ personId, newlyMissing });
      continue;
    }

    if (was.state === 'incomplete') becomingComplete += 1;
  }

  return {
    evaluated,
    becomingIncomplete,
    alreadyIncomplete,
    becomingComplete,
    fieldsByOwner: { employee: employeeFields, staff: staffFields },
    people: affected,
  };
}

/**
 * Which roles own the fields a publish would newly require.
 *
 * For the alert copy, which names them rather than saying "some fields are
 * owned by others" — an admin deciding whether to publish is deciding whose
 * week they are about to fill.
 */
export function ownersOf(
  definitions: readonly AttributeDefinition[],
  keys: readonly string[],
): readonly WriterRole[] {
  const wanted = new Set(keys);
  const owners = new Set<WriterRole>();
  for (const definition of definitions) {
    if (!wanted.has(definition.key)) continue;
    for (const role of definition.ownership) owners.add(role);
  }
  return [...owners].toSorted();
}
