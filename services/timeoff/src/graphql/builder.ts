import { createBuilder } from '@kithena/graphql-kit';

/** Yoga's default context carries the Fetch request; that is all the subgraph needs. */
export interface RequestContext {
  readonly request?: { readonly headers: Headers };
}

/**
 * The Time Off subgraph's one builder. `JSON` carries a write's body, which
 * REST's Zod schema checks, and the few answers whose shape is the policy
 * language's own unions.
 */
export const builder = createBuilder<{
  Context: RequestContext;
  Scalars: { JSON: { Input: unknown; Output: unknown } };
}>();

export type TimeOffBuilder = typeof builder;
