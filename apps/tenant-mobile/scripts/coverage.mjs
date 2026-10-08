/**
 * Every operation the web app can run, against the phone app.
 *
 *   pnpm --filter @kithena/tenant-mobile coverage           report
 *   pnpm --filter @kithena/tenant-mobile coverage --strict  exit 1 on a gap
 *
 * "Everything the web does" is not a feeling: it is this list. An operation
 * in `apps/web/src/lib/people-operations.ts` or `timeoff-operations.ts` is
 * covered when the app asks for it by name (`ask(…, 'Name')`, `useRead('Name')`),
 * or a phone route on the company host runs it for the app (`/api/mobile/*`),
 * or when `desktop-only.json` names it with the design note that keeps it off
 * a phone. Anything else is a gap, listed by module.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(app, '../web/src/lib');

/** The keys of `OPERATIONS`: the top-level entries, two spaces in. */
function operations(file) {
  const text = readFileSync(join(web, file), 'utf8');
  const body = text.slice(text.indexOf('export const OPERATIONS'));
  return [...body.matchAll(/^ {2}([A-Z]\w+): /gm)].map((m) => m[1]);
}

function sources(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

// The app's own code, and the phone's server routes on the company host
// (`/api/mobile/*`), which run some operations on its behalf: view-as.
const used = new Set(
  [...sources(join(app, 'src')), ...sources(join(app, '../web/src/app/api/mobile'))].flatMap(
    (file) => [...readFileSync(file, 'utf8').matchAll(/'([A-Z]\w+)'/g)].map((m) => m[1]),
  ),
);
const desktopOnly = JSON.parse(readFileSync(join(app, 'desktop-only.json'), 'utf8'));

let gaps = 0;
for (const [module, file] of [
  ['People', 'people-operations.ts'],
  ['Time Off', 'timeoff-operations.ts'],
]) {
  const all = operations(file);
  const missing = all.filter((op) => !used.has(op) && !(op in desktopOnly));
  gaps += missing.length;
  console.log(`${module}: ${String(all.length - missing.length)} of ${String(all.length)} covered`);
  for (const op of missing) console.log(`  - ${op}`);
}
const stale = Object.keys(desktopOnly).filter((op) => used.has(op));
for (const op of stale) console.log(`desktop-only.json lists ${op}, which the app now uses`);

if (process.argv.includes('--strict') && (gaps > 0 || stale.length > 0)) process.exit(1);
