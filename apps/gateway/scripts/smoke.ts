import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The deploy image's safelist, proven before the image ships.
 *
 * `tsx scripts/smoke.ts <image>` starts the built router image with a JWKS this
 * script serves, signs itself an access token, and asserts the three answers
 * that matter: a persisted operation is accepted, an unknown hash is refused,
 * and a request without a token never reaches either.
 *
 * Against the image rather than the deployment because a live router refuses
 * anything unauthenticated before it looks at the operation, and the only
 * tokens it accepts are ones identity mints for a signed-in session — which a
 * workflow must never hold. The image is what gets pushed, so this is the same
 * safelist the deployment serves; the workflow then checks the live router is
 * ready and refuses a stranger.
 *
 * People is not running, so the accepted operation fails at the subgraph. That
 * is the point of the assertion: it got past the safelist.
 */

const image = process.argv[2];
if (image === undefined) {
  console.error('usage: tsx scripts/smoke.ts <image>');
  process.exit(2);
}

const AUDIENCE = 'kithena-router-smoke';
const HERE = fileURLToPath(new URL('..', import.meta.url));
const known = (await readdir(join(HERE, 'persisted/operations'))).find((f) => f.endsWith('.json'));
if (known === undefined) {
  console.error('apps/gateway/persisted/operations is empty; the router would refuse everything');
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const kid = randomUUID();
const jwks = JSON.stringify({
  keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' }],
});
const jwksServer = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(jwks);
});
await new Promise<void>((resolve) => jwksServer.listen(0, '0.0.0.0', resolve));
const address = jwksServer.address();
const jwksPort = typeof address === 'object' && address !== null ? address.port : 0;

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: 'ES256', kid, typ: 'JWT' })}.${b64({
  sub: randomUUID(),
  tid: randomUUID(),
  aud: AUDIENCE,
  iat: now,
  exp: now + 300,
})}`;
const token = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;

const refusedAsUnknown = (body: string) => /PersistedQueryNotFound/iu.test(body);
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const container = docker(
  'run',
  '--detach',
  '--add-host',
  'host.docker.internal:host-gateway',
  '--publish',
  '127.0.0.1::4000',
  '--env',
  `AUTH_JWKS_URL=http://host.docker.internal:${String(jwksPort)}/`,
  '--env',
  `AUTH_TOKEN_AUDIENCE=${AUDIENCE}`,
  '--env',
  'PEOPLE_API_TOKEN=smoke',
  '--env',
  'KITHENA_ENTITLEMENTS=[]',
  image,
);
const failures: string[] = [];
try {
  const port = docker('port', container, '4000').split(':').pop() ?? '';
  const router = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (
    !(await fetch(`${router}/health/ready`).then(
      (r) => r.ok,
      () => false,
    ))
  ) {
    if (Date.now() > deadline)
      throw new Error(`the router never became ready\n${docker('logs', container)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const ask = async (hash: string, bearer?: string) => {
    const response = await fetch(`${router}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'graphql-client-name': 'kithena-web',
        ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }),
    });
    return { status: response.status, body: await response.text() };
  };

  const accepted = await ask(known.replace(/\.json$/u, ''), token);
  console.log(`persisted ${known}: ${String(accepted.status)} ${accepted.body.slice(0, 200)}`);
  if (accepted.status === 401 || refusedAsUnknown(accepted.body)) {
    failures.push('a persisted operation was refused: the safelist is missing from the image');
  }

  const unknown = await ask(
    createHash('sha256').update(`not persisted ${randomUUID()}`).digest('hex'),
    token,
  );
  console.log(`unknown hash: ${String(unknown.status)} ${unknown.body.slice(0, 200)}`);
  if (!refusedAsUnknown(unknown.body)) failures.push('an unknown operation was not refused');

  const stranger = await ask(known.replace(/\.json$/u, ''));
  console.log(`no token: ${String(stranger.status)}`);
  if (stranger.status !== 401) failures.push('a request without a token was not refused with 401');
} finally {
  docker('rm', '--force', container);
  jwksServer.close();
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::${failure}`);
  process.exit(1);
}
console.log('router image: safelist present and enforced, authentication required');
