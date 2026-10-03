import { readFile } from 'node:fs/promises';

import { verifySigned } from './verify-ssr.mjs';

/*
 * The deployed remote, checked as the shell will use it.
 *
 * `node scripts/smoke-deploy.mjs <remote-url> <tenant-origin> <signed-manifest>`,
 * with `TIMEOFF_REMOTE_SSR_PUBLIC_KEY` set to the key the shell pins and the
 * third argument the `dist/ssr/manifest.json` this job signed and uploaded.
 * Run by the deploy workflows after the remote is deployed and before the
 * shell is.
 *
 * - `remoteEntry.js`, `routes.json` and the signed manifest are served, with
 *   the `vercel.json` headers the shell relies on: `no-cache` so a deploy is
 *   seen at once, `nosniff`, and CORS for a tenant origin. The browser no
 *   longer relies on that CORS: it loads the remote through the shell, from
 *   `/_timeoff/*` on the company's own host (`apps/web/src/proxy.ts`).
 * - The manifest verifies under the pinned public key and names the
 *   `timeoff.cjs` actually served. A signing secret and a pinned key from two
 *   different pairs would otherwise ship green, and the shell would silently
 *   fall back to rendering every Time Off screen in the browser.
 * - The manifest served is the one this job signed, so an alias that never
 *   moved cannot pass on the previous deployment's files.
 *
 * Every file is read again, together, until one round passes or three minutes
 * are up. The domain answers from the old and the new deployment for a while
 * after `vercel deploy` reports it aliased. On 2026-10-01 (#214) both checks
 * failed against a deployment whose own files verified, which only a manifest
 * from one deployment read with the code and signature of another produces. A
 * round only passes on one consistent set, so a mixed read is retried, never
 * excused, and a deploy that is really wrong still fails at the deadline.
 *
 * The remote's URL is its custom domain, not the deployment's: a `.vercel.app`
 * host answers 302 to a login page when protection is on.
 */
const [base, origin] = process.argv.slice(2, 4).map((value) => value.replace(/\/$/, ''));
const signedPath = process.argv[4];
if (base === undefined || origin === undefined || signedPath === undefined) {
  console.error(
    'usage: node scripts/smoke-deploy.mjs <remote-url> <tenant-origin> <signed-manifest>',
  );
  process.exit(2);
}
const signed = await readFile(signedPath);

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

const round = async () => {
  const failures = [];
  const bodies = {};
  for (const path of [
    '/remoteEntry.js',
    '/routes.json',
    '/ssr/timeoff.cjs',
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
    if (headers.get('cache-control') !== 'no-cache')
      failures.push(`${path} is not served no-cache`);
    if (headers.get('x-content-type-options') !== 'nosniff')
      failures.push(`${path} is not served nosniff`);
    if (headers.get('access-control-allow-origin') !== origin) {
      failures.push(`${path} does not allow ${origin}`);
    }
    bodies[path] = Buffer.from(await response.arrayBuffer());
  }

  const manifest = bodies['/ssr/manifest.json'];
  const signature = bodies['/ssr/manifest.json.sig'];
  const code = bodies['/ssr/timeoff.cjs'];
  if (manifest !== undefined && signature !== undefined && code !== undefined) {
    if (!manifest.equals(signed))
      failures.push('the manifest served is not the one this job signed');
    failures.push(
      ...verifySigned(
        { manifest, signature, files: { 'timeoff.cjs': code } },
        process.env['TIMEOFF_REMOTE_SSR_PUBLIC_KEY'],
      ),
    );
  }
  return failures;
};

const deadline = Date.now() + 180_000;
let failures = await round();
while (failures.length > 0 && Date.now() < deadline) {
  console.log(`not yet: ${failures.join('; ')}; reading every file again in 10s`);
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  failures = await round();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
console.log('time off remote: served, headed and signed for the shell');
