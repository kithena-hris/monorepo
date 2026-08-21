import SchemaBuilder from '@pothos/core';
// The federation plugin renders `@key` and `@link` through the directives
// plugin. Without it registered first, the subgraph SDL prints clean and
// composes successfully — into a supergraph that has forgotten what an entity
// is, which surfaces as a null reference resolution at runtime rather than as
// a composition error.
import DirectivesPlugin from '@pothos/plugin-directives';
import FederationPlugin from '@pothos/plugin-federation';
// Published as `@pothos/plugin-zod`; `@pothos/plugin-zod-validation` has never
// existed on the registry.
import ZodPlugin from '@pothos/plugin-zod';
import type { GraphQLContext } from './context.js';

/**
 * One builder factory, used by every subgraph, so auth wiring and error
 * mapping are identical across 40 modules instead of 40 slightly different
 * interpretations of the same rule.
 *
 * Zod schemas from @kithena/contracts validate inputs here, which is the same
 * schema the REST facade and the forms use.
 */
export function createBuilder<
  // `Record<string, never>` would be wrong here: intersected with the real
  // schema types it maps every other key to `never`, and each `t.field` call
  // then reports its options as `never`. `Record<never, never>` is the empty
  // object type this actually wants.
  TTypes extends Record<string, unknown> = Record<never, never>,
>(): InstanceType<typeof SchemaBuilder<{ Context: GraphQLContext } & TTypes>> {
  type Types = { Context: GraphQLContext } & TTypes;

  // Pothos derives its options type through a conditional on the schema types.
  // With `TTypes` still generic that conditional cannot be resolved, so the
  // options object is checked against an unresolved type and rejected. The
  // assertion names the type the caller will actually instantiate; every
  // subgraph passes a concrete `TTypes`, where the same options do check.
  const options = {
    plugins: [DirectivesPlugin, FederationPlugin, ZodPlugin],
  } as ConstructorParameters<typeof SchemaBuilder<Types>>[0];

  return new SchemaBuilder<Types>(options);
}

export type Builder = ReturnType<typeof createBuilder>;
