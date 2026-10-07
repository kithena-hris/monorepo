import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './design-dir.mjs';

export const SOURCE = join(repoRoot, 'packages/ui-native/src');

// Storybook's own export-name-to-story-name rule, from the mobile Storybook's
// copy, so a story without an explicit `name` is named exactly as the sidebar
// names it.
const fromStorybook = createRequire(join(repoRoot, 'apps/storybook-mobile/package.json'));
const { storyNameFromExport } = await import(
  pathToFileURL(fromStorybook.resolve('storybook/internal/csf')).href
);

function storyFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return storyFiles(path);
    return /\.stories\.tsx?$/.test(entry) ? [path] : [];
  });
}

/**
 * Every story in `packages/ui-native`, as `{ title, name, file }`, read from
 * source the way `apps/storybook/.storybook/story-views.ts` reads the web's:
 * the meta's `title`, then each exported story's `name` or its export name.
 */
export function nativeStories() {
  return storyFiles(SOURCE).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const title = /^\s*title:\s*'([^']+)'/m.exec(source)?.[1];
    if (title === undefined) return [];
    const exports = [...source.matchAll(/^export const (\w+)\b[^=]*=/gm)];
    return exports.map((match, index) => {
      const block = source.slice(match.index, exports[index + 1]?.index ?? source.length);
      const name = /^ {2}name:\s*'((?:[^'\\]|\\.)+)'/m.exec(block)?.[1]?.replaceAll("\\'", "'");
      return {
        title,
        name: name ?? storyNameFromExport(match[1]),
        exportName: match[1],
        file: relative(repoRoot, file),
      };
    });
  });
}
