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
      'tools/reach-mobile/*.mjs',
      // Same case: a standalone Node script that belongs to no tsconfig. It
      // reads a stylesheet and does colour maths, so there is nothing typed for
      // the type-aware rules to check even if they could load it.
      'tools/email/*.mjs',
      // Same case: build and deploy steps of an app, plain Node scripts that
      // belong to no tsconfig (the shell's renderer bundle, the remote's
      // signed manifest).
      'apps/*/scripts/*.mjs',
      'apps/*/*/scripts/*.mjs',
      // Same case: the kiosk's service worker, served as written from
      // `public/` because a worker is fetched by URL and Next compiles nothing
      // there. `apps/web/src/lib/kiosk-sw.test.ts` runs it.
      'apps/web/public/kiosk-sw.js',
      // Conflict copies from whatever syncs this directory — `foo 2.ts` beside
      // `foo.ts`. Git ignores them; ESLint does not read `.gitignore`, so it
      // was reporting a parse error for a file nothing is meant to see.
      '**/* [0-9].*',
      '**/* [0-9][0-9].*',
      // `modern deploy` output. `.vercel/output` holds the Build Output API
      // bundles and `.output` the plain Node server; both are generated
      // JavaScript belonging to no tsconfig, so the type-aware rules report a
      // parse error on every file. Same reason as the conflict copies above:
      // ESLint does not read `.gitignore`.
      '**/.vercel/**',
      '**/.output/**',
      // Agent worktrees are full checkouts nested inside this one. Linting from
      // the root walked every copy of the repository and ran out of heap.
      '.claude/**',
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
            // The same case one level down, where Kithena's frontends are
            // grouped by origin. `postcss.config.mjs` tells Rspack to run
            // Tailwind, and without it the auth app renders as unstyled text
            // with nothing erroring — small, and worth linting for that reason
            // rather than in spite of it.
            'apps/*/postcss.config.mjs',
            'apps/*/*/postcss.config.mjs',
            // Only db-kit. Every other package either has no vitest config or
            // lists it in its own tsconfig, which is the better home; db-kit
            // cannot, because its `rootDir` is `src` and these sit beside it.
            'packages/db-kit/vitest.*.ts',
          ],
          // Every match is a one-screen config file, so the default project
          // stays cheap; the default cap of 8 was reached by the second Expo
          // app's `postcss.config.mjs`, not by anything slow.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 16,
        },
        tsconfigRootDir: repoRoot,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      // A leading underscore marks a name as deliberately unused — oxlint's
      // convention, which it enforces with no option set. The two linters must
      // agree on one spelling, and `void name;` stopped being one when
      // typescript-eslint 8.70 made no-meaningless-void-operator reject it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
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
    // Code that runs on Hermes, React Native's engine, on a phone. Hermes has
    // no ES2023 copying array methods: `toSorted` threw "undefined is not a
    // function" in Review on an iPhone, and Reach's charts, table and
    // scheduler used them too. Storybook runs in a browser, which has them,
    // so nothing short of a device showed it. Copy, then sort or reverse.
    files: ['packages/ui-native/src/**', 'apps/tenant-mobile/**', 'apps/mobile/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        ...['toSorted', 'toReversed', 'toSpliced'].map((property) => ({
          property,
          message: `Hermes has no Array.prototype.${property}: copy, then sort, reverse or splice.`,
        })),
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
