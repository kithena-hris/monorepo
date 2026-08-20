#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const base = process.env.BASE_SHA ?? 'origin/main';
const head = process.env.HEAD_SHA ?? 'HEAD';
const output = process.env.GITHUB_OUTPUT;

const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
const setOutput = (values) => output && writeFileSync(output, Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n') + '\n');
const safeStat = (path) => { try { return statSync(path); } catch { return null; } };

let changed;
try { changed = run('git', ['diff', '--name-only', `${base}...${head}`]).split('\n').filter(Boolean); }
catch { changed = run('git', ['diff', '--name-only', base, head]).split('\n').filter(Boolean); }

const storybookRoot = resolve(root, 'apps/storybook');
const stories = [];
const walk = (dir) => {
  if (!safeStat(dir)?.isDirectory()) return;
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    if (safeStat(path)?.isDirectory()) walk(path);
    else if (/\.(stories|story)\.(js|jsx|ts|tsx|mdx)$/.test(name)) stories.push(path);
  }
};
walk(storybookRoot);

const full = changed.some((file) => /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|tools\/a11y\/)/.test(file));
if (full) { setOutput({ full: 'true', skip: 'false' }); process.exit(0); }

const designSystem = changed.some((file) => /^(packages\/ui|apps\/storybook|packages\/design-system|packages\/tokens)\//.test(file));
if (!designSystem) { setOutput({ full: 'false', skip: 'true' }); process.exit(0); }

const components = changed.filter((file) => file.startsWith('packages/ui/')).map((file) => file.split('/').at(-1).replace(/\.(tsx?|jsx?)$/, '')).filter(Boolean);
const selected = stories.filter((story) => components.some((name) => readFileSync(story, 'utf8').includes(name)));

if (!selected.length) { setOutput({ full: 'true', skip: 'false' }); process.exit(0); }

const filters = [...new Set(selected.map((file) => file.slice(storybookRoot.length + 1).replace(/\.(stories|story)\.(js|jsx|ts|tsx|mdx)$/, '').replace(/\\/g, '/')))];
console.log(`Affected story filters: ${filters.join(', ')}`);
setOutput({ full: 'false', skip: 'false', filters: filters.join('|') });
