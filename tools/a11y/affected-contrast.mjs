#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = new URL('../../', import.meta.url).pathname;
const requested = (process.env.STORY_FILTER ?? '').split('|').filter(Boolean);
const storybookUrl = process.env.STORYBOOK_URL ?? 'http://localhost:6006';

if (!requested.length) {
  console.log('No affected stories; skipping contrast gate.');
  process.exit(0);
}

const index = await (await fetch(`${storybookUrl}/index.json`)).json();
const entries = Object.values(index.entries ?? index.stories ?? {}).filter((entry) => entry.type === 'story');

let ids;
if (requested.includes('__ALL__')) {
  ids = entries.map((entry) => entry.id);
} else {
  ids = entries
    .filter((entry) => requested.some((filter) =>
      entry.id?.includes(filter) ||
      entry.importPath?.includes(filter) ||
      entry.title?.toLowerCase().includes(filter.toLowerCase()),
    ))
    .map((entry) => entry.id);
}

ids = [...new Set(ids)].filter(Boolean);
if (!ids.length) {
  console.log('Affected files did not map to any Storybook stories; skipping contrast gate.');
  process.exit(0);
}

console.log(`Contrast gate: ${ids.length}/${entries.length} stories affected.`);

// If the dependency graph reaches the entire Storybook, use one sweep instead
// of spawning hundreds of browser processes.
const filters = ids.length === entries.length ? [''] : ids;
const maxParallel = Number(process.env.CONTRAST_WORKERS ?? 4);
let cursor = 0;
let failed = false;

const run = async (filter) => {
  const env = { ...process.env, STORY_FILTER: filter };
  await exec('node', ['tools/a11y/contrast-sweep.mjs'], { cwd: root, env });
};

const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= filters.length) return;
    try {
      await run(filters[index]);
    } catch (error) {
      failed = true;
      console.error(error?.stdout ?? error?.stderr ?? error);
    }
  }
};

await Promise.all(Array.from({ length: Math.min(maxParallel, filters.length) }, worker));
process.exit(failed ? 1 : 0);
