import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition, ViewerScope, WriterRole } from '@kithena/contracts';

import { evaluatePredicate, type PersonFacts } from '../schema/requiredness.js';

/**
 * Field-level authorization, as a pure intersection.
 *
 * The relations come from OpenFGA — `self`, `manager`, `manager_chain`, `hr`,
 * `finance`, `people_admin` — resolved once per request and passed in here.
 * One check for the person, then a local intersection per attribute; a profile
 * read is not one FGA call per field.
 *
 * **A field the viewer may not read is absent, not present-and-null.** That is
 * the rule the shape of `readable` exists to enforce. Present-and-null tells a
 * manager that a field exists and that somebody filled it in, and for a
 * diversity self-identification answer that is the disclosure itself: it
 * separates "declined to answer" from "answered", without showing either.
 *
 * This lives in the domain, and the read path and the write path both call it,
 * because GraphQL is one transport of four. A rule enforced in a resolver
 * leaks through REST, SCIM, webhooks and workers.
 */

export interface ViewerRelations {
  readonly isSelf: boolean;
  readonly isManager: boolean;
  readonly isInManagerChain: boolean;
  readonly isHr: boolean;
  readonly isFinance: boolean;
  /** `people_admin`: may edit the schema. Not a key to every value in it. */
  readonly isAdmin: boolean;
  /**
   * The person being looked at, when there is one, for custom visibility
   * rules (PEO-066). Absent for a question about everybody — a filter, a
   * search, a directory column — and then no rule holds: a rule is true of
   * some records, and those questions answer for all of them.
   */
  readonly subject?: PersonFacts;
}

/** Which scopes this viewer satisfies. `directory` is everyone in the tenant. */
function scopesOf(viewer: ViewerRelations): ReadonlySet<ViewerScope> {
  const scopes = new Set<ViewerScope>(['directory']);
  if (viewer.isSelf) scopes.add('self');
  if (viewer.isManager) scopes.add('manager');
  // A direct manager is in their own report's chain; the reverse is not true.
  if (viewer.isManager || viewer.isInManagerChain) scopes.add('manager_chain');
  if (viewer.isHr) scopes.add('hr');
  if (viewer.isFinance) scopes.add('finance');
  if (viewer.isAdmin) scopes.add('admin');
  return scopes;
}

/** Which writer roles this viewer holds. */
function rolesOf(viewer: ViewerRelations): ReadonlySet<WriterRole> {
  const roles = new Set<WriterRole>();
  if (viewer.isSelf) roles.add('employee');
  if (viewer.isManager) roles.add('manager');
  if (viewer.isHr) roles.add('hr');
  if (viewer.isFinance) roles.add('finance');
  return roles;
}

/**
 * Whether this viewer may read this attribute.
 *
 * An empty `visibility` means nobody, and that is a real configuration rather
 * than an oversight — §6.7 requires it for voluntary self-identification,
 * which is answerable only in aggregate. `admin` is deliberately not a
 * fallback: editing the schema is not a key to every value in it.
 */
export function visibleTo(definition: AttributeDefinition, viewer: ViewerRelations): boolean {
  const scopes = scopesOf(viewer);
  if (definition.visibility.some((scope) => scopes.has(scope))) return true;

  // A custom rule (PEO-066) grants one of the same scopes, on the records its
  // predicate holds for. Never for special-category data, whatever a stored
  // document says: the contract refuses it, and this is the read side of that.
  const { subject } = viewer;
  if (subject === undefined || definition.classification.classification === 'special-category') {
    return false;
  }
  return (definition.visibilityRules ?? []).some(
    (rule) =>
      rule.scopes.some((scope) => scopes.has(scope)) && evaluatePredicate(rule.when, subject).holds,
  );
}

/**
 * The values this viewer may see, with the rest absent.
 *
 * Driven by the definitions rather than by the values, which is what makes the
 * response shape independent of what happens to be filled in. A key that
 * appeared only when there was something to hide would answer the question by
 * its presence.
 */
export function readable(
  definitions: readonly AttributeDefinition[],
  values: Readonly<Record<string, unknown>>,
  viewer: ViewerRelations,
): Record<string, unknown> {
  const seen: Record<string, unknown> = {};

  for (const definition of definitions) {
    if (!visibleTo(definition, viewer)) continue;
    const key = definition.key as string;
    if (!Object.hasOwn(values, key)) continue;
    seen[key] = values[key];
  }

  return seen;
}

/**
 * A person's history as this viewer may read it (PEO-064, §8.5).
 *
 * Judged by today's rules, never the rules the row was written under: a row
 * of a field the viewer cannot read now is absent, whoever could read it then,
 * and so is a row of a field no longer in the schema. A field that is sealed
 * now shows none of its past values — only that it changed — because a
 * classification that tightened after the write must not be undone by
 * scrolling back: a value written in plaintext before the field was
 * encrypted is exactly the plaintext the seal exists to hide.
 */
export function readableHistory<
  E extends { readonly attributeKey: string; readonly value: unknown },
>(
  definitions: readonly AttributeDefinition[],
  entries: readonly E[],
  viewer: ViewerRelations,
): E[] {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  return entries.flatMap((e) => {
    const definition = byKey.get(e.attributeKey);
    if (definition === undefined || !visibleTo(definition, viewer)) return [];
    return definition.encrypted ? [{ ...e, value: null }] : [e];
  });
}

/**
 * Whether this viewer may write this attribute.
 *
 * Ownership, not visibility, and the two genuinely differ: an employee owns
 * their bank account and cannot see their own salary band; HR can read a
 * national identifier and is not the one who should be typing it.
 */
export function canWrite(definition: AttributeDefinition, viewer: ViewerRelations): Result<void> {
  if (definition.deprecatedAt !== null) {
    return err(
      failure('FIELD_DEPRECATED', `${definition.key} is no longer collected`, [definition.key]),
    );
  }

  const roles = rolesOf(viewer);
  if (definition.ownership.some((role) => roles.has(role))) return ok(undefined);

  return err(
    failure('FIELD_NOT_WRITABLE', `${definition.key} is not yours to change`, [definition.key]),
  );
}

/**
 * Split a proposed write into what this viewer may change and what they may not.
 *
 * Returned rather than thrown on the first refusal, because a form posting six
 * fields of which one is not theirs deserves to be told which one — and
 * because the application layer decides whether a partial write is acceptable
 * for that transport. An import says yes; a profile form says no.
 */
export function partitionWrites(
  definitions: readonly AttributeDefinition[],
  proposed: Readonly<Record<string, unknown>>,
  viewer: ViewerRelations,
): { readonly allowed: Record<string, unknown>; readonly refused: readonly string[] } {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const allowed: Record<string, unknown> = {};
  const refused: string[] = [];

  for (const [key, value] of Object.entries(proposed)) {
    const definition = byKey.get(key);
    if (!definition || !canWrite(definition, viewer).ok) {
      refused.push(key);
      continue;
    }
    allowed[key] = value;
  }

  return { allowed, refused };
}
