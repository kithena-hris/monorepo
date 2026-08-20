#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const base = process.env.BASE_SHA ?? 'origin/main';
const head = process.env.HEAD_SHA ?? 'HEAD';

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();

let changed;
try {
  changed = run('git', ['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean);
} catch {
  changed = run('git', ['diff', '--name-only', base, head]).split('\n').filter(Boolean);
}

const storybookRoot = resolve(root, 'apps/storybook');
const storyFiles = [];

function walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of requireFs(dir)) {
    const path = resolve(dir, name);
    if (isDir(path)) walk(path);
    else if (/\.(stories|story)\.(js|jsx|ts|tsx|mdx)$/.test(name)) storyFiles.push(path);
  }
}

const { readdirSync, statSync } = await import('node:fs');
const requireFs = readdirSync;
const isDir = (path) => statSync(path).isDirectory();
walk(storybookRoot);

const designSystemChanged = changed.some((file) =>
  /^(packages\/ui|apps\/storybook|packages\/design-system|packages\/tokens)\//.test(file),
);

const infrastructureChanged = changed.some((file) =>
  /^(package.json|pnpm-lock.yaml|pnpm-workspace.yaml|turbo.json|tools\/a11y\/)/.test(file),
);

if (infrastructureChanged) {
  console.log('::notice::Design-system/a11y infrastructure changed; running the full contrast sweep.');
  writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/stdout', 'full=true\n');
  process.exit(0);
}

if (!designSystemChanged) {
  console.log('No design-system changes detected; skipping contrast sweep.');
  writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/stdout', 'full=false\nskip=true\n');
  process.exit(0);
}

const changedComponents = changed
  .filter((file) => file.startsWith('packages/ui/'))
  .map((file) => file.split('/').slice(-1)[0].replace(/\.(tsx?|jsx?)$/, ''))
  .filter(Boolean);

const selected = storyFiles.filter((story) => {
  const source = readFileSync(story, 'utf8');
  return changedComponents.some((name) => source.includes(name));
});

const filters = [...new Set(selected.map((file) => {
  const relative = file.slice(storybookRoot.length + 1);
  return relative.replace(/\.(stories|story)\.(js|jsx|ts|tsx|mdx)$/, '').replace(/\\/g, '/');
}))];

if (filters.length === 0) {
  console.log('::notice::Design-system files changed, but no specific stories could be mapped; running the full contrast sweep.');
  writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/stdout', 'full=true\n');
  process.exit(0);
}

console.log(`Affected story filters: ${filters.join(', ')}`);
const output = process.env.GITHUB_OUTPUT;
if (output) {
  writeFileSync(output, `full=false\nskip=false\nfilters=${filters.join(',')}\n`);
}
