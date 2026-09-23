import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';

import { renderRemote, warmRenderer } from './remote-render';

/*
 * A remote's server build, fetched, checked and handed to the renderer
 * (PEO-094, PEO-115).
 *
 * **What is checked.** The remote's deploy pipeline signs a manifest of the
 * build's SHA-384 hashes, SRI-style, with a key only that pipeline holds
 * (`apps/web/people/scripts/sign-ssr.mjs`). The shell pins the matching
 * public key in its own configuration, `PEOPLE_REMOTE_SSR_PUBLIC_KEY`, and
 * renders only a build whose bytes match a manifest that key signed. The
 * remote's host serves the three files and is trusted for none of them: it
 * can withhold a build, never substitute one. A redeploy of the remote signs
 * its own new manifest, so it still ships alone — the shell's configuration
 * changes only when the key does.
 *
 * **What it is rendered by.** Not this process: `remote-render.ts`.
 *
 * Every failure — no key, the remote down, a bad signature, a hash that does
 * not match — leaves `prepareRemoteSsr` returning `undefined` and the screen
 * rendered in the browser, as it was before PEO-094.
 */

const Sri = z.string().regex(/^sha384-[A-Za-z0-9+/]{64}$/);
const Manifest = z.object({
  files: z.object({ 'people.cjs': Sri, 'people.css': Sri }),
});

export type Verdict =
  | { readonly ok: true; readonly sha: string; readonly stylesheet: string }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly expected?: string;
      readonly actual?: string;
    };

export const sri = (bytes: string | Uint8Array): string =>
  `sha384-${createHash('sha384').update(bytes).digest('base64')}`;

/** Whether `code` is the build `manifest` names, and `manifest` is one `key` signed. */
export function verifyBuild(
  key: KeyObject,
  manifest: string,
  signature: string,
  code: string,
): Verdict {
  const actual = sri(code);
  let signed = false;
  try {
    signed = verify(null, Buffer.from(manifest), key, Buffer.from(signature.trim(), 'base64'));
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: 'the manifest is not signed by the pinned key', actual };
  let parsed: z.infer<typeof Manifest>;
  try {
    parsed = Manifest.parse(JSON.parse(manifest));
  } catch {
    return { ok: false, reason: 'the signed manifest is not one the shell reads', actual };
  }
  const expected = parsed.files['people.cjs'];
  if (actual !== expected) {
    return { ok: false, reason: 'the server build does not match its manifest', expected, actual };
  }
  return { ok: true, sha: actual, stylesheet: parsed.files['people.css'] };
}

/** The pinned key, or `undefined` when none is configured or it does not parse. */
export function pinnedKey(value: string | undefined): KeyObject | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  try {
    const key = createPublicKey({ key: Buffer.from(value, 'base64'), format: 'der', type: 'spki' });
    return key.asymmetricKeyType === 'ed25519' ? key : undefined;
  } catch {
    return undefined;
  }
}

const told = new Set<string>();

/** Once per distinct refusal: the hashes, never the code. */
function refuse(verdict: Extract<Verdict, { ok: false }>, url: string): void {
  const key = `${verdict.reason} ${verdict.actual ?? ''}`;
  if (!told.has(key)) {
    told.add(key);
    console.warn(
      JSON.stringify({
        level: 'warn',
        msg: 'remote server build refused; rendering in the browser',
        build: url,
        reason: verdict.reason,
        ...(verdict.expected === undefined ? {} : { expected: verdict.expected }),
        ...(verdict.actual === undefined ? {} : { actual: verdict.actual }),
      }),
    );
  }
}

async function text(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

/** Verified builds by URL, as the render below finds them. */
const verified = new Map<string, { readonly code: string; readonly sha: string }>();

/*
 * How the screen reaches the renderer. `remote-screen.tsx` renders under the
 * React that server-renders client components, a different module graph from
 * this server component's, so the two meet on `globalThis` in the one Node
 * process. Only a URL this file verified renders.
 */
export const REMOTE_RENDER = Symbol.for('kithena.remote-render');
(globalThis as unknown as Record<symbol, unknown>)[REMOTE_RENDER] = (
  url: string,
  component: string,
  props: string,
  prefix: string,
): Promise<string> => {
  const build = verified.get(url);
  if (build === undefined) return Promise.reject(new Error(`${url} was not verified`));
  return renderRemote(build.code, build.sha, component, props, prefix);
};

export interface PreparedSsr {
  /** The server build's address, as the screen asks the renderer for it. */
  readonly ssr: string;
  /** Its stylesheet and the hash the browser holds it to. */
  readonly stylesheet: { readonly href: string; readonly integrity: string };
}

/**
 * Fetch the remote's server build and its signed manifest, and keep the build
 * for rendering if and only if it verifies. Fetched before the page renders,
 * so the render never waits on the network.
 */
export async function prepareRemoteSsr(base: string): Promise<PreparedSsr | undefined> {
  const url = `${base}/ssr/people.cjs`;
  const key = pinnedKey(process.env['PEOPLE_REMOTE_SSR_PUBLIC_KEY']);
  if (key === undefined) {
    refuse({ ok: false, reason: 'PEOPLE_REMOTE_SSR_PUBLIC_KEY is not an Ed25519 key' }, url);
    return undefined;
  }
  const [code, manifest, signature] = await Promise.all([
    text(url),
    text(`${base}/ssr/manifest.json`),
    text(`${base}/ssr/manifest.json.sig`),
  ]);
  // Down, slow or not deployed with a server build: nothing to say.
  if (code === undefined || manifest === undefined || signature === undefined) return undefined;
  const verdict = verifyBuild(key, manifest, signature, code);
  if (!verdict.ok) {
    refuse(verdict, url);
    return undefined;
  }
  verified.set(url, { code, sha: verdict.sha });
  warmRenderer(code, verdict.sha);
  return {
    ssr: url,
    stylesheet: { href: `${base}/ssr/people.css`, integrity: verdict.stylesheet },
  };
}
