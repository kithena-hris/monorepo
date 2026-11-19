/**
 * The icons Kithena's emails show, as PNGs: `node apps/web/scripts/email-icons.mjs`.
 *
 * A mail client draws no inline SVG (Gmail strips it) and no icon font, so an
 * email's icon is an image at an address. These are Lucide's own outlines,
 * the set Reach draws everywhere else, in white on nothing: the email puts
 * each on a disc of the company's colour, so one file serves every company
 * and both the light and the dark client.
 *
 * Written to both sites an email links to (`apps/web`, `apps/jobs`), because
 * the image is asked for from the site its button opens. Run it again when
 * the list changes; the files are committed.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(join(root, 'packages', 'ui', 'package.json'));
// `sharp` comes with Next (its image optimiser), not as a dependency of its own:
// asked for from where Next is, so this adds none.
const web = createRequire(join(root, 'apps', 'web', 'package.json'));
const sharp = createRequire(web.resolve('next/package.json'))('sharp');
const icons = join(dirname(require.resolve('lucide-react')), '..', 'esm', 'icons');

/** What an email is about, to the Lucide icon that says it. */
export const ICONS = {
  mail: 'mail',
  code: 'key-round',
  calendar: 'calendar-check',
  sign: 'pen-line',
  document: 'file-text',
  offer: 'badge-check',
  bell: 'bell',
  person: 'user-plus',
  inbox: 'inbox',
  clock: 'clock',
  report: 'chart-column',
};

const attrs = (o) =>
  Object.entries(o)
    .filter(([k]) => k !== 'key')
    .map(([k, v]) => `${k}="${String(v)}"`)
    .join(' ');

for (const [name, lucide] of Object.entries(ICONS)) {
  const source = await readFile(join(icons, `${lucide}.mjs`), 'utf8');
  // The `node` literal, up to the bracket that closes it at its own indent.
  const node = /node:\s*(\[[\s\S]*?\n {2}\])/u.exec(source)?.[1];
  if (node === undefined) throw new Error(`no outline for ${lucide}`);
  // The file's own literal: arrays of a tag and its attributes.
  const shapes = Function(`return ${node}`)();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes
    .map(([tag, a]) => `<${tag} ${attrs(a)} />`)
    .join('')}</svg>`;
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  for (const app of ['web', 'jobs']) {
    const dir = join(root, 'apps', app, 'public', 'email');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.png`), png);
  }
}
console.log(`${String(Object.keys(ICONS).length)} icons written`);
