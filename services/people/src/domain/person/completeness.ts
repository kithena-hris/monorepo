import type { Clock } from '@kithena/domain-kit';
import type { AttributeDefinition, WriterRole } from '@kithena/contracts';

import { evaluateRequiredness, type PersonFacts } from '../schema/requiredness.js';

/**
 * Whether a record has everything the published version asks of it.
 *
 * Derived rather than stored as a decision: a record becomes incomplete
 * because somebody published a version, not because anybody edited the record.
 * That is why this is a pure function of (definitions, facts, clock) and why
 * the recompute in PEO-026 can simply run it again over everybody.
 *
 * **Nothing is blocked by the answer.** §8.4 is explicit: not saving, not
 * signing in, not another module. What comes back is a description of what is
 * missing and who owns each gap, because those two facts decide what happens
 * next — an employee-owned gap is a task and a reminder on a decaying
 * schedule, an HR-owned gap aggregates into one grid rather than 88 tasks.
 */

export type CompletenessState = 'complete' | 'incomplete' | 'not_applicable';

export interface MissingAttribute {
  readonly key: string;
  readonly sectionKey: string;
  readonly owners: readonly WriterRole[];
}

/** A rule that names something the published version no longer has. */
export interface BrokenRule {
  readonly key: string;
  readonly reads: readonly string[];
}

export interface CompletenessVerdict {
  readonly state: CompletenessState;
  readonly missing: readonly MissingAttribute[];
  /**
   * Rules that could not be evaluated, for an operational alert.
   *
   * Not shown to the employee and not counted as missing: a configuration
   * mistake is the tenant administrator's to fix, and telling four hundred
   * people about it makes it four hundred support tickets.
   */
  readonly unevaluable: readonly BrokenRule[];
}

/**
 * The states that have nothing to be complete about.
 *
 * A provisional record is an account with nobody's details in it yet, and a
 * discarded one is a mistake somebody withdrew. Counting either as incomplete
 * would nag a person on day zero for fields nobody has asked them for.
 */
const NOT_APPLICABLE = new Set(['provisional', 'discarded']);

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  // A form posts an empty string for a field somebody skipped, and a trimmed
  // blank for one they tabbed through.
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function assessCompleteness(
  definitions: readonly AttributeDefinition[],
  facts: PersonFacts,
  clock: Clock,
  /** Whose calendar "today" is read on (PRD §6.8). Required: there is no safe default. */
  timeZone: string,
): CompletenessVerdict {
  if (NOT_APPLICABLE.has(facts.status)) {
    return { state: 'not_applicable', missing: [], unevaluable: [] };
  }

  const missing: MissingAttribute[] = [];
  const unevaluable: BrokenRule[] = [];

  for (const definition of definitions) {
    // A deprecated field is hidden from every form. Counting it would ask for
    // something nobody can be shown.
    if (definition.deprecatedAt !== null) continue;

    const verdict = evaluateRequiredness(definition.requiredness, facts, clock, timeZone);
    if (verdict.unevaluable.length > 0) {
      unevaluable.push({ key: definition.key, reads: verdict.unevaluable });
    }
    if (!verdict.required) continue;
    if (hasValue(facts.values[definition.key])) continue;

    missing.push({
      key: definition.key,
      sectionKey: definition.sectionKey,
      owners: definition.ownership,
    });
  }

  return {
    state: missing.length === 0 ? 'complete' : 'incomplete',
    missing,
    unevaluable,
  };
}

/**
 * The blanks that are blank because no rule asks for them of this person
 * (PRD §15.4's "not applicable"): a field with a rule — conditional, or not in
 * force yet on this day — that does not bite here, and no value.
 *
 * Separate from `assessCompleteness` because nothing but a rendering needs it:
 * an export shades these grey so they read differently from a missing value
 * and from an optional field nobody filled. A field with no rule at all
 * (`never`) is optional, not "not applicable", and is not listed.
 */
export function notApplicable(
  definitions: readonly AttributeDefinition[],
  facts: PersonFacts,
  clock: Clock,
  /** Whose calendar "today" is read on (PRD §6.8). Required: there is no safe default. */
  timeZone: string,
): readonly string[] {
  if (NOT_APPLICABLE.has(facts.status)) return [];
  return definitions
    .filter((d) => d.deprecatedAt === null && d.requiredness.mode !== 'never')
    .filter((d) => !hasValue(facts.values[d.key]))
    .filter((d) => !evaluateRequiredness(d.requiredness, facts, clock, timeZone).required)
    .map((d) => d.key);
}

/**
 * The gaps, split by who has to close them.
 *
 * Here rather than in the application layer because the split is a rule about
 * ownership rather than about delivery: a field owned by both HR and the
 * employee is HR's to chase, since asking both produces two people each
 * waiting for the other.
 */
export function gapsByOwner(verdict: CompletenessVerdict): {
  readonly employee: readonly MissingAttribute[];
  readonly staff: readonly MissingAttribute[];
} {
  const employee = verdict.missing.filter(
    (m) => m.owners.includes('employee') && !m.owners.some((o) => o === 'hr' || o === 'finance'),
  );
  const staff = verdict.missing.filter((m) => !employee.includes(m));
  return { employee, staff };
}
