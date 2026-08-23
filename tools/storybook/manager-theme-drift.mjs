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
 * The boxes that may paint the sidebar, outermost first.
 *
 * Storybook 10 moved the fill off `<nav>` and onto the `header` wrapping it, so
 * reading `<nav>` there returns `rgba(0, 0, 0, 0)` in both themes and this
 * check reports the chrome refusing to follow the theme control — a break
 * entirely in the selector, not in the addon it names.
 *
 * Both are listed rather than one being picked by version, and the first that
 * is not transparent wins. A selector list would not do: `header` exists in
 * both versions, so matching it first and stopping would read a transparent
 * box on whichever version does not paint it, which is the failure this is
 * fixing.
 */
const SIDEBAR_CANDIDATES = ['header.sidebar-container', 'nav'];

/** Reads the first candidate that actually paints. Runs in the page. */
function readSidebarBackground(selectors) {
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';
  let seen = null;
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element === null) continue;
    const background = getComputedStyle(element).backgroundColor;
    // Remember the first one found, so a chrome that is genuinely transparent
    // reports that rather than `null` — which would read as "no sidebar".
    if (seen === null) seen = background;
    if (background !== TRANSPARENT) return background;
  }
  return seen;
}

const sidebarBackground = () => page.evaluate(readSidebarBackground, SIDEBAR_CANDIDATES);

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
  const controlFlipped = await page
    .waitForFunction(
      (was) => {
        const button = document.querySelector('button[title^="Theme: "]');
        return button !== null && button.getAttribute('title') !== was;
      },
      titleBefore,
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  // The control is a single-click toggle, so the click above already switched.
  // This stays as a fallback: if it ever becomes a menu again, the option is
  // picked here rather than the check reporting that the chrome refused to
  // follow.
  //
  // It must never match the toggle itself. The toggle's label alternates, so
  // once the click above has switched to dark its accessible name *is* "Dark"
  // and this matched it — clicking it a second time and switching straight
  // back to light. Whether that lost the run came down to which landed first,
  // the re-theme or the measurement: a warm machine read dark and passed, and
  // CI read light and reported the chrome refusing to follow a control that
  // had in fact followed it twice. The title is the part that does not
  // alternate, so it is what rules the toggle out.
  const darkOption = page
    .getByRole('button', { name: /^dark$/i })
    .and(page.locator('button:not([title^="Theme: "])'))
    .first();
  await darkOption.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined);
  if (await darkOption.isVisible().catch(() => false)) {
    await darkOption.click();
  }
  // The chrome re-themes on a channel message, so wait for the value to change
  // rather than for a fixed delay.
  await page
    .waitForFunction(
      // Repeats the scan above rather than calling it: Playwright serialises
      // this function and runs it in the page, where it cannot close over
      // anything in this module.
      ([was, selectors]) => {
        const TRANSPARENT = 'rgba(0, 0, 0, 0)';
        let seen = null;
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element === null) continue;
          const background = getComputedStyle(element).backgroundColor;
          if (seen === null) seen = background;
          if (background !== TRANSPARENT) {
            seen = background;
            break;
          }
        }
        return seen !== null && seen !== was;
      },
      [before, SIDEBAR_CANDIDATES],
      { timeout: 10000 },
    )
    .catch(() => undefined);
  return { before, after: await sidebarBackground(), controlFlipped };
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

/*
 * Retried until the sidebar moves, because an unmoved sidebar has two causes
 * and neither is visible from the value alone.
 *
 * A flipped control is *not* proof the chrome was asked to re-theme. The
 * optimizer reload described above can land after the click: the title flips,
 * the document is then thrown away, and the reload restores `theme:light` from
 * the URL. That reads back exactly like a chrome refusing to follow, and it is
 * the failure this gate kept hitting on CI while passing on a warm cache.
 *
 * So the retry is keyed on the measurement, not on the control. `controlFlipped`
 * is kept for the diagnosis only: a run where it never flipped is a control
 * that never responded, which is worth saying rather than blaming the addon.
 */
let beforeToggle;
let afterToggle;
let controlEverFlipped = false;

for (let attempt = 1; attempt <= 3; attempt += 1) {
  const result = await toggleAndWatchSidebar();
  ({ before: beforeToggle, after: afterToggle } = result);
  controlEverFlipped = controlEverFlipped || result.controlFlipped;
  if (result.after !== result.before) break;
}

const wantLight = asRgb(snapshot.light['surface-sunken']);
const wantDark = asRgb(snapshot.dark['surface-sunken']);

if (beforeToggle !== wantLight) {
  mismatches.push('sidebar starts at ' + beforeToggle + ', expected ' + wantLight);
}
if (!controlEverFlipped) {
  mismatches.push(
    'sidebar theme control never changed state across 3 attempts, so the chrome was ' +
      'never asked to re-theme. This is the control, not the addon.',
  );
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
