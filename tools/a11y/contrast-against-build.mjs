/**
 * Runs the contrast sweep against the built Storybook, on a server it owns.
 *
 * The sweep needs a Storybook to point at, and every run of it so far has been
 * lost the same way: something restarted the server on the other side of the
 * port and every render after that failed. The skip guard caught it each time,
 * which is the only reason those runs were not read as clean, but a gate that
 * depends on a server somebody else is holding is a gate that keeps not
 * running.
 *
 * So this starts one, waits for the index, sweeps, and stops it again. The port
 * is deliberately unusual: nothing else in this repo uses it.
 *
 * Usage: `pnpm a11y:contrast:build` after `pnpm --filter @reach/storybook build`.
 * Everything the sweep understands still applies, so
 * `STORY_FILTER=components-table pnpm a11y:contrast:build` narrows it.
 */
/*
 * eslint-disable no-await-in-loop
 *
 * Every `await` in a loop here drives one shared Playwright page or context:
 * navigate, wait for the theme to settle, read the computed values, move on.
 * The rule's suggested fix, collecting the promises and running `Promise.all`,
 * would have several navigations racing the same page and reading each other's
 * DOM, or spawn a browser per story. Sequential is the correct shape.
 */
/* eslint-disable no-await-in-loop */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const staticDir = resolve(repoRoot, 'apps/storybook/storybook-static');
const PORT = 6123;
const base = `http://localhost:${String(PORT)}`;

/** Node's own static server, so this depends on nothing that has to resolve. */
const server = spawn(
  process.execPath,
  [resolve(here, 'static-server.mjs'), staticDir, String(PORT)],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);

let stopped = false;
const stop = () => {
  if (stopped) return;
  stopped = true;
  server.kill();
};
process.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

/** Waits for the index rather than for a fixed delay. */
async function waitForStorybook() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/index.json`);
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (!(await waitForStorybook())) {
  console.error(
    `No Storybook at ${base}. Is ${staticDir} built?\n` +
      'Run: pnpm --filter @reach/storybook build',
  );
  stop();
  process.exit(1);
}

const sweep = spawn(process.execPath, [resolve(here, 'contrast-sweep.mjs')], {
  stdio: 'inherit',
  env: { ...process.env, STORYBOOK_URL: base },
});

sweep.on('exit', (code) => {
  stop();
  process.exit(code ?? 1);
});
