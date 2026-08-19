/**
 * Manager theme drift check.
 *
 * Storybook's manager is a separate document from the preview iframe and does
 * not load the design system's stylesheet, so its theme cannot reference a
 * Reach custom property: it takes concrete values. `.storybook/manager-theme.ts`
 * therefore keeps a snapshot of resolved token colours, and a snapshot of a
 * colour is a thing that goes stale silently.
 *
 * This reads the tokens as a browser actually resolves them, in both themes,
 * and fails if any snapshot entry no longer matches the token it is keyed by.
 * Rasterising through a canvas is what makes the comparison possible at all:
 * the stylesheet is written in oklch through chains of `var()`, and only the
 * browser can turn that into the bytes the manager has to hard-code.
 *
 * Usage: start Storybook, then `pnpm storybook:theme-drift`.
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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

// Read as JSON, not imported from `manager-theme.ts`. That module pulls in
// `storybook/theming` and the brand asset, which is a browser bundle, not
// something a Node script should be dragging in to compare ten strings.
const snapshot = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../apps/storybook/.storybook/reach-tokens.json', import.meta.url)),
    'utf8',
  ),
);

const BASE = process.env.STORYBOOK_URL ?? 'http://localhost:6006';

/** Runs in the page. Resolves each token and rasterises it to a hex string. */
function readTokens(names) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const styles = getComputedStyle(document.documentElement);

  const out = {};
  for (const name of names) {
    const value = styles.getPropertyValue('--reach-color-' + name).trim();
    if (!value) continue;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    out[name] =
      '#' +
      [data[0], data[1], data[2]].map((channel) => channel.toString(16).padStart(2, '0')).join('');
  }
  return out;
}

const browser = await chromium.launch();
const page = await browser.newPage();
const mismatches = [];
let compared = 0;

for (const mode of ['light', 'dark']) {
  const expected = snapshot[mode];
  const names = Object.keys(expected);

  await page.goto(
    BASE +
      '/iframe.html?id=foundations-tokens--semantic-color&viewMode=story&globals=theme:' +
      mode,
    { waitUntil: 'networkidle', timeout: 30000 },
  );
  // Wait for the theme to be on the document rather than for a guess at how
  // long that takes. The decorator applies the class after render, and reading
  // too early silently compares the dark snapshot against light tokens.
  await page.waitForFunction(
    (want) => {
      const root = document.querySelector('#storybook-root');
      if (!root || root.childElementCount === 0) return false;
      return document.documentElement.classList.contains('dark') === (want === 'dark');
    },
    mode,
    { timeout: 15000 },
  );

  const actual = await page.evaluate(readTokens, names);

  for (const name of names) {
    compared += 1;
    if (actual[name] === undefined) {
      mismatches.push(mode + '  --reach-color-' + name + '  is no longer defined');
    } else if (actual[name] !== expected[name]) {
      mismatches.push(
        mode + '  --reach-color-' + name + '  snapshot ' + expected[name] + ', now ' + actual[name],
      );
    }
  }
}

/* ------------------------------------------------- the chrome follows too -- */

/**
 * The manager is a different document from the preview, and the theme control
 * sets a global that lives in the preview, so the chrome only follows it
 * because `manager.ts` listens on the channel and calls `setOptions`. That
 * wiring is invisible when it breaks: the story goes dark, the sidebar and its
 * footer stay light, and every other check here still passes.
 *
 * So this drives the real control and watches the real sidebar.
 */
const asRgb = (hex) => {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return 'rgb(' + r + ', ' + g + ', ' + b + ')';
};

const sidebarBackground = () =>
  page.evaluate(() => {
    const nav = document.querySelector('nav');
    return nav ? getComputedStyle(nav).backgroundColor : null;
  });

await page.goto(BASE + '/?path=/story/components-stepper--playground&globals=theme:light', {
  waitUntil: 'networkidle',
  timeout: 30000,
});
// Matched on `title`, which is the one part of the control that does not
// change with the theme. Its label alternates between "Light" and "Dark", and
// an accessible-name match on those also matches other buttons in the chrome.
const themeControl = page.getByTitle(/^Theme: /).first();
await themeControl.waitFor({ state: 'visible', timeout: 15000 });

const beforeToggle = await sidebarBackground();
// The tool mounts a moment after the manager renders, and a click that lands
// before React has attached its handler does nothing at all: the run then
// reports the chrome refusing to follow, which is a different bug entirely.
// Waiting for the control's own state to flip separates the two.
const titleBefore = await themeControl.getAttribute('title');
await themeControl.click();
await page
  .waitForFunction(
    (was) => {
      const button = document.querySelector('button[title^="Theme: "]');
      return button !== null && button.getAttribute('title') !== was;
    },
    titleBefore,
    { timeout: 10000 },
  )
  .catch(() => undefined);
// The control is a single-click toggle, so the click above already switched.
// This stays as a fallback: if it ever becomes a menu again, the option is
// picked here rather than the check reporting that the chrome refused to
// follow.
const darkOption = page.getByRole('button', { name: /^dark$/i }).first();
await darkOption.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
if (await darkOption.isVisible().catch(() => false)) {
  await darkOption.click();
}
// The chrome re-themes on a channel message, so wait for the value to change
// rather than for a fixed delay.
await page
  .waitForFunction(
    (was) => {
      const nav = document.querySelector('nav');
      return nav !== null && getComputedStyle(nav).backgroundColor !== was;
    },
    beforeToggle,
    { timeout: 10000 },
  )
  .catch(() => undefined);
const afterToggle = await sidebarBackground();

const wantLight = asRgb(snapshot.light['surface-sunken']);
const wantDark = asRgb(snapshot.dark['surface-sunken']);

if (beforeToggle !== wantLight) {
  mismatches.push('sidebar starts at ' + beforeToggle + ', expected ' + wantLight);
}
if (afterToggle !== wantDark) {
  mismatches.push(
    'sidebar did not follow the theme control: ' +
      beforeToggle +
      ' -> ' +
      afterToggle +
      ', expected ' +
      wantDark,
  );
}
compared += 2;

await browser.close();

console.log('token values compared: ' + compared);
console.log('sidebar followed the theme control: ' + beforeToggle + ' -> ' + afterToggle);

// A snapshot that matched nothing is not a passing check. If the token names
// were renamed wholesale, every lookup returns undefined and the loop above
// would otherwise have nothing to say.
if (compared === 0) {
  console.error('No tokens were compared. The snapshot is empty or the story failed to load.');
  process.exit(1);
}

if (mismatches.length > 0) {
  console.error('\nmanager theme is out of date with the tokens:\n');
  for (const line of mismatches) console.error('   ' + line);
  // Two different repairs hide behind this one list, so name the right one.
  console.error(
    mismatches.some((line) => line.startsWith('sidebar'))
      ? '\nThe chrome is not following the theme control. Check the `reach/theme-sync`\n' +
          'addon in apps/storybook/.storybook/manager.tsx.'
      : '\nUpdate apps/storybook/.storybook/reach-tokens.json.',
  );
  process.exit(1);
}

console.log('manager theme matches the tokens in both themes');
