/**
 * Docs catalogue drift check.
 *
 * The public documentation site lists what is in the design system. It cannot
 * fetch that list at load time: it is a static build, and Storybook sits behind
 * authentication, so the request would fail for exactly the readers the page
 * exists for. The list is therefore a copy, and this is what stops the copy
 * going stale.
 *
 * It compares `apps/docs/src/catalogue.json` against Storybook's own index and
 * fails on anything present in one and not the other, in either direction: a
 * component added without being documented, and a documented component that no
 * longer exists, are both wrong.
 *
 * Usage: start Storybook, then `pnpm docs:catalogue-drift`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.STORYBOOK_URL ?? 'http://localhost:6006';

const catalogue = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../apps/docs/src/catalogue.json', import.meta.url)),
    'utf8',
  ),
);

/** Storybook titles are `Category/Name`. Entries with no slash are standalone
 *  pages such as Welcome, which the catalogue does not claim to list. */
const index = await (await fetch(BASE + '/index.json')).json();

const live = new Map();
let storyCount = 0;
for (const entry of Object.values(index.entries)) {
  if (entry.type === 'story') storyCount += 1;
  if (!entry.title) continue;
  const [category, ...rest] = entry.title.split('/');
  if (rest.length === 0) continue;
  if (!live.has(category)) live.set(category, new Set());
  live.get(category).add(rest.join('/'));
}

const problems = [];

for (const category of catalogue) {
  const shipped = live.get(category.title);
  if (!shipped) {
    problems.push('documented category "' + category.title + '" is not in Storybook');
    continue;
  }
  for (const item of category.items) {
    if (!shipped.has(item)) {
      problems.push(category.title + ' / ' + item + '  is documented but not in Storybook');
    }
  }
  for (const item of shipped) {
    if (!category.items.includes(item)) {
      problems.push(category.title + ' / ' + item + '  ships but is not documented');
    }
  }
}

const documented = new Set(catalogue.map((category) => category.title));
for (const category of live.keys()) {
  if (!documented.has(category)) {
    problems.push('category "' + category + '" ships but is not documented');
  }
}

const listed = catalogue.reduce((total, category) => total + category.items.length, 0);
console.log('catalogue entries: ' + listed + ', stories in Storybook: ' + storyCount);

// A comparison against an empty index is not a passing check.
if (live.size === 0) {
  console.error('Storybook returned no categories. Nothing was compared.');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('\ndocs catalogue is out of date:\n');
  for (const problem of problems) console.error('   ' + problem);
  console.error('\nUpdate apps/docs/src/catalogue.json.');
  process.exit(1);
}

console.log('docs catalogue matches Storybook');
