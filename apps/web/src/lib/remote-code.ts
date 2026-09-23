import 'server-only';

/**
 * The remote's server build, fetched before the page renders (PEO-094).
 *
 * `remote-screen.tsx` evaluates it with the React that server-renders client
 * components, which is not the one this server component has, so this file
 * only fetches the text and leaves it where that one looks: a map on
 * `globalThis`, shared by both in the one Node process. Having the code before
 * the render starts means the server never waits on the network mid-render.
 *
 * A miss — the remote down, slow or not deployed with a server build — costs
 * nothing: the screen renders in the browser as it did before.
 */
export const REMOTE_CODE = Symbol.for('kithena.remote-code');

type Store = Map<string, string>;

export function remoteCode(): Store {
  const holder = globalThis as unknown as Record<symbol, Store | undefined>;
  holder[REMOTE_CODE] ??= new Map();
  return holder[REMOTE_CODE];
}

export async function preloadRemoteCode(url: string): Promise<void> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2000) });
    if (response.ok) remoteCode().set(url, await response.text());
  } catch {
    // The browser renders it instead.
  }
}
