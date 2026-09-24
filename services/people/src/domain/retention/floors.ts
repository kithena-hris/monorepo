import { err, failure, Forbidden, ok, type Result } from '@kithena/domain-kit';
import type { RetentionPolicy } from '@kithena/contracts';

/**
 * The statutory retention floors, and whether a lawyer has said they are right
 * (PEO-126; PRD §12).
 *
 * A floor is law, not tenant configuration, so it lives here rather than in a
 * table: one answer for every tenant, changed by a reviewed commit.
 *
 * **Nothing erases automatically on an unreviewed floor.** Until counsel signs
 * one off, a scheduler or a nightly job relying on it is refused by `mayErase`,
 * and only HR, by hand, for one person, with a stated reason, may act on it —
 * the reason travels on `people.person.anonymised` beside the actor. Keeping
 * too long is the reversible mistake; erasing on a wrong number is not.
 */

export type StatutoryFloor = NonNullable<RetentionPolicy['statutoryFloor']>;

/**
 * Months each floor holds a record after employment ends.
 *
 * es-labour: 4 years, the LISOS art. 21 limitation for labour infringements.
 * de-labour: 6 years, HGB §257 for business correspondence. eu-payroll: 10
 * years, the longest tax-record retention among the member states we sell to
 * (e.g. AO §147). Every one pending counsel: see `FLOOR_REVIEWS`.
 */
export const STATUTORY_FLOOR_MONTHS: Readonly<Record<StatutoryFloor, number>> = {
  'es-labour': 48,
  'de-labour': 72,
  'eu-payroll': 120,
};

export type FloorReview =
  | { readonly status: 'unreviewed' }
  | {
      readonly status: 'reviewed';
      /** Who signed it off: a named lawyer and their firm. */
      readonly reviewer: string;
      /** A calendar date. */
      readonly reviewedOn: string;
      /** Where the written opinion is kept. */
      readonly reference: string;
    };

/**
 * Whether counsel has reviewed each floor.
 *
 * Changed only by `pnpm retention:review-floor` (docs/people-prd.md §12), an
 * operator's action whose commit is the audit record. Nothing in the running
 * service writes it, so a floor can never become reviewed by itself. The
 * script rewrites one entry, so keep one entry per floor and no nested braces.
 */
export const FLOOR_REVIEWS: Readonly<Record<StatutoryFloor, FloorReview>> = {
  'es-labour': { status: 'unreviewed' },
  'de-labour': { status: 'unreviewed' },
  'eu-payroll': { status: 'unreviewed' },
};

export interface FloorView {
  readonly floor: StatutoryFloor;
  readonly months: number;
  readonly review: FloorReview;
}

/** Every floor, its months and its review, in a fixed order. */
export const statutoryFloors = (reviews = FLOOR_REVIEWS): readonly FloorView[] =>
  (Object.keys(STATUTORY_FLOOR_MONTHS) as StatutoryFloor[]).map((floor) => ({
    floor,
    months: STATUTORY_FLOOR_MONTHS[floor],
    review: reviews[floor],
  }));

/**
 * How an erasure was asked for. `automated` is anything nobody asked for by
 * hand: a schedule, a nightly job, a sweep. `manual` is HR, for one person.
 */
export type ErasureMode =
  | { readonly kind: 'automated' }
  | { readonly kind: 'manual'; readonly roles: ReadonlySet<string>; readonly reason: string };

/**
 * May an erasure relying on these floors go ahead?
 *
 * Automated: only when every one is reviewed. Manual: HR with a stated
 * reason, reviewed or not. Scheduling automated erasure asks the same
 * question (`automated`) before it schedules anything.
 */
export function mayErase(
  floors: readonly StatutoryFloor[],
  mode: ErasureMode,
  reviews = FLOOR_REVIEWS,
): Result<void> {
  if (mode.kind === 'manual') {
    if (!mode.roles.has('hr')) return err(Forbidden());
    if (mode.reason.trim() === '') {
      return err(failure('REASON_REQUIRED', 'Say why this is erased by hand', ['reason']));
    }
    return ok(undefined);
  }
  const unreviewed = [...new Set(floors)].filter((f) => reviews[f].status !== 'reviewed');
  if (unreviewed.length === 0) return ok(undefined);
  return err(
    failure(
      'RETENTION_FLOOR_UNREVIEWED',
      `Automated erasure is blocked until counsel reviews ${unreviewed.join(', ')}: pending legal review`,
    ),
  );
}
