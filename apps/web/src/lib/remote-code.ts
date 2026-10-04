import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';

import { renderRemote, warmRenderer } from './remote-render';
import { AREAS, remotePath, type Area } from './remotes';
import { timed } from './timing';

/*
 * A remote's server build, fetched, checked and handed to the renderer
 * (PEO-094, PEO-115).
 *
 * **What is checked.** The remote's deploy pipeline signs a manifest of the
 * build's SHA-384 hashes, SRI-style, with a key only that pipeline holds
 * (`apps/web/people/scripts/sign-ssr.mjs`). The shell pins the matching
 * public key in its own configuration, one per remote
 * (`PEOPLE_REMOTE_SSR_PUBLIC_KEY`, `TIMEOFF_REMOTE_SSR_PUBLIC_KEY`), and
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
 * rendered in the browser, as it was before PEO-094. So does
 * `<env>_REMOTE_SSR=off`, the switch.
 */

const Sri = z.string().regex(/^sha384-[A-Za-z0-9+/]{64}$/);
/** The signed manifest of the remote named `name`: its `<name>.cjs` and `<name>.css`. */
const manifestOf = (name: string) =>
  z.object({ files: z.object({ [`${name}.cjs`]: Sri, [`${name}.css`]: Sri }) });

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
  name: string = AREAS.people.name,
): Verdict {
  const actual = sri(code);
  let signed = false;
  try {
    signed = verify(null, Buffer.from(manifest), key, Buffer.from(signature.trim(), 'base64'));
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: 'the manifest is not signed by the pinned key', actual };
  let files: Record<string, string>;
  try {
    files = manifestOf(name).parse(JSON.parse(manifest)).files;
  } catch {
    return { ok: false, reason: 'the signed manifest is not one the shell reads', actual };
  }
  // Both are there: the parse above requires them.
  const expected = files[`${name}.cjs`] ?? '';
  const stylesheet = files[`${name}.css`] ?? '';
  if (actual !== expected) {
    return { ok: false, reason: 'the server build does not match its manifest', expected, actual };
  }
  return { ok: true, sha: actual, stylesheet };
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
  return timed('remote.render', renderRemote(build.code, build.sha, component, props, prefix));
};

/**
 * The build last verified at each URL, with the signed manifest, signature
 * and pinned key it was verified against: reused while all three are the
 * same. In-process, one entry per remote; a new manifest replaces it.
 */
const checked = new Map<
  string,
  {
    readonly manifest: string;
    readonly signature: string;
    readonly pinned: string;
    readonly code: string;
    readonly sha: string;
    readonly stylesheet: string;
  }
>();

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
export async function prepareRemoteSsr(
  base: string,
  area: Area = AREAS.people,
): Promise<PreparedSsr | undefined> {
  if (process.env[`${area.env}_REMOTE_SSR`] === 'off') return undefined;
  const { name } = area;
  const url = `${base}/ssr/${name}.cjs`;
  const pin = `${area.env}_REMOTE_SSR_PUBLIC_KEY`;
  const key = pinnedKey(process.env[pin]);
  if (key === undefined) {
    refuse({ ok: false, reason: `${pin} is not an Ed25519 key` }, url);
    return undefined;
  }
  /*
   * The signed manifest is asked for on every page, so a deploy is the next
   * page's build. The build itself — half a megabyte, hashed — only when that
   * manifest is not the one the build last verified here was checked against
   * (`checked`): the same signed manifest names the same bytes. With nothing
   * kept yet, it is fetched beside the manifest, as it always was.
   */
  const kept = checked.get(url);
  const early = kept === undefined ? text(url) : undefined;
  const [manifest, signature] = await timed(
    'remote.ssr',
    Promise.all([text(`${base}/ssr/manifest.json`), text(`${base}/ssr/manifest.json.sig`)]),
  );
  // Down, slow or not deployed with a server build: nothing to say.
  if (manifest === undefined || signature === undefined) return undefined;
  const pinned = process.env[pin] ?? '';
  let build = kept;
  if (build?.manifest !== manifest || build.signature !== signature || build.pinned !== pinned) {
    const code = await (early ?? timed('remote.ssr.build', text(url)));
    if (code === undefined) return undefined;
    const verdict = verifyBuild(key, manifest, signature, code, name);
    if (!verdict.ok) {
      refuse(verdict, url);
      return undefined;
    }
    build = { manifest, signature, pinned, code, sha: verdict.sha, stylesheet: verdict.stylesheet };
    checked.set(url, build);
  }
  verified.set(url, { code: build.code, sha: build.sha });
  // The remote's own renderer, under the id prefix its screens render with.
  warmRenderer(build.code, build.sha, `${name}-`);
  return {
    ssr: url,
    // For the browser, on the company's own host like the rest of the remote.
    stylesheet: { href: `${remotePath(area)}/ssr/${name}.css`, integrity: build.stylesheet },
  };
}

