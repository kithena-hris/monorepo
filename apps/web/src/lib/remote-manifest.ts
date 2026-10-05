import { cache } from 'react';

import { RouteManifest } from './manifest-schema';
import {
  areaOf,
  matchPath,
  remoteBase,
  remotePath,
  type Area,
  type Matched,
  type RemoteRoute,
  type SlotName,
} from './remotes';
import { timed } from './timing';

/*
 * The server's half of `remotes.ts`: reading and checking a remote's
 * `routes.json`. Kept apart because the check is Zod, and the browser half
 * (`remotes.ts`) is in the shell's chrome on every page: imported from there,
 * the schema library came with it, the largest chunk the shell sent. The
 * schema itself is `manifest-schema.ts`.
 */

/**
 * Which listed path answers this one.
 *
 * A literal path wins over a pattern, whatever order the manifest lists them
 * in, so `/people/directory` is never read as a person called `directory`. A
 * parameter matches one segment of letters, digits and dashes and nothing
 * else: it becomes part of a request to People, and a segment holding `..` or
 * a slash has no business reaching one.
 *
 * `undefined` when the manifest has no such path; `null` when it is unreadable.
 */
export function matchRoute(manifest: unknown, path: string): Matched | null | undefined {
  const parsed = RouteManifest.safeParse(manifest);
  if (!parsed.success) return null;
  const { routes, sections, actions, settings } = parsed.data;
  const paths = routes.map((route) => route.path);
  const matched = matchPath(paths, path);
  const component = routes.find((route) => route.path === matched?.path)?.component;
  if (matched === undefined || component === undefined) return undefined;
  const screens = Object.fromEntries(routes.map((route) => [route.path, route.component]));
  return { component, ...matched, nav: { sections, actions, settings }, routes: paths, screens };
}

/**
 * The screen for `path`, from the manifest of the remote whose area it is.
 *
 * `null` when that remote is not configured, cannot be reached or answers
 * with something that is not a manifest: the shell still renders, and says
 * the area is unavailable, rather than failing the whole page because one
 * module is down. `undefined` when no screen answers the path.
 */
export async function remoteRoute(path: string): Promise<RemoteRoute | null | undefined> {
  const area = areaOf(path);
  if (area === undefined) return undefined;
  const base = remoteBase(area);
  const manifest = await manifestOf(base);
  if (manifest === undefined) return null;
  const matched = matchRoute(manifest, path);
  return matched == null
    ? matched
    : { entry: `${remotePath(area)}/remoteEntry.js`, base, area, ...matched };
}

/**
 * A remote's `routes.json`, unparsed, once per request: the screen and the
 * shell around it both ask which routes there are, and each asking was a
 * fetch. Never across requests, so a remote deploy is the next page's
 * manifest. `undefined` when it cannot be read.
 */
const manifestOf = cache(async (base: string): Promise<unknown> => {
  try {
    const response = await timed(
      'remote.routes',
      fetch(`${base}/routes.json`, { cache: 'no-store', signal: AbortSignal.timeout(2000) }),
    );
    return response.ok ? ((await response.json()) as unknown) : undefined;
  } catch {
    return undefined;
  }
});

/**
 * Everything an area's manifest offers, for the host's navigation: its
 * places and every route it lists, whichever path is asked for. `null` when
 * the remote is not configured, cannot be reached or is not a manifest.
 */
export async function remoteNav(area: Area): Promise<{
  readonly nav: RemoteRoute['nav'];
  readonly routes: readonly string[];
  readonly screens: RemoteRoute['screens'];
  /** The shell's places the remote fills, and with which export. */
  readonly slots: Readonly<Partial<Record<SlotName, string>>>;
} | null> {
  const parsed = RouteManifest.safeParse(await manifestOf(remoteBase(area)));
  if (!parsed.success) return null;
  const { routes, sections, actions, settings, slots } = parsed.data;
  return {
    nav: { sections, actions, settings },
    routes: routes.map((r) => r.path),
    screens: Object.fromEntries(routes.map((r) => [r.path, r.component])),
    slots: Object.fromEntries(
      (['topBar', 'home'] as const).flatMap((name) => {
        const component = slots[name];
        return component === undefined ? [] : [[name, component]];
      }),
    ),
  };
}
