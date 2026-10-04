import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { normalName } from '../import/identifiers.js';
import { checkName, type OrgUnit } from './calendar.js';

export type { OrgUnit };

/**
 * A company's org units: its departments and teams, as a tree.
 *
 * What a person's `org_unit_id` points at, what the directory and analytics
 * call a department, and what Time Off makes a team of. Each has a name and
 * an optional parent; archived rather than deleted, because people and their
 * history still point at it. Names are unique among live siblings — two
 * "Platform" teams under Engineering are one too many, one under Engineering
 * and one under Sales are not. The database holds the same rule by index.
 *
 * Not effective-dated, like a location's name: a rename or a move is
 * configuration, recorded when made, and the event says when.
 *
 * Pure.
 */

/** Between a parent's name and its child's in a path. */
export const PATH_SEPARATOR = ' › ';

const live = (u: OrgUnit): boolean => u.archived !== true;

function checkParent(units: readonly OrgUnit[], parentId: string | null): Result<string | null> {
  if (parentId === null) return ok(null);
  const parent = units.find((u) => u.id === parentId);
  if (parent === undefined) {
    return err(
      failure('ORG_UNIT_PARENT_NOT_FOUND', 'No such org unit in this workspace', ['parentId']),
    );
  }
  return live(parent)
    ? ok(parentId)
    : err(
        failure('ORG_UNIT_PARENT_ARCHIVED', `${parent.name} is archived: restore it first`, [
          'parentId',
        ]),
      );
}

function checkSiblings(
  units: readonly OrgUnit[],
  unit: { readonly id?: string; readonly name: string; readonly parentId: string | null },
): Result<void> {
  const wanted = normalName(unit.name);
  const twin = units.find(
    (u) =>
      u.id !== unit.id && live(u) && u.parentId === unit.parentId && normalName(u.name) === wanted,
  );
  return twin === undefined
    ? ok(undefined)
    : err(failure('ORG_UNIT_NAME_TAKEN', `There is already a ${twin.name} here`, ['name']));
}

export function checkNewUnit(
  units: readonly OrgUnit[],
  input: { readonly name: string; readonly parentId: string | null },
): Result<{ readonly name: string; readonly parentId: string | null }> {
  const name = checkName(input.name);
  if (!name.ok) return name;
  const parentId = checkParent(units, input.parentId);
  if (!parentId.ok) return parentId;
  const next = { name: name.value, parentId: parentId.value };
  const unique = checkSiblings(units, next);
  return unique.ok ? ok(next) : unique;
}

/** Whether `ancestor` is `id` or anywhere above it. */
function isAtOrAbove(units: readonly OrgUnit[], ancestor: string, id: string): boolean {
  const byId = new Map(units.map((u) => [u.id, u]));
  const seen = new Set<string>();
  for (
    let at: string | null = id;
    at !== null && !seen.has(at);
    at = byId.get(at)?.parentId ?? null
  ) {
    if (at === ancestor) return true;
    seen.add(at);
  }
  return false;
}

/** A rename, a move, an archive or a restore — or several at once — as the unit would then be. */
export function checkUnitChange(
  units: readonly OrgUnit[],
  id: string,
  change: {
    readonly name?: string;
    readonly parentId?: string | null;
    readonly archived?: boolean;
  },
): Result<Required<OrgUnit>> {
  const found = units.find((u) => u.id === id);
  if (found === undefined) return err(failure('NOT_FOUND', 'No such org unit'));
  const name = checkName(change.name ?? found.name);
  if (!name.ok) return name;
  const next = {
    id,
    name: name.value,
    parentId: change.parentId === undefined ? found.parentId : change.parentId,
    archived: change.archived ?? found.archived === true,
  };

  if (next.parentId !== null && isAtOrAbove(units, id, next.parentId)) {
    return err(
      failure('ORG_UNIT_CYCLE', 'An org unit cannot sit under itself or a unit beneath it', [
        'parentId',
      ]),
    );
  }
  if (next.archived) {
    const child = units.find((u) => u.parentId === id && live(u));
    return child === undefined
      ? ok(next)
      : err(
          failure(
            'ORG_UNIT_HAS_UNITS',
            `${found.name} still has ${child.name} under it: move or archive that first`,
          ),
        );
  }
  // Live after the change: under a live parent, and the only one of its name there.
  const parent = checkParent(units, next.parentId);
  if (!parent.ok) return parent;
  const unique = checkSiblings(units, next);
  return unique.ok ? ok(next) : unique;
}

/**
 * Every unit's path from the top: "Engineering › Platform › Web". A parent
 * that is not here ends the path; a loop (which the checks above never
 * write) ends where it repeats.
 */
export function unitPaths(units: readonly OrgUnit[]): Map<string, string> {
  const byId = new Map(units.map((u) => [u.id, u]));
  const paths = new Map<string, string>();
  for (const unit of units) {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let at: OrgUnit | undefined = unit; at !== undefined && !seen.has(at.id);) {
      seen.add(at.id);
      names.unshift(at.name);
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
    paths.set(unit.id, names.join(PATH_SEPARATOR));
  }
  return paths;
}
