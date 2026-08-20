#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const base = process.env.BASE_SHA ?? 'origin/main';
const head = process.env.HEAD_SHA ?? 'HEAD';
const output = process.env.GITHUB_OUTPUT;

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
const setOutput = (values) => output && writeFileSync(output, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
const stat = (path) => { try { return statSync(path); } catch { return null; } };
const normalize = (path) => path.replaceAll('\\', '/');

let changed;
try { changed = run('git', ['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean); }
catch { changed = run('git', ['diff', '--name-only', base, head]).split('\n').filter(Boolean); }

const relevant = changed.filter((file) =>
  file.startsWith('packages/ui/') ||
  file.startsWith('apps/storybook/') ||
  file.startsWith('packages/design-system/') ||
  file.startsWith('packages/tokens/'),
);

if (relevant.length === 0) {
  console.log('No design-system changes detected; skipping contrast gate.');
  setOutput({ skip: 'true', filters: '' });
  process.exit(0);
}

const uiRoot = resolve(root, 'packages/ui');
const storyFiles = [];
const sourceFiles = [];

const walk = (dir) => {
  if (!stat(dir)?.isDirectory()) return;
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (stat(path)?.isDirectory()) walk(path);
    else {
      if (/\.(stories|story)\.(js|jsx|ts|tsx|mdx)$/.test(name)) storyFiles.push(path);
      if (/\.(js|jsx|ts|tsx|mdx|css|scss)$/.test(name)) sourceFiles.push(path);
    }
  }
};
walk(uiRoot);

const globalChange = relevant.some((file) =>
  file.startsWith('apps/storybook/') ||
  /packages\/(design-system|tokens)\//.test(file) ||
  /packages\/ui\/src\/(foundations|styles|theme|tokens)\//.test(file) ||
  /packages\/ui\/src\/(index|globals|theme)\.(css|scss|ts|tsx|js|jsx)$/.test(file),
);

if (globalChange) {
  console.log('Design-system-wide change detected; all Storybook stories are affected.');
  setOutput({ skip: 'false', filters: '__ALL__' });
  process.exit(0);
}

const resolveLocal = (from, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const basePath = resolve(dirname(from), specifier);
  const candidates = [
    basePath,
    ...['.ts', '.tsx', '.js', '.jsx', '.mdx', '.css', '.scss'].map((ext) => `${basePath}${ext}`),
    ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map((name) => resolve(basePath, name)),
  ];
  return candidates.find((candidate) => stat(candidate)?.isFile()) ?? null;
};

const importsOf = new Map();
const importPattern = /(?:import|export)\s+(?:[^'";]*?from\s+)?['"]([^'"]+)['"]/g;

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  const deps = [];
  let match;
  while ((match = importPattern.exec(text))) {
    const resolved = resolveLocal(file, match[1]);
    if (resolved) deps.push(resolved);
  }
  importsOf.set(file, deps);
}

const changedAbsolute = new Set(relevant
  .filter((file) => file.startsWith('packages/ui/'))
  .map((file) => resolve(root, file)));

const dependsOnChanged = (story) => {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return false;
    seen.add(file);
    if (changedAbsolute.has(file)) return true;
    return (importsOf.get(file) ?? []).some(visit);
  };
  return visit(story);
};

const selected = storyFiles.filter((story) => {
  if (changedAbsolute.has(story)) return true;
  if (dependsOnChanged(story)) return true;
  const text = readFileSync(story, 'utf8');
  return [...changedAbsolute].some((file) => {
    const basename = normalize(file).split('/').at(-1)?.replace(/\.(js|jsx|ts|tsx|mdx|css|scss)$/, '');
    return basename && text.includes(basename);
  });
});

if (!selected.length) {
  console.log('No Storybook story depends on the changed UI files; skipping contrast gate.');
  setOutput({ skip: 'true', filters: '' });
  process.exit(0);
}

const filters = [...new Set(selected.map((file) => normalize(file.slice(uiRoot.length + 1))) )];
console.log(`Affected stories: ${filters.length}`);
console.log(filters.join('\n'));
setOutput({ skip: 'false', filters: filters.join('|') });
