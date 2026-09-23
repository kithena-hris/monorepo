import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { visibleTo, type ViewerRelations } from '../../domain/access/field-access.js';
import { COHORT_FLOOR } from '../../domain/org/calendar.js';

export { COHORT_FLOOR };

/**
 * Who may draw which chart, and the cohort minimum. Pure.
 *
 * §16.1's rules, as the query layer applies them before a number leaves it:
 *
 * 1. **A chart is a read.** Breaking down or filtering by a field is reading
 *    it, so each one goes through `visibleTo` — the same decision a profile
 *    read makes. A manager's charts count their own chain and nobody else.
 * 2. **Cohort minimum.** A breakdown touching special-category data is served
 *    to HR only, and withheld whole when any cell is under the minimum. It is
 *    served from a monthly publication, rounded, never live (`publish.ts`).
 *
 * Enforced here rather than in a chart component, because the tooltip and the
 * export are built from what this layer returns: a number it withheld is a
 * number neither of them has.
 */

/**
 * Who is asking, as the caller resolved it from OpenFGA.
 *
 * Two shapes, not a bag of relations, because a chart is over a population
 * rather than about one person: HR sees the tenant, a manager sees their
 * chain. The caller maps the principal to one of these; nothing here trusts a
 * claim about scope beyond the variant it was handed.
 */
export type ChartViewer =
  { readonly kind: 'hr' } | { readonly kind: 'manager'; readonly personId: string };

/** The relations `visibleTo` reads, for somebody looking at a population. */
export function relationsOf(viewer: ChartViewer): ViewerRelations {
  const none = {
    isSelf: false,
    isManager: false,
    isInManagerChain: false,
    isHr: false,
    isFinance: false,
    isAdmin: false,
  };
  return viewer.kind === 'hr'
    ? { ...none, isHr: true }
    : { ...none, isManager: true, isInManagerChain: true };
}

/** Which snapshot rows this viewer counts: the tenant's, or their own chain's. */
export function scopeOf(viewer: ChartViewer, tenantId: string): string {
  return viewer.kind === 'hr' ? tenantId : viewer.personId;
}

const isSpecial = (definition: AttributeDefinition): boolean =>
  definition.classification.classification === 'special-category';

/**
 * Whether this viewer may break down or filter by these fields.
 *
 * `special` comes back true when any of them is special-category, and the
 * caller then applies the cohort minimum to the whole result. A field the
 * tenant never published is refused rather than assumed readable: a chart over
 * a field nobody defined has no visibility to check, and "no rule" is not
 * "allowed".
 */
export function authorizeFields(
  definitions: readonly AttributeDefinition[],
  viewer: ChartViewer,
  keys: readonly string[],
): Result<{ readonly special: boolean }> {
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  const relations = relationsOf(viewer);
  let special = false;

  for (const key of keys) {
    const definition = byKey.get(key);
    if (definition === undefined) {
      return err(failure('FIELD_NOT_READABLE', `${key} is not a field you can chart`, [key]));
    }

    /*
     * Special-category data is visible to nobody as a value (§6.7), so
     * `visibleTo` refuses it for everybody — and the aggregate is still HR's
     * to see. Never a manager's: a team of eight is a cohort small enough to
     * name.
     */
    if (isSpecial(definition)) {
      if (viewer.kind !== 'hr') {
        return err(
          failure('SPECIAL_CATEGORY_HR_ONLY', `${key} is reported to HR in aggregate only`, [key]),
        );
      }
      special = true;
      continue;
    }

    if (!visibleTo(definition, relations)) {
      return err(failure('FIELD_NOT_READABLE', `${key} is not a field you can chart`, [key]));
    }
  }

  return ok({ special });
}

/**
 * The minimum in force, whatever the tenant's setting says.
 *
 * Anything that is not a whole number above the floor reads as the floor: a
 * setting stored as 3, as 12.5 or as nothing at all never lowers it.
 */
export function cohortMinimum(tenantSetting: number | undefined): number {
  return tenantSetting !== undefined &&
    Number.isInteger(tenantSetting) &&
    tenantSetting > COHORT_FLOOR
    ? tenantSetting
    : COHORT_FLOOR;
}

export type Suppressed<T> =
  | {
      readonly status: 'ok';
      readonly cells: readonly T[];
      /**
       * A published breakdown's population (PEO-083), rounded on its own.
       * Never the sum of the rounded cells, so never add them up to get it.
       */
      readonly total?: number;
    }
  | { readonly status: 'insufficient_data'; readonly minimum: number };

/**
 * The breakdown, or nothing.
 *
 * All or nothing rather than cell by cell, because a cell withheld beside
 * cells shown is a subtraction away: headcount sits on the card next to this
 * one, and headcount minus the cells shown is the cell hidden. An empty
 * breakdown is withheld too — "nobody answered" is itself an answer about a
 * cohort of zero.
 */
export function suppressSmallCohorts<T extends { readonly count: number }>(
  cells: readonly T[],
  minimum: number,
): Suppressed<T> {
  if (cells.length === 0 || cells.some((cell) => cell.count < minimum)) {
    return { status: 'insufficient_data', minimum };
  }
  return { status: 'ok', cells };
}

const INSUFFICIENT = 'insufficient data';

type Cell = { readonly bucket: string; readonly count: number };

/**
 * What a tooltip over one bar says.
 *
 * Built from the query's result and from nothing else, so a withheld
 * breakdown has no number here to show.
 */
export function chartTooltip(
  result: Suppressed<Cell>,
  bucket: string,
): { readonly bucket: string; readonly value: number | typeof INSUFFICIENT } {
  if (result.status !== 'ok') return { bucket, value: INSUFFICIENT };
  return { bucket, value: result.cells.find((c) => c.bucket === bucket)?.count ?? 0 };
}

/**
 * The rows a CSV or XLSX export of the chart carries (§16.3: exporting a chart
 * exports its data). The same result, so the same suppression — and for a
 * published breakdown the same rounding, with its total and the note saying
 * the total was rounded on its own, so a spreadsheet does not sum the cells.
 */
export function chartExport(
  result: Suppressed<Cell> & { readonly note?: string },
): readonly (readonly (string | number)[])[] {
  const header = ['bucket', 'count'];
  if (result.status !== 'ok') return [header, [INSUFFICIENT, '']];
  return [
    header,
    ...result.cells.map((c) => [c.bucket, c.count]),
    ...(result.total === undefined ? [] : [['total', result.total]]),
    ...(result.note === undefined ? [] : [[result.note, '']]),
  ];
}
