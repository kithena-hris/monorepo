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

/**
 * The element that actually paints the sidebar.
 *
 * Storybook 10 moved the fill off `<nav>` and onto the `header` wrapping it, so
 * reading `<nav>` there returns `rgba(0, 0, 0, 0)` in both themes and this
 * check reports the chrome refusing to follow the control — a break that is
 * entirely in the selector, not in the addon it names. `<nav>` stays as a
 * fallback so the check still measures the right box on Storybook 9.
 */
const SIDEBAR = 'header.sidebar-container, nav';

const sidebarBackground = () =>
  page.evaluate((selector) => {
    const sidebar = document.querySelector(selector);
    return sidebar ? getComputedStyle(sidebar).backgroundColor : null;
  }, SIDEBAR);

const MANAGER = BASE + '/?path=/story/components-stepper--playground&globals=theme:light';

/**
 * Loads the manager, clicks the theme control once, and reports what the
 * sidebar did. Returns the pair so the caller can retry: see the warm-up note
 * below for why a single attempt is not trustworthy.
 */
async function toggleAndWatchSidebar() {
  await page.goto(MANAGER, { waitUntil: 'networkidle', timeout: 30000 });
  // Matched on `title`, which is the one part of the control that does not
  // change with the theme. Its label alternates between "Light" and "Dark", and
  // an accessible-name match on those also matches other buttons in the chrome.
  const themeControl = page.getByTitle(/^Theme: /).first();
  await themeControl.waitFor({ state: 'visible', timeout: 15000 });

  const before = await sidebarBackground();
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
      ([was, selector]) => {
        const sidebar = document.querySelector(selector);
        return sidebar !== null && getComputedStyle(sidebar).backgroundColor !== was;
      },
      [before, SIDEBAR],
      { timeout: 10000 },
    )
    .catch(() => undefined);
  return { before, after: await sidebarBackground() };
}

/*
 * Warm the manager before believing anything it says.
 *
 * The loop above only ever loaded `iframe.html`, so this is the first thing in
 * the run to load the manager document — and the manager is the only thing
 * that imports `storybook/theming`. On a cold Vite cache the optimizer
 * discovers that dependency here, rebundles it, and reloads the page to serve
 * the new version. The reload throws away the document the click just landed
 * in and restores `globals=theme:light` from the URL, so the sidebar reads back
 * light and the check reports the chrome refusing to follow the control. That
 * is a different bug from the one this is looking for, and it is the one CI
 * kept hitting: a developer's machine has the dependency cached from the last
 * session and never sees it.
 *
 * Loading once and discarding the result moves that reload in front of the
 * measurement. The retry covers a runner slow enough for it to land later
 * anyway — an unchanged sidebar is the symptom of both the race and a real
 * break, and only the second attempt tells them apart.
 */
await page.goto(MANAGER, { waitUntil: 'networkidle', timeout: 30000 });
await page
  .getByTitle(/^Theme: /)
  .first()
  .waitFor({ state: 'visible', timeout: 15000 })
  .catch(() => undefined);

let { before: beforeToggle, after: afterToggle } = await toggleAndWatchSidebar();
if (afterToggle === beforeToggle) {
  ({ before: beforeToggle, after: afterToggle } = await toggleAndWatchSidebar());
}

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
// Only when it did. This line printed unconditionally, above the mismatch
// check, so a failing run reported the sidebar following the control and then
// reported it not following — in the same output, with the same two values.
if (!mismatches.some((line) => line.startsWith('sidebar'))) {
  console.log('sidebar followed the theme control: ' + beforeToggle + ' -> ' + afterToggle);
}

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
