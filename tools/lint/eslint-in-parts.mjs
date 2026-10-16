/**
 * `eslint .`, one part of the repository at a time.
 *
 * The type-aware pass over the whole repository in one process outgrew an
 * 8 GB heap with the October 2026 dependency upgrade: it ran out of memory
 * on CI and here. Each app is a part, `packages` is one, and each module of
 * `platform`, `services` and `tools` is its own: everything `eslint .` lints,
 * since nothing outside them is lintable. One after another, so the peak is
 * one part's.
 *
 * With `LINT_STAMPS` set (CI, which keeps the folder in its cache), a part
 * that passed with exactly these inputs before is not linted again. Its inputs
 * are its own files, all of `packages/` (the only code another part may
 * import: modules never import each other), the lint config and the root
 * configuration. Read from git's index, so it is for a clean checkout.
 *
 * `LINT_STAMP_ONLY=1` stamps every part without linting, for a tree already
 * proven to pass (`ci` on main, after its pull request linted it).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dirs = (root) =>
  readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'node_modules')
    .map((d) => `${root}/${d.name}`);
const parts = [
  ...dirs('apps'),
  'packages',
  ...dirs('platform'),
  ...dirs('services'),
  ...dirs('tools'),
];

const shared = ['packages', 'tools/lint', 'package.json', 'pnpm-lock.yaml', 'tsconfig.base.json'];
const stamp = (part) =>
  createHash('sha256')
    .update(part)
    .update(execFileSync('git', ['ls-files', '-s', '--', part, ...shared]))
    .digest('hex')
    .slice(0, 32);

const stamps = process.env['LINT_STAMPS'];
if (stamps !== undefined) mkdirSync(stamps, { recursive: true });
const kept = new Set();

const eslint = (args) =>
  spawnSync(
    'eslint',
    // A module folder with nothing lintable in it passes rather than failing.
    ['--config', 'tools/lint/eslint.config.js', '--no-error-on-unmatched-pattern', ...args],
    {
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
    },
  ).status ?? 1;

let failed = 0;
for (const part of parts) {
  const key = stamps === undefined ? null : stamp(part);
  if (key !== null && existsSync(join(stamps, key))) {
    console.log(`eslint ${part}: unchanged since it passed`);
    kept.add(key);
    continue;
  }
  console.log(`eslint ${part}`);
  const status = process.env['LINT_STAMP_ONLY'] === '1' ? 0 : eslint([part]);
  failed |= status;
  if (key !== null && status === 0) {
    writeFileSync(join(stamps, key), part);
    kept.add(key);
  }
}
// Only this tree's stamps go back into the cache.
if (stamps !== undefined)
  for (const name of readdirSync(stamps)) if (!kept.has(name)) rmSync(join(stamps, name));
process.exit(failed === 0 ? 0 : 1);
