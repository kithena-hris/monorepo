import { z } from 'zod';

/**
 * Which remote screen answers a path, read from the remote at request time.
 *
 * Not baked into the shell's bundle: each remote publishes its own
 * `routes.json` beside its `remoteEntry.js`, and the shell reads it per
 * request. A remote adding or renaming a screen is then a remote deploy and
 * nothing else — the shell only knows which prefix belongs to which remote and
 * where that remote lives. `docs/build-plan.md`, "The route manifest".
 *
 * The address is runtime configuration for the same reason. A `NEXT_PUBLIC_`
 * variable would be inlined at build time, and moving the remote would mean
 * rebuilding the shell.
 */
const RouteManifest = z.object({
  routes: z.array(z.object({ path: z.string().startsWith('/'), component: z.string().min(1) })),
});

export interface RemoteRoute {
  /** The remote's `remoteEntry.js`, loaded by the browser. */
  readonly entry: string;
  /** The export of the remote's `index.ts` that renders this path. */
  readonly component: string;
}

/** `undefined` when the manifest has no such path; `null` when it is unreadable. */
export function matchRoute(manifest: unknown, path: string): string | null | undefined {
  const parsed = RouteManifest.safeParse(manifest);
  if (!parsed.success) return null;
  return parsed.data.routes.find((route) => route.path === path)?.component;
}

/**
 * The People remote's screen for `path`.
 *
 * `null` when the remote cannot be reached or answers with something that is
 * not a manifest: the shell still renders, and says the area is unavailable,
 * rather than failing the whole page because one module is down.
 */
export async function peopleRoute(path: string): Promise<RemoteRoute | null | undefined> {
  const base = (process.env['PEOPLE_REMOTE_URL'] ?? 'http://localhost:3002').replace(/\/$/, '');
  let manifest: unknown;
  try {
    const response = await fetch(`${base}/routes.json`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return null;
    manifest = await response.json();
  } catch {
    return null;
  }
  const component = matchRoute(manifest, path);
  return component == null ? component : { entry: `${base}/remoteEntry.js`, component };
}
