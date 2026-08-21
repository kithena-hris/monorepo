// Type-aware rules only. Everything cheap runs in oxlint.
//
// This config lives in its own workspace package for one reason:
// typescript-eslint refuses to load against TypeScript 7 (it needs the
// programmatic API, which 7.0 does not ship, and the check is a hard error).
// Here, `typescript` resolves to the aliased TypeScript 6 package, so the
// type-aware pass runs on 6 while `tsc` at the root stays on 7 — the
// side-by-side arrangement TypeScript documents, and the same split the merge
// gate already makes with `tsc6`.
//
// Collapse this back into a root config once 7.1 ships a stable API.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import tseslint from 'typescript-eslint';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/storybook-static/**',
      '**/*.config.js',
      // Build tooling that is CommonJS on purpose and belongs to no tsconfig.
      '**/*.cjs',
      // Standalone CI scripts. They run under plain node against a live
      // browser, so every value crossing `page.evaluate` is untyped by
      // construction and the type-aware rules have nothing true to say.
      'tools/a11y/*.mjs',
      'tools/storybook/*.mjs',
    ],
  },
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Next reads its config before any TypeScript project exists, so the
          // file belongs to none of them. It is still worth linting.
          //
          // The vitest configs are the same case: a package's tsconfig covers
          // `src`, and these sit beside it describing how to run what is in
          // `src`. They are small, but they decide which suite runs against
          // which harness, so leaving them unlinted is how one quietly stops
          // matching any test file at all.
          allowDefaultProject: [
            'apps/*/next.config.mjs',
            // Only db-kit. Every other package either has no vitest config or
            // lists it in its own tsconfig, which is the better home; db-kit
            // cannot, because its `rootDir` is `src` and these sit beside it.
            'packages/db-kit/vitest.*.ts',
          ],
        },
        tsconfigRootDir: repoRoot,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // Logging a whole entity is how PII reaches your log store.
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='logger'][arguments.0.type='Identifier']",
          message: 'Log named fields, not whole objects. The redactor is a safety net, not a plan.',
        },
      ],
    },
  },
  {
    // Stories are documentation. Their render functions are not a module
    // boundary anyone imports across, and the fixture data they carry is
    // deliberately literal.
    files: ['**/*.stories.tsx', '**/*.stories.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
);
