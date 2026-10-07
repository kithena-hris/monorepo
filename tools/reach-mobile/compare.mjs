/**
 * Each story of a component beside the design's drawing of it, light and dark.
 *
 *   pnpm reach-mobile:compare button
 *   pnpm reach-mobile:compare button avatar badge
 *
 * Screenshots every Storybook story of the component (the iframe, at the one
 * phone the mobile Storybook knows, 390 wide) and the matching figure in the
 * design's `ref/<category>-<theme>.html`, and writes them side by side to
 * `.compare/<component>/<story>.png`: the story as iOS draws it, then as
 * Android draws it, then the design, light above dark. `.compare/` is
 * gitignored.
 *
 * Uses a Storybook already running on $STORYBOOK_URL (default
 * http://localhost:6008, `pnpm --filter @reach/storybook-mobile dev`), or
 * starts one for the run.
 */
/*
 * Sequential on purpose: every await in a loop drives one shared page, and
 * parallel navigations would read each other's DOM.
 */
/* eslint-disable no-await-in-loop */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { chromium } from 'playwright';

import { designDir, repoRoot } from './design-dir.mjs';

const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error('Usage: pnpm reach-mobile:compare <component-id> [<component-id>...]');
  process.exit(1);
}

const design = JSON.parse(
  readFileSync(join(repoRoot, 'packages/ui-native/design/index.json'), 'utf8'),
);
const located = ids.map((id) => {
  for (const [category, components] of Object.entries(design)) {
    const component = components.find((c) => c.id === id);
    if (component) return { category, component };
  }
  console.error(`No component "${id}" in packages/ui-native/design/index.json.`);
  process.exit(1);
});

const url = (process.env['STORYBOOK_URL'] ?? 'http://localhost:6008').replace(/\/$/, '');

async function reachable() {
  try {
    return (await fetch(`${url}/index.json`)).ok;
  } catch {
    return false;
  }
}

let server;
if (!(await reachable())) {
  console.log(`No Storybook on ${url}; starting one.`);
  server = spawn('pnpm', ['--filter', '@reach/storybook-mobile', 'dev'], {
    cwd: repoRoot,
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 120 && !(await reachable()); i += 1)
    await new Promise((r) => setTimeout(r, 1000));
  if (!(await reachable())) {
    console.error('Storybook did not start.');
    process.exit(1);
  }
}

const { entries } = await (await fetch(`${url}/index.json`)).json();
const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
const ref = await context.newPage();
ref.setViewportSize({ width: 1400, height: 900 });

async function shootStory(id, theme) {
  await page.goto(`${url}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
  const story = page.locator('[data-testid="reach-story"]');
  await story.waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  return story.screenshot({ animations: 'disabled' });
}

async function shootDesign(category, anchor, theme) {
  const file = join(designDir(), 'ref', `${category.toLowerCase()}-${theme}.html`);
  if (ref.url() !== pathToFileURL(file).href) {
    await ref.goto(pathToFileURL(file).href);
    await ref.waitForTimeout(1200);
  }
  const figure = ref.locator(`figure[id="${anchor}"] .phone`);
  return (await figure.count()) > 0 ? figure.screenshot({ animations: 'disabled' }) : null;
}

const sheet = await context.newPage();
let written = 0;
let unmatched = 0;

for (const { category, component } of located) {
  const outDir = join(repoRoot, '.compare', component.id);
  mkdirSync(outDir, { recursive: true });
  for (const story of component.stories) {
    // The story under each platform's section (`apps/storybook-mobile/.storybook/device.tsx`).
    const platforms = ['iOS', 'Android'].map((section) => ({
      section,
      entry: Object.values(entries).find(
        (e) =>
          e.type === 'story' &&
          e.title === `${section}/${component.title}` &&
          e.name === story.name,
      ),
    }));
    if (platforms.some((p) => !p.entry)) {
      console.log(`  missing in Storybook: ${component.title} › ${story.name}`);
      unmatched += 1;
      continue;
    }
    const rows = [];
    for (const theme of ['light', 'dark']) {
      const shots = [];
      for (const { section, entry } of platforms) {
        shots.push({ label: section, png: (await shootStory(entry.id, theme)).toString('base64') });
      }
      const theirs = await shootDesign(category, story.anchor, theme);
      shots.push({ label: 'Design', png: theirs?.toString('base64') });
      rows.push({ theme, shots });
    }
    await sheet.setContent(
      `<body style="margin:0;padding:16px;background:#888;font:600 13px system-ui;color:#fff">` +
        `<div style="margin-bottom:8px">${component.title} › ${story.name}</div>` +
        rows
          .map(
            (row) =>
              `<div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:16px">` +
              row.shots
                .map(
                  (shot) =>
                    `<figure style="margin:0"><figcaption>${shot.label} · ${row.theme}</figcaption>` +
                    (shot.png
                      ? `<img style="width:390px" src="data:image/png;base64,${shot.png}">`
                      : '<p>No figure</p>') +
                    `</figure>`,
                )
                .join('') +
              `</div>`,
          )
          .join('') +
        `</body>`,
    );
    await sheet.setViewportSize({ width: 1266, height: 400 });
    const path = join(outDir, `${slug(story.name)}.png`);
    await sheet.screenshot({ path, fullPage: true });
    written += 1;
    console.log(`  ${path.slice(repoRoot.length)}`);
  }
}

await browser.close();
if (server) process.kill(-server.pid);
console.log(`\n${String(written)} written to .compare/, ${String(unmatched)} without a story.`);
