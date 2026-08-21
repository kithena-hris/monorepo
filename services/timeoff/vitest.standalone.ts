import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * `just standalone timeoff` — the module booted with no siblings present.
 *
 * Time Off declares `requiresPeopleSource: 'either'`, which is the whole
 * anti-sticky proposition: a customer running Workday can buy Time Off alone.
 * That claim is only worth making if something checks it, and checking it means
 * making the sibling genuinely unreachable rather than trusting that nothing
 * imported it. Every other module resolves to a file that throws on evaluation,
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
    alias: [{ find: /^@kithena\/people(\/.*)?$/, replacement: absentSibling }],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.standalone.test.ts'],
  },
});
