import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/*
 * The signed server build, checked as the shell checks it (PEO-115): the
 * manifest verifies under the pinned public key, and every file it names
 * hashes to what it says.
 *
 * `verifySigned` is shared with `smoke-deploy.mjs`, which runs it over the
 * bytes the remote's domain serves. Run directly — `node
 * scripts/verify-ssr.mjs`, with `PEOPLE_REMOTE_SSR_PUBLIC_KEY` set — it checks
 * `dist/ssr` before upload, so a signing key and a pinned key from different
 * pairs, or a `dist` written after signing, fail before production is touched.
 */
const sri = (bytes) => `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

/** @returns {string[]} what failed; empty when the build is signed for the shell. */
export const verifySigned = ({ manifest, signature, files }, pinned) => {
  let key;
  try {
    key = createPublicKey({
      key: Buffer.from(pinned ?? '', 'base64'),
      format: 'der',
      type: 'spki',
    });
  } catch {
    return ['PEOPLE_REMOTE_SSR_PUBLIC_KEY is not a base64 SPKI DER key'];
  }
  const failures = [];
  if (!verify(null, manifest, key, Buffer.from(signature.toString('utf8'), 'base64'))) {
    failures.push('the manifest does not verify under the key the shell pins');
  }
  const named = JSON.parse(manifest.toString('utf8')).files ?? {};
  for (const [name, bytes] of Object.entries(files)) {
    if (named[name] !== sri(bytes))
      failures.push(`the manifest does not name the ${name} being served`);
  }
  return failures;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = join(import.meta.dirname, '../dist/ssr');
  const read = (file) => readFile(join(dir, file));
  const failures = verifySigned(
    {
      manifest: await read('manifest.json'),
      signature: await read('manifest.json.sig'),
      files: { 'people.cjs': await read('people.cjs'), 'people.css': await read('people.css') },
    },
    process.env['PEOPLE_REMOTE_SSR_PUBLIC_KEY'],
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`::error::dist/ssr: ${failure}`);
    process.exit(1);
  }
  console.log(`dist/ssr verifies: ${(await read('manifest.json')).toString('utf8')}`);
}
