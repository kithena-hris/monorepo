/**
 * Every story in the Reach Mobile design that has no story in Storybook.
 *
 *   pnpm reach-mobile:parity                 every category
 *   pnpm reach-mobile:parity Forms           one category
 *   pnpm reach-mobile:parity button avatar   one or more components, by id
 *
 * A design story is matched by its component's Storybook title and its own
 * name: `Components/Button` › `Under a finger` is satisfied by a story in a
 * file titled `Components/Button` named `Under a finger`. The list comes from
 * `packages/ui-native/design/index.json` (`import-design.mjs`).
 *
 * Exits non-zero while anything selected is missing, so a lane can gate on its
 * own components and RMB-059 on all of them.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { repoRoot } from './design-dir.mjs';
import { nativeStories } from './stories.mjs';

const design = JSON.parse(
  readFileSync(join(repoRoot, 'packages/ui-native/design/index.json'), 'utf8'),
);
const selectors = process.argv.slice(2).map((s) => s.toLowerCase());

const have = new Set(nativeStories().map((s) => `${s.title}\u0000${s.name}`));

let total = 0;
let missing = 0;
const byCategory = [];

for (const [category, components] of Object.entries(design)) {
  const chosen =
    selectors.length === 0 || selectors.includes(category.toLowerCase())
      ? components
      : components.filter((c) => selectors.includes(c.id));
  let categoryMissing = 0;
  let categoryTotal = 0;
  for (const component of chosen) {
    const absent = component.stories.filter((s) => !have.has(`${component.title}\u0000${s.name}`));
    categoryTotal += component.stories.length;
    categoryMissing += absent.length;
    if (absent.length > 0) {
      console.log(
        `${component.title}  (${component.id}, ${String(absent.length)} of ${String(component.stories.length)} missing)`,
      );
      for (const story of absent) console.log(`  - ${story.name}`);
    }
  }
  if (chosen.length > 0) byCategory.push([category, categoryMissing, categoryTotal]);
  total += categoryTotal;
  missing += categoryMissing;
}

if (selectors.length > 0 && total === 0) {
  console.error(`Nothing in the design matches ${selectors.join(', ')}.`);
  process.exit(1);
}

console.log('');
for (const [category, m, t] of byCategory) {
  console.log(
    `${category.padEnd(12)} ${String(t - m).padStart(4)} of ${String(t).padStart(4)} stories`,
  );
}
console.log(
  `${'Total'.padEnd(12)} ${String(total - missing).padStart(4)} of ${String(total).padStart(4)} stories, ${String(missing)} missing`,
);
process.exit(missing > 0 ? 1 : 0);
