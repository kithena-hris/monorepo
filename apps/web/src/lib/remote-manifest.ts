import { cache } from 'react';
import { z } from 'zod';

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
 * the schema library came with it, the largest chunk the shell sent.
 */

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
/**
 * A place the remote offers to navigate to: a section of the area, or an
 * action such as adding somebody. `for` lists the roles any one of which
 * opens it; without it, everybody. The host draws its own navigation from
 * these — the remote says what exists, the host decides what the chrome looks
 * like — and the remote refuses a screen to whoever may not use it whatever
 * any navigation shows.
 *
 * `owns` lists the other routes, as the manifest writes them (`/people/:id`),
 * that belong to a section: on those it is the current one too. The remote
 * says which screens are under which place; the host never guesses from a URL.
 *
 * `tabs` makes a section an umbrella page: its tools, in order, each a route
 * of its own and each a `Place` with its own `for` and `owns`. The section's
 * `path` is its first tab's.
 */
const Tab = z.object({
  path: z.string().startsWith('/'),
  label: z.string().min(1),
  /** A shorter label, for a tab as a pill under a finger: "Access" for "Access requests". */
  short: z.string().min(1).optional(),
  /** One sentence on what the place is for, under its label in a menu or on a card. */
  description: z.string().min(1).optional(),
  /** A Reach icon name (`icons`), drawn beside the label where there is room. */
  icon: z.string().min(1).optional(),
  group: z.string().min(1).optional(),
  for: z.array(z.string().min(1)).optional(),
  owns: z.array(z.string().startsWith('/')).optional(),
  /** An action's pages: offered only there. Absent, everywhere in the area. */
  on: z.array(z.string().startsWith('/')).optional(),
  /**
   * Its label for a viewer with one of these roles, the first that matches:
   * "Waiting for me" for whoever decides, "Your requests" for finance,
   * "Waiting" (`label`) for the rest.
   */
  labelFor: z.record(z.string(), z.string().min(1)).optional(),
});
const Place = Tab.extend({
  /** A shorter line than `description`, under the label on a phone's row. */
  summary: z.string().min(1).optional(),
  tabs: z.array(Tab).min(1).optional(),
});
export type Place = z.infer<typeof Place>;

const RouteManifest = z.object({
  routes: z.array(z.object({ path: z.string().startsWith('/'), component: z.string().min(1) })),
  sections: z.array(Place).default([]),
  actions: z.array(Place).default([]),
  /**
   * The module's settings, drawn by the host's Settings page rather than among
   * the module's sections: changing how a module works is somewhere you go,
   * not somewhere you work.
   */
  settings: z.array(Place).default([]),
  /**
   * What the remote draws in the shell's own chrome, on every page of a
   * company that has the area: by the place's name, the export that fills
   * it. The shell names the places (`topBar`, beside search and the bell)
   * and fetches each one's data; the remote says what goes there. Time
   * Off's clock is `{ "topBar": "TopBarClock" }`. A name this shell does
   * not know is left alone, so a remote can offer a place before the shell
   * draws it.
   */
  slots: z.record(z.string(), z.string().min(1)).default({}),
});

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
