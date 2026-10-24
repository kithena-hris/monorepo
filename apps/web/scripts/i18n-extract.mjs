/**
 * The English every language is translated from, read out of the code.
 *
 * Every word on a screen is written `t('key', 'English', { vars })`. This
 * walks each namespace's source, finds those calls and writes
 * `src/locales/source/<namespace>.json`: each key's English and a line of
 * context — the area, the file and component, and what the words are on the
 * screen (a button, a field's label, a dialog's title, an `aria-label`) — so
 * the translation is of words in a place, not of words alone.
 *
 *   node apps/web/scripts/i18n-extract.mjs           write the catalogues
 *   node apps/web/scripts/i18n-extract.mjs --check   fail when they are out of date
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from '@typescript/typescript6';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(ROOT, 'apps/web/src/locales/source');

/** Each namespace, where its code is, and what it is called on screen. */
export const SOURCES = {
  shell: { dir: 'apps/web/src', area: 'the app’s frame: navigation, account menu, inbox, search' },
  reach: {
    dir: 'packages/ui/src',
    area: 'shared interface components (buttons, tables, pickers, dialogs)',
  },
  people: { dir: 'apps/web/people/src', area: 'People: employee records, org chart, HR settings' },
  timeoff: {
    dir: 'apps/web/timeoff/src',
    area: 'Time Off: leave, absences, time tracking, policies',
  },
  recruiting: {
    dir: 'apps/web/recruiting/src',
    area: 'Recruiting: jobs, candidates, interviews, offers',
  },
  documents: { dir: 'apps/web/documents/src', area: 'Documents: files, e-signatures, letters' },
  onboarding: {
    dir: 'apps/web/onboarding/src',
    area: 'Onboarding: new joiners’ tasks and checklists',
  },
  performance: {
    dir: 'apps/web/performance/src',
    area: 'Performance: reviews, goals, feedback, learning',
  },
};

const SKIP = /\.(test|stories)\.tsx?$|\.d\.ts$|\/(test|testing|locales)\//u;

const files = (dir) =>
  execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', dir], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => /\.tsx?$/u.test(f) && !SKIP.test(f));

/** What the words are on the screen, from where the call sits. */
function placeOf(call, sf) {
  let element = null;
  let attribute = null;
  let property = null;
  let fn = null;
  for (let n = call.parent; n; n = n.parent) {
    if (attribute === null && ts.isJsxAttribute(n)) attribute = n.name.getText(sf);
    if (property === null && attribute === null && ts.isPropertyAssignment(n))
      property = n.name.getText(sf).replaceAll(/['"]/gu, '');
    if (element === null && (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n))) {
      const opening = ts.isJsxElement(n) ? n.openingElement : n;
      element = opening.tagName.getText(sf);
    }
    if (
      fn === null &&
      (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) &&
      n.name !== undefined &&
      ts.isIdentifier(n.name) &&
      /^[A-Z]|^use/u.test(n.name.text)
    )
      fn = n.name.text;
  }
  const what =
    attribute !== null
      ? `the ${attribute} of <${element ?? '?'}>`
      : element !== null
        ? `text inside <${element}>`
        : property !== null
          ? `a "${property}" value`
          : 'text built in code';
  return { what, fn };
}

/**
 * A message with forms, `{ one: '…', other: '…' }` (`@reach/ui` `Plural`):
 * written to the catalogue as `key_one` and `key_other`, and each language
 * translated into the forms its grammar has.
 */
function formsOf(node, sf) {
  if (!ts.isObjectLiteralExpression(node)) return null;
  const forms = {};
  for (const p of node.properties) {
    if (!ts.isPropertyAssignment(p) || !ts.isStringLiteralLike(p.initializer)) return null;
    forms[p.name.getText(sf).replaceAll(/['"]/gu, '')] = p.initializer.text;
  }
  const names = Object.keys(forms).sort().join(',');
  return names === 'one,other' ? forms : null;
}

function extract(ns) {
  const { dir, area } = SOURCES[ns];
  const out = {};
  const problems = [];
  for (const file of files(dir)) {
    const code = readFileSync(join(ROOT, file), 'utf8');
    if (!/\bt(r)?\(/u.test(code)) continue;
    const sf = ts.createSourceFile(
      file,
      code,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const visit = (n) => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        (n.expression.text === 't' || n.expression.text === 'tr') &&
        n.arguments.length >= 2 &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        (ts.isStringLiteralLike(n.arguments[1]) || formsOf(n.arguments[1], sf) !== null)
      ) {
        const key = n.arguments[0].text;
        const forms = formsOf(n.arguments[1], sf);
        const vars =
          n.arguments[2] !== undefined && ts.isObjectLiteralExpression(n.arguments[2])
            ? n.arguments[2].properties.map((p) => p.name?.getText(sf)).filter(Boolean)
            : [];
        const { what, fn } = placeOf(n, sf);
        const where = `${relative(dir, file)}${fn === null ? '' : `, ${fn}`}`;
        const filledIn =
          vars.length === 0 ? '' : ` Filled in: ${vars.map((v) => `{{${v}}}`).join(', ')}.`;
        const entries =
          forms === null
            ? [[key, n.arguments[1].text, '']]
            : [
                [`${key}_one`, forms.one, ' Plural: the words for a {{count}} of one.'],
                [`${key}_other`, forms.other, ' Plural: the words for any other {{count}}.'],
              ];
        for (const [k, text, plural] of entries) {
          const held = out[k];
          if (held !== undefined && held.text !== text)
            problems.push(`${ns}:${k} is "${held.text}" and "${text}" (${where})`);
          else if (held === undefined)
            out[k] = { text, context: `${area}. ${where}: ${what}.${filledIn}${plural}` };
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return {
    catalogue: Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b))),
    problems,
  };
}

const check = process.argv.includes('--check');
let failed = false;
for (const ns of Object.keys(SOURCES)) {
  const { catalogue, problems } = extract(ns);
  for (const p of problems) console.error(`two texts for one key: ${p}`);
  if (problems.length > 0) failed = true;
  const path = join(OUT, `${ns}.json`);
  const next = `${JSON.stringify(catalogue, null, 2)}\n`;
  let held = '';
  try {
    held = readFileSync(path, 'utf8');
  } catch {
    // New.
  }
  if (held === next) continue;
  if (check) {
    console.error(
      `src/locales/source/${ns}.json is out of date: run pnpm --filter @kithena/web i18n:extract`,
    );
    failed = true;
  } else {
    writeFileSync(path, next);
    console.log(`${ns}: ${String(Object.keys(catalogue).length)} keys`);
  }
}
if (failed) process.exit(1);
