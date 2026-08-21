/**
 * Stands in for a sibling module during a standalone run.
 *
 * `vitest.standalone.ts` aliases every other module to this file, so an import
 * that reaches sideways fails loudly at the moment it is evaluated rather than
 * resolving quietly because the monorepo happens to have every module checked
 * out next to it. In a customer deployment of one module, the sibling is not on
 * disk at all; this reproduces that.
 *
 * `.dependency-cruiser.cjs` already rejects the static import. This catches the
 * dynamic one it cannot see, and it is the reason the check runs as a test
 * rather than only as a lint rule.
 */
throw new Error(
  'A sibling module was imported during a standalone run. Every module must ' +
    'boot with no siblings present: reach the other module through an event ' +
    'or through @kithena/contracts, never by importing it.',
);
