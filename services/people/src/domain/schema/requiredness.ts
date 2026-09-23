import type { Clock } from '@kithena/domain-kit';
import type {
  EmploymentType,
  PersonStatus,
  PredicateClause,
  Requiredness,
  WorkModel,
} from '@kithena/contracts';

/**
 * Whether a field is required of this person, on this day.
 *
 * Pure, and deliberately so: this runs once per person per published version,
 * which for a tenant with 50,000 people is 50,000 × the number of conditional
 * fields. Anything that reached for a database here would turn a publish into
 * an outage.
 *
 * **The failure direction is the design.** A predicate that cannot be
 * evaluated — it names an attribute somebody archived last week — evaluates to
 * *not required*, and says which attribute it could not read so an operational
 * alert can name it. Failing towards "required" would take a configuration
 * typo and turn it into four hundred employees who cannot complete their
 * profile, on a Monday, all at once.
 */

/** What a predicate is allowed to read. Nothing else is reachable from a rule. */
export interface PersonFacts {
  readonly legalEntityId: string | null;
  readonly country: string | null;
  readonly employmentType: EmploymentType | null;
  readonly workModel: WorkModel | null;
  readonly status: PersonStatus;
  /** Current values, by attribute key. Canonical forms, not rendered labels. */
  readonly values: Readonly<Record<string, unknown>>;
  /**
   * Which attribute keys the published version still knows about.
   *
   * Separate from `values` because "the field exists and is blank" and "the
   * field was archived" are different answers, and only the second one is a
   * configuration problem somebody should hear about.
   */
  readonly knownAttributes: ReadonlySet<string>;
}

export interface RequirednessVerdict {
  readonly required: boolean;
  /**
   * Attribute keys the predicate named and could not read.
   *
   * Non-empty means the verdict is `false` because the rule was broken rather
   * than because it did not hold, and those are different things to tell an
   * administrator.
   */
  readonly unevaluable: readonly string[];
}

const NOT_REQUIRED: RequirednessVerdict = { required: false, unevaluable: [] };

export function evaluateRequiredness(
  rule: Requiredness,
  facts: PersonFacts,
  clock: Clock,
  /**
   * Whose calendar "today" is read on — the person's (PRD §6.8). Required: a
   * silent UTC default is the bug that put Auckland on yesterday.
   */
  timeZone: string,
): RequirednessVerdict {
  if (rule.mode === 'never') return NOT_REQUIRED;

  // Checked before the predicate, because a rule that does not bite yet does
  // not need to be evaluable yet either — an admin scheduling a field for
  // January should not get an alert in September.
  if (rule.requiredFrom !== null && clock.date(timeZone) < rule.requiredFrom) return NOT_REQUIRED;

  if (rule.mode === 'always') return { required: true, unevaluable: [] };

  const unevaluable: string[] = [];
  const results = rule.when.clauses.map((clause) => holds(clause, facts, unevaluable));

  // A half-evaluable predicate is not a predicate. Reporting `any` as true
  // because the clause that *did* resolve happened to hold would make the
  // answer depend on which half of a broken rule ran first.
  if (unevaluable.length > 0) return { required: false, unevaluable };

  const required = rule.when.combine === 'all' ? results.every(Boolean) : results.some(Boolean);
  return { required, unevaluable: [] };
}

function holds(clause: PredicateClause, facts: PersonFacts, unevaluable: string[]): boolean {
  switch (clause.operand) {
    case 'legalEntity': {
      return facts.legalEntityId !== null && clause.in.includes(facts.legalEntityId as never);
    }
    case 'country': {
      return facts.country !== null && clause.in.includes(facts.country);
    }
    case 'employmentType': {
      return facts.employmentType !== null && clause.in.includes(facts.employmentType);
    }
    case 'workModel': {
      return facts.workModel !== null && clause.in.includes(facts.workModel);
    }
    case 'status': {
      return clause.in.includes(facts.status);
    }
    case 'attribute': {
      const key = clause.key as string;
      if (!facts.knownAttributes.has(key)) {
        unevaluable.push(key);
        return false;
      }

      const value = facts.values[key];
      // An empty string is what a form posts for a field somebody skipped, and
      // reading it as "set" would satisfy a rule nobody answered.
      const isSet = value !== undefined && value !== null && value !== '';
      if (clause.is === 'set') return isSet;

      /*
       * Only a scalar can equal the string a rule was written against.
       *
       * An address, a repeating group or a document reference stringifies to
       * `[object Object]`, which would compare equal to every other object of
       * its kind — one rule quietly matching every record with any address at
       * all. A structured value is not comparable to a scalar, so the clause
       * does not hold rather than holding by accident.
       */
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return false;
      }
      return isSet && String(value) === clause.equals;
    }
  }
}
