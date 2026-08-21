import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * `just standalone people` — the module booted with no siblings present.
 *
 * People is the source of record here, but it is still sold on its own and must
 * not have grown a dependency on a module that happens to sit beside it in this
 * repository. Every other module resolves to a file that throws on evaluation,
 * so a sideways import fails here the way it would fail in a deployment that
 * has one module on disk.
 */
const absentSibling = fileURLToPath(
  new URL('../../packages/testing/src/absent-sibling.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    /*
     * `graphql` resolves to exactly one copy. Pothos checks types with
     * `instanceof`, so a second copy anywhere in the graph makes every
     * `isObjectType` call return false and the subgraph fails to build with a
     * message about realms that has nothing to do with this module.
     */
    dedupe: ['graphql'],
    alias: [{ find: /^@kithena\/timeoff(\/.*)?$/, replacement: absentSibling }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.standalone.test.ts'],
  },
});
