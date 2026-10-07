/**
 * Copies the Reach Mobile design's story list into the repository.
 *
 *   node tools/reach-mobile/import-design.mjs [path/to/ref/index.json]
 *
 * The design renders every story to `ref/<category>-<theme>.html` and lists
 * them in `ref/index.json` (`_build/render.cjs ref`). This writes the list, and
 * nothing else, to `packages/ui-native/design/index.json`: titles, anchors,
 * notes and descriptions, no markup. Each component gains `title`, the
 * Storybook title its stories live under, which is the web Storybook's title
 * for the same component wherever the web has one.
 *
 * `pnpm reach-mobile:parity` and `pnpm reach-mobile:compare` read the copy.
 * Re-run this when the design changes and commit the diff.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { designDir, repoRoot } from './design-dir.mjs';

const source = process.argv[2] ?? join(designDir(), 'ref/index.json');
const design = JSON.parse(readFileSync(source, 'utf8'));

/** Where the design's name and the web Storybook's title part company. */
const TITLES = {
  icons: 'Foundations/Icons',
  'layout-presets': 'Layouts/Presets',
  hierarchical: 'Layouts/Hierarchical',
  'modal-page': 'Layouts/Modal page',
  layout: 'Components/Layout',
  'scroll-area': 'Components/ScrollArea',
  separator: 'Components/Separator',
  'tree-view': 'Components/TreeView',
  'chart-timeline': 'Charts/Timeline',
};

function titleOf(category, component) {
  if (TITLES[component.id]) return TITLES[component.id];
  if (component.group === 'Layouts') return `Layouts/${component.name}`;
  if (category === 'Data') return `Components/${component.name}`;
  return `${category}/${component.name}`;
}

const out = {};
for (const [category, components] of Object.entries(design)) {
  out[category] = components.map((component) => ({
    id: component.id,
    name: component.name,
    title: titleOf(category, component),
    group: component.group,
    desc: component.desc,
    stories: component.stories.map(({ title, anchor, note }) => ({
      name: title,
      anchor,
      ...(note ? { note } : {}),
    })),
  }));
}

const target = join(repoRoot, 'packages/ui-native/design/index.json');
writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
const count = Object.values(out).flat();
console.log(
  `Wrote ${String(count.length)} components, ${String(count.reduce((n, c) => n + c.stories.length, 0))} stories to packages/ui-native/design/index.json`,
);
