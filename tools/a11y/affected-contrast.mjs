#!/usr/bin/env node

/**
 * Resolves changed design-system files to Storybook story ids and sweeps only
 * those.
 *
 * `affected-stories.mjs` works on file paths, because that is all a diff gives
 * it. Story ids only exist once Storybook has built its index, so the mapping
 * has to happen here, against a running instance.
 *
 * This used to spawn `contrast-sweep.mjs` once per story, each launching its
 * own Chromium. Fifty affected stories meant fifty browser launches, and the
 * narrowing cost more than the full sweep it was avoiding. The sweep now takes
 * an explicit id list, so one process measures all of them.
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requested = (process.env.STORY_FILTER ?? '').split('|').filter(Boolean);
const storybookUrl = process.env.STORYBOOK_URL ?? 'http://localhost:6006';

if (!requested.length) {
  console.log('No affected stories; nothing to sweep.');
  process.exit(0);
}

const index = await (await fetch(`${storybookUrl}/index.json`)).json();
const entries = Object.values(index.entries ?? index.stories ?? {}).filter(
  (entry) => entry.type === 'story' || entry.type === 'docs',
);

if (entries.length === 0) {
  console.error('The Storybook index is empty. Nothing could be resolved, so this is a failure.');
  process.exit(1);
}

const everything = requested.includes('__ALL__');

/*
 * Matched on `importPath` alone. `affected-stories.mjs` emits paths relative to
 * `packages/ui`, and Storybook records the import path of the story file, so
 * this is a comparison between two things of the same kind. The previous
 * version also tried the story id and title, which are neither paths nor
 * anything a path would appear in — they matched nothing and only made the
 * intent harder to read.
 */
const ids = everything
  ? entries.map((entry) => entry.id)
  : [
      ...new Set(
        entries
          .filter((entry) =>
            requested.some((path) => entry.importPath && entry.importPath.includes(path)),
          )
          .map((entry) => entry.id),
      ),
    ];

if (!ids.length) {
  /*
   * A resolver that maps real changes to no stories is reporting that it does
   * not understand the graph, and skipping on that is how the gate erodes.
   * `affected-stories.mjs` only follows relative imports, so a story reaching
   * its component through a package alias lands here. Sweeping everything is
   * the honest response: slower than intended, never quieter than intended.
   */
  console.warn(
    `::warning::${requested.length} changed design-system file(s) mapped to no story. ` +
      'Falling back to the full sweep rather than skipping.',
  );
}

const selection = ids.length ? ids : [];
console.log(
  selection.length
    ? `Contrast gate: ${selection.length}/${entries.length} entries affected.`
    : `Contrast gate: full sweep of ${entries.length} entries.`,
);

execFileSync('node', ['tools/a11y/contrast-sweep.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Empty means "everything", which is exactly the fallback above.
    STORY_IDS: selection.join(','),
    STORY_FILTER: '',
  },
});
