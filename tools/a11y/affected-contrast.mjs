#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = new URL('../../', import.meta.url).pathname;
const filters = (process.env.STORY_FILTER ?? '').split('|').filter(Boolean);

if (!filters.length) {
  console.log('No affected stories; skipping contrast gate.');
  process.exit(0);
}

const run = async (filter) => {
  const env = { ...process.env, STORY_FILTER: filter };
  await exec('node', ['tools/a11y/contrast-sweep.mjs'], { cwd: root, env });
};

const maxParallel = Number(process.env.CONTRAST_WORKERS ?? 4);
let cursor = 0;
let failed = false;

const worker = async () => {
  while (true) {
    const index = cursor++;
    if (index >= filters.length) return;
    const filter = filters[index];
    console.log(`Running contrast for ${filter}`);
    try {
      await run(filter);
    } catch (error) {
      failed = true;
      console.error(error?.stdout ?? error?.stderr ?? error);
    }
  }
};

await Promise.all(Array.from({ length: Math.min(maxParallel, filters.length) }, worker));
process.exit(failed ? 1 : 0);
