import { createHash, createPublicKey, verify } from 'node:crypto';

/*
 * The deployed remote, checked as the shell will use it.
 *
 * `node scripts/smoke-deploy.mjs <remote-url> <tenant-origin>`, with
 * `PEOPLE_REMOTE_SSR_PUBLIC_KEY` set to the key the shell pins. Run by the
 * deploy workflows after the remote is deployed and before the shell is.
 *
 * - `remoteEntry.js`, `routes.json` and the signed manifest are served, with
 *   the `vercel.json` headers the shell relies on: `no-cache` so a deploy is
 *   seen at once, `nosniff`, and CORS for a tenant origin.
 * - The manifest verifies under the pinned public key and names the
 *   `people.cjs` actually served. A signing secret and a pinned key from two
 *   different pairs would otherwise ship green, and the shell would silently
 *   fall back to rendering every People screen in the browser.
 *
 * The remote's URL is its custom domain, not the deployment's: a `.vercel.app`
 * host answers 302 to a login page when protection is on.
 */
const [base, origin] = process.argv.slice(2).map((value) => value.replace(/\/$/, ''));
if (base === undefined || origin === undefined) {
  console.error('usage: node scripts/smoke-deploy.mjs <remote-url> <tenant-origin>');
  process.exit(2);
}

const failures = [];
const fetchWithRetry = async (path) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(`${base}${path}`, {
        headers: { origin },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok || attempt === 5) return response;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
};

const bodies = {};
for (const path of [
  '/remoteEntry.js',
  '/routes.json',
  '/ssr/people.cjs',
  '/ssr/manifest.json',
  '/ssr/manifest.json.sig',
]) {
  const response = await fetchWithRetry(path);
  const headers = response.headers;
  console.log(
    `${path}: ${String(response.status)} cache-control=${headers.get('cache-control') ?? '-'}`,
  );
  if (response.status !== 200) {
    failures.push(`${path} answered ${String(response.status)}`);
    continue;
  }
  if (headers.get('cache-control') !== 'no-cache') failures.push(`${path} is not served no-cache`);
  if (headers.get('x-content-type-options') !== 'nosniff')
    failures.push(`${path} is not served nosniff`);
  if (headers.get('access-control-allow-origin') !== origin) {
    failures.push(`${path} does not allow ${origin}`);
  }
  bodies[path] = Buffer.from(await response.arrayBuffer());
}

const manifest = bodies['/ssr/manifest.json'];
const signature = bodies['/ssr/manifest.json.sig'];
const code = bodies['/ssr/people.cjs'];
if (manifest !== undefined && signature !== undefined && code !== undefined) {
  const pinned = process.env['PEOPLE_REMOTE_SSR_PUBLIC_KEY'] ?? '';
  let key;
  try {
    key = createPublicKey({ key: Buffer.from(pinned, 'base64'), format: 'der', type: 'spki' });
  } catch {
    failures.push('PEOPLE_REMOTE_SSR_PUBLIC_KEY is not a base64 SPKI DER key');
  }
  if (key !== undefined) {
    if (!verify(null, manifest, key, Buffer.from(signature.toString('utf8'), 'base64'))) {
      failures.push('the manifest does not verify under the key the shell pins');
    }
    const served = `sha384-${createHash('sha384').update(code).digest('base64')}`;
    if (JSON.parse(manifest.toString('utf8')).files?.['people.cjs'] !== served) {
      failures.push('the manifest does not name the people.cjs being served');
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
console.log('people remote: served, headed and signed for the shell');
