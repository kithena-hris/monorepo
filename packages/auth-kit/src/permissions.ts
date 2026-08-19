import type { AuthorizationContext } from './principal.js';

export type Relation = 'can_view' | 'can_view_compensation' | 'can_approve' | 'can_administer';

export interface ObjectRef {
  readonly type: string;
  readonly id: string;
}

/**
 * Relationship-based access control, backed by OpenFGA.
 *
 * `filter` and `listAccessible` matter as much as `check`. Without them every
 * list endpoint becomes an N-query permission loop, and permission-aware
 * search has nothing to filter on before retrieval.
 */
export interface PermissionCheck {
  check(ctx: AuthorizationContext, rel: Relation, object: ObjectRef): Promise<boolean>;
  filter<T extends ObjectRef>(
    ctx: AuthorizationContext,
    rel: Relation,
    objects: readonly T[],
  ): Promise<T[]>;
  /** Precomputed accessible set, cached with a permission-version stamp and
   *  passed to Typesense as a filter. Filtering after retrieval breaks
   *  pagination and leaks record counts. */
  listAccessible(ctx: AuthorizationContext, rel: Relation, type: string): Promise<string[]>;
}
