/**
 * Email theme drift check.
 *
 * An email cannot reference a Reach custom property. There is no stylesheet to
 * load, `var()` is unsupported in most mail clients, and Outlook renders
 * through Word, which has no custom properties at all — so the invitation
 * template carries concrete sRGB values, and a snapshot of a colour is a thing
 * that goes stale silently.
 *
 * This is the same problem `tools/storybook/manager-theme-drift.mjs` has for
 * Storybook's manager, and it is answered the same way. The difference is the
 * method: that one rasterises through a browser because it needs the *computed*
 * value of a chain that ends in a theme class on a live document. This one has
 * no browser to reach for — it runs in CI beside the unit tests — so it reads
 * `tokens.css`, resolves the `var()` chain itself, and converts. The converter
 * is verified against that other file's browser-produced output, which is what
 * makes doing it in Node defensible rather than merely convenient.
 *
 * Usage: `pnpm email:theme-drift`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { oklchToHex, parseOklch } from './oklch.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const tokens = read('../../packages/ui/src/styles/tokens.css');
const palette = read('../../platform/messaging/src/message/domain/palette.ts');
// Browser-produced, for the same tokens. Verifying the converter against it is
// the whole reason this script is allowed to do colour maths in Node.
const browserResolved = JSON.parse(read('../../apps/storybook/.storybook/reach-tokens.json'));

/* ------------------------------------------------------ reading the tokens */

/**
 * Every `--reach-*: value` declaration, split by which block it is in.
 *
 * `.dark` re-points the semantic layer at different primitives and restates
 * nothing else, so the dark theme is the light one with those overrides
 * applied — which is exactly how the cascade resolves it in a browser.
 */
function declarations(css) {
  const darkAt = css.indexOf('.dark {');
  const split = darkAt === -1 ? css.length : darkAt;
  const collect = (text) => {
    const found = new Map();
    for (const [, name, value] of text.matchAll(/(--reach-[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name, value.trim().replaceAll(/\s+/g, ' '));
    }
    return found;
  };
  return { light: collect(css.slice(0, split)), dark: collect(css.slice(split)) };
}

/** Follows `var(--a)` until it reaches a literal, or gives up loudly. */
function resolve(name, scope) {
  let value = scope.get(name);
  for (let hops = 0; hops < 10; hops += 1) {
    if (value === undefined) return null;
    const indirect = /^var\((--[\w-]+)\)$/.exec(value);
    if (!indirect) return value;
    value = scope.get(indirect[1]);
  }
  throw new Error(`--reach token chain did not terminate: ${name}`);
}

const { light, dark } = declarations(tokens);
// The dark block overrides the light one rather than replacing it.
const darkScope = new Map([...light, ...dark]);

function hexFor(token, scope) {
  const value = resolve(`--reach-color-${token}`, scope);
  if (value === null) return null;
  const parsed = parseOklch(value);
  return parsed === null ? null : oklchToHex(parsed);
}

/* ------------------------------------- is the converter telling the truth? */

const converterFailures = [];
for (const [theme, scope] of [
  ['light', light],
  ['dark', darkScope],
]) {
  for (const [token, expected] of Object.entries(browserResolved[theme] ?? {})) {
    const got = hexFor(token, scope);
    if (got !== null && got !== expected) {
      converterFailures.push(`  ${theme}/${token}: converted ${got}, browser said ${expected}`);
    }
  }
}

if (converterFailures.length > 0) {
  process.stdout.write(
    'The OKLCH conversion no longer agrees with what a browser produces.\n' +
      'Compared against apps/storybook/.storybook/reach-tokens.json:\n' +
      `${converterFailures.join('\n')}\n`,
  );
  process.exit(1);
}

/* ---------------------------------------------- is the email snapshot true? */

/** `export const light: Palette = { … }` out of the palette module, as written. */
function snapshotOf(source, theme) {
  const block = new RegExp(`export const ${theme}: Palette = \\{([^}]*)\\}`, 's').exec(source);
  if (!block) throw new Error(`palette.ts has no \`${theme}\` block to check`);
  const found = new Map();
  for (const [, token, hex] of block[1].matchAll(/'?([\w-]+)'?\s*:\s*'(#[0-9a-f]{6})'/g)) {
    found.set(token, hex);
  }
  return found;
}

const drift = [];
let checked = 0;

for (const [theme, scope] of [
  ['light', light],
  ['dark', darkScope],
]) {
  for (const [token, snapshot] of snapshotOf(palette, theme)) {
    const current = hexFor(token, scope);
    if (current === null) {
      drift.push(`  ${theme}/${token}: no --reach-color-${token} in tokens.css any more`);
      continue;
    }
    checked += 1;
    if (current !== snapshot) {
      drift.push(`  ${theme}/${token}: palette.ts says ${snapshot}, the token is now ${current}`);
    }
  }
}

if (drift.length > 0) {
  process.stdout.write(
    'The invitation email has drifted from the design system.\n' +
      'platform/messaging/src/message/domain/palette.ts needs updating:\n' +
      `${drift.join('\n')}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `Email palette matches Reach: ${String(checked)} tokens, both themes, ` +
    `and the conversion still agrees with the browser.\n`,
);
