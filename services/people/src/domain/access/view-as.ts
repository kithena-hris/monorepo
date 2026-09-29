import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { visibleTo, type ViewerRelations } from './field-access.js';

/**
 * Viewing as an employee (decided 2026-09-29). Pure.
 *
 * A People administrator sees the app exactly as one employee sees it —
 * their own private data included, as the employee reads it — and can change
 * nothing. Not Kithena support: support is a full administrator of the
 * company, from the back office; this is somebody at the company, as one named
 * employee, read-only, from that employee's profile.
 *
 * Who may start one is decided here. That nothing is written while viewing is
 * `writable`, which every transport asks before a write, and which a read-only
 * database transaction backs for everything a viewing request touches
 * (`unit-of-work.ts`).
 */

export const ViewOnly = failure(
  'VIEW_ONLY',
  'You are viewing as somebody else, so nothing can be changed',
);

/** Whether this viewer may change anything at all. */
export function writable(viewer: { readonly viewing?: unknown }): Result<void> {
  return viewer.viewing === undefined ? ok(undefined) : err(ViewOnly);
}

/** The one asking to view as somebody. */
export interface ViewAsAsker {
  readonly accountId: string;
  /** Holds `people_admin`: granted, not Kithena support's by its session. */
  readonly administrator: boolean;
  readonly support: boolean;
  readonly viewing: boolean;
}

/** The employee they would view as. */
export interface ViewAsTarget {
  /** The account they sign in as; null for somebody who never had one. */
  readonly accountId: string | null;
  /** Holds `people_admin`. */
  readonly administrator: boolean;
  /** Their access has not ended. */
  readonly active: boolean;
}

export function mayViewAs(asker: ViewAsAsker, target: ViewAsTarget): Result<void> {
  if (asker.viewing) return err(ViewOnly);
  if (asker.support) {
    return err(failure('FORBIDDEN', 'Kithena support does not view as an employee'));
  }
  if (!asker.administrator) {
    return err(failure('FORBIDDEN', 'Only a People administrator may view as somebody'));
  }
  if (target.accountId === null || !target.active) {
    return err(
      failure('VIEW_AS_NO_ACCOUNT', 'They cannot sign in, so there is nothing of theirs to see'),
    );
  }
  if (target.accountId === asker.accountId) {
    return err(failure('VIEW_AS_SELF', 'This is you'));
  }
  if (target.administrator) {
    return err(
      failure('VIEW_AS_ADMINISTRATOR', 'Another People administrator cannot be viewed as'),
    );
  }
  return ok(undefined);
}

/**
 * Whether the employee's view shows special-category data, which an
 * administrator viewing as them then sees: the audit entry and the
 * employee's notice both say so.
 *
 * `own` is who they are to their own record — `self`, with their roles — and
 * `values` that record. `elsewhere` is who they are to anybody else: their
 * roles, and a manager when they manage somebody. A value of their own counts
 * only when it is there; a field they read on others counts whatever this
 * record holds, since the administrator could have opened any of those.
 */
export function specialCategoryVisible(
  definitions: readonly AttributeDefinition[],
  values: Readonly<Record<string, unknown>>,
  own: ViewerRelations,
  elsewhere: ViewerRelations,
): boolean {
  const special = definitions.filter(
    (d) => d.classification.classification === 'special-category',
  );
  const filled = (key: string): boolean => {
    const value = values[key];
    return value !== undefined && value !== null && value !== '';
  };
  return special.some(
    (d) => (visibleTo(d, own) && filled(d.key)) || visibleTo(d, elsewhere),
  );
}
