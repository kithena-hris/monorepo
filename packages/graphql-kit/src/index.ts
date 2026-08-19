// Loading the plugins for their types, not their values: each one declaration-
// merges methods onto Pothos's SchemaBuilder (`asEntity`, `selection`,
// `toSubGraphSchema`, `validate`). Without these imports a subgraph sees the
// bare builder and every federation call is a type error.
import '@pothos/plugin-directives';
import '@pothos/plugin-federation';
import '@pothos/plugin-zod';

export * from './builder.js';
export * from './errors.js';
export * from './context.js';
