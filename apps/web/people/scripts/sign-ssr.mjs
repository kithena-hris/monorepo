import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/*
 * Sign the server build for the shell (PEO-115).
 *
 * Writes `dist/ssr/manifest.json` — the SHA-384 of `people.cjs` and
 * `people.css`, SRI-style — and `manifest.json.sig`, an Ed25519 signature of
 * those exact bytes. The shell renders the build only when the signature
 * verifies under the public key it pins (`PEOPLE_REMOTE_SSR_PUBLIC_KEY`) and
 * the hashes match what the host served.
 *
 * Run by the deploy pipeline after `build`, with the private key from the
 * pipeline's own secrets — never from the remote's hosting platform, whose
 * compromise is what this exists to survive. `PEOPLE_REMOTE_SSR_SIGNING_KEY`
 * is a base64 PKCS#8 DER Ed25519 key.
 */
const dir = join(import.meta.dirname, '../dist/ssr');
const secret = process.env['PEOPLE_REMOTE_SSR_SIGNING_KEY'];
if (secret === undefined || secret === '') {
  console.error('PEOPLE_REMOTE_SSR_SIGNING_KEY is not set; the build is not signed');
  process.exit(1);
}
const key = createPrivateKey({ key: Buffer.from(secret, 'base64'), format: 'der', type: 'pkcs8' });

const sri = async (file) =>
  `sha384-${createHash('sha384')
    .update(await readFile(join(dir, file)))
    .digest('base64')}`;
const manifest = JSON.stringify({
  files: { 'people.cjs': await sri('people.cjs'), 'people.css': await sri('people.css') },
});
await writeFile(join(dir, 'manifest.json'), manifest);
await writeFile(
  join(dir, 'manifest.json.sig'),
  sign(null, Buffer.from(manifest), key).toString('base64'),
);
console.log(`signed ${manifest}`);
