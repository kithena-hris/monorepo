import { createBuilder } from '@kithena/graphql-kit';

/**
 * The People subgraph's one builder, shared by `schema.ts` and `screens.ts`
 * so neither imports the other.
 */

/** Yoga's default context carries the Fetch request; that is all this needs. */
export interface RequestContext {
  readonly request?: { readonly headers: Headers };
}

export const builder = createBuilder<{ Context: RequestContext }>();
export type PeopleBuilder = typeof builder;

export type ViaRest = <T = unknown>(
  ctx: RequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options?: { readonly body?: unknown; readonly key?: string },
) => Promise<T>;
