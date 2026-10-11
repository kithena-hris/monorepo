/**
 * `eslint .`, one part of the repository at a time.
 *
 * The type-aware pass over the whole repository in one process outgrew an
 * 8 GB heap with the October 2026 dependency upgrade: it ran out of memory
 * on CI and here. Each app is a part, then each other top-level folder with
 * code: everything `eslint .` lints, since nothing outside them is lintable
 * (ESLint refuses a run that matches only ignored files). One after another,
 * so the peak is one part's.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const big = ['packages', 'platform', 'services', 'tools'];
const apps = readdirSync('apps', { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => `apps/${d.name}`);

const eslint = (args) =>
  spawnSync('eslint', ['--config', 'tools/lint/eslint.config.js', ...args], {
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  }).status ?? 1;

let failed = 0;
for (const part of [...apps, ...big]) {
  console.log(`eslint ${part}`);
  failed |= eslint([part]);
}
process.exit(failed === 0 ? 0 : 1);
