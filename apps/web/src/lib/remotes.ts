import { cache } from 'react';
import { z } from 'zod';

import { timed } from './timing';

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
});
const Place = Tab.extend({
  /** A shorter line than `description`, under the label on a phone's row. */
  summary: z.string().min(1).optional(),
  /**
   * Its label for a viewer with one of these roles, the first that matches:
   * "Requests" for whoever decides them, "My requests" (`label`) for the rest.
   */
  labelFor: z.record(z.string(), z.string().min(1)).optional(),
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
/** The places in the shell's chrome a remote may fill. */
export type SlotName = 'topBar';

/**
 * The sections and actions this viewer's roles open, in the manifest's order.
 *
 * An umbrella section keeps only the tabs the viewer opens, and links to the
 * first of them: a finance viewer's Data health is its access requests. One
 * whose tabs they open none of is not theirs at all.
 */
export function placesFor(
  nav: {
    readonly sections: readonly Place[];
    readonly actions: readonly Place[];
    readonly settings?: readonly Place[];
  },
  roles: Readonly<Record<string, boolean>>,
): {
  readonly sections: readonly Place[];
  readonly actions: readonly Place[];
  readonly settings: readonly Place[];
} {
  const opens = (p: Pick<Place, 'for'>): boolean =>
    p.for === undefined || p.for.some((r) => roles[r] === true);
  const named = (p: Place): Place => {
    const label = Object.entries(p.labelFor ?? {}).find(([role]) => roles[role] === true)?.[1];
    return label === undefined ? p : { ...p, label };
  };
  return {
    sections: nav.sections.filter(opens).flatMap((section): Place[] => {
      if (section.tabs === undefined) return [named(section)];
      const tabs = section.tabs.filter(opens);
      const first = tabs[0];
      return first === undefined ? [] : [{ ...named(section), path: first.path, tabs }];
    }),
    actions: nav.actions.filter(opens),
    settings: (nav.settings ?? []).filter(opens),
  };
}

/** Whether `route` is this place's own, or one it owns. */
function claims(place: Pick<Place, 'path' | 'owns'>, route: string | null): boolean {
  return place.path === route || place.owns?.includes(route ?? '') === true;
}

/**
 * The place this screen is under: the one at its route, the one whose `owns`
 * lists it, or the umbrella whose tab it is (or whose tab owns it). The
 * manifest decides, so a profile is the Directory's because People says so,
 * not because of what its URL looks like.
 */
export function currentPlace(places: readonly Place[], route: string | null): Place | undefined {
  return places.find((p) => claims(p, route) || p.tabs?.some((t) => claims(t, route)) === true);
}

/** The tab of `section` this screen is: the one at its route, or the one that owns it. */
export function currentTab(section: Place | undefined, route: string | null): Place | undefined {
  return section?.tabs?.find((t) => claims(t, route));
}

/**
 * Where a path no route answers sends this viewer, when it is the bare start
 * of their places: `/people/data-health` to the first tab of Data health they
 * open, `/people/directory` to its first view. Only places the viewer opens
 * count (`placesFor`), in order; anything else is `undefined`, and a 404.
 */
export function firstUnder(sections: readonly Place[], path: string): string | undefined {
  const prefix = `${path.replace(/\/+$/, '')}/`;
  return sections
    .flatMap((s) => [s.path, ...(s.tabs ?? []).map((t) => t.path)])
    .find((p) => p.startsWith(prefix) && !p.includes('/:'));
}

/** Counts that need action: by section path, and by tab path. */
export interface PlaceCounts {
  readonly sections?: Readonly<Record<string, number>>;
  readonly tabs?: Readonly<Record<string, number>>;
}

/** What the host puts in a screen's header (`frame.tsx`'s `Frame`), as JSON. */
export interface HeaderFrame {
  readonly section: string | null;
  readonly actions: readonly {
    readonly href: string;
    readonly label: string;
    readonly icon?: string;
  }[];
  readonly siblings: readonly Siblings[];
  readonly siblingsLabel: string;
  /** The umbrella page's tabs this viewer opens, in order; absent where there are none. */
  readonly tabs?: readonly {
    readonly href: string;
    readonly label: string;
    readonly short?: string;
    readonly current: boolean;
    readonly count?: number;
  }[];
}

/**
 * What a screen's own header shows of the host's navigation: the section it
 * is under, for the breadcrumb (the front page too, as Overview), with its
 * siblings (their icons and counts) and, on an umbrella page, its tabs; and
 * the actions this viewer may start. An action is left off its own screen,
 * whose form is then the only copy of it. `_home` is the area's own path,
 * kept for callers that name it.
 */
export function headerFrame(
  places: { readonly sections: readonly Place[]; readonly actions: readonly Place[] },
  route: string | null,
  _home: string,
  counts: PlaceCounts = {},
  /** The area's name, for what a screen reader calls the sections: "Time off sections". */
  area = 'People',
): HeaderFrame {
  const section = currentPlace(places.sections, route);
  const here = section ?? currentPlace(places.actions, route);
  const tab = currentTab(section, route);
  return {
    // People's front page is a section like the rest: "People › Overview", with
    // its siblings a click away, as every other People screen opens.
    section: here === undefined ? null : here.label,
    siblings: siblingsOf(places.sections, here, counts.sections),
    siblingsLabel: `${area} sections`,
    ...(section?.tabs === undefined
      ? {}
      : {
          tabs: section.tabs.map((t) => {
            const n = counts.tabs?.[t.path];
            return {
              href: t.path,
              label: t.label,
              ...(t.short === undefined ? {} : { short: t.short }),
              current: t === tab,
              ...(n === undefined ? {} : { count: n }),
            };
          }),
        }),
    actions: places.actions
      .filter((a) => currentPlace([a], route) === undefined)
      .filter((a) => a.on === undefined || (route !== null && a.on.includes(route)))
      .map((a) => ({
        href: a.path,
        label: a.label,
        ...(a.icon === undefined ? {} : { icon: a.icon }),
      })),
  };
}

/** A group of places, for the breadcrumb's menu, the current one marked. */
export interface Siblings {
  readonly label: string;
  readonly items: readonly {
    readonly href: string;
    readonly label: string;
    readonly current: boolean;
    /** A Reach icon name. */
    readonly icon?: string;
    /** What needs action there. */
    readonly count?: number;
  }[];
}

/** Places by their manifest group ("People" when none), in order, marking `here`. */
export function siblingsOf(
  places: readonly Place[],
  here: Place | undefined,
  counts: Readonly<Record<string, number>> = {},
): Siblings[] {
  const groups = new Map<string, Siblings['items'][number][]>();
  for (const p of places) {
    const group = p.group ?? 'People';
    const n = counts[p.path];
    groups.set(group, [
      ...(groups.get(group) ?? []),
      {
        href: p.path,
        label: p.label,
        current: p === here,
        ...(p.icon === undefined ? {} : { icon: p.icon }),
        ...(n === undefined ? {} : { count: n }),
      },
    ]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

export interface RemoteRoute {
  /** The remote's `remoteEntry.js`, loaded by the browser: on this host, under `remotePath`. */
  readonly entry: string;
  /** Where the remote is deployed, which the server reads its manifest and server build from. */
  readonly base: string;
  /** Whose remote it is. */
  readonly area: Area;
  /** The export of the remote's `index.ts` that renders this path. */
  readonly component: string;
  /** The manifest route that matched, as written there: `/people/:id`. */
  readonly path: string;
  /** `:name` segments of the manifest path, as matched: `/people/:id` → `{ id }`. */
  readonly params: Readonly<Record<string, string>>;
  /** Every section, action and setting the manifest lists, for the host's navigation. */
  readonly nav: {
    readonly sections: readonly Place[];
    readonly actions: readonly Place[];
    readonly settings: readonly Place[];
  };
  /** Every path the manifest lists, as written there. */
  readonly routes: readonly string[];
  /** Which export renders each of those paths: whether two addresses are one screen. */
  readonly screens: Readonly<Record<string, string>>;
}

export interface Matched {
  readonly component: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly nav: RemoteRoute['nav'];
  /** Every path the manifest lists, as written there. */
  readonly routes: readonly string[];
  readonly screens: RemoteRoute['screens'];
}

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
 * `matchRoute`'s rule on the paths alone: the one that answers `path`, a
 * literal before a pattern, with its parameters. The shell's sidebar uses it
 * in the browser to know which of People's routes the address is, so the
 * shell can be drawn once rather than by each page.
 */
export function matchPath(
  paths: readonly string[],
  path: string,
): { readonly path: string; readonly params: Readonly<Record<string, string>> } | undefined {
  if (paths.includes(path)) return { path, params: {} };
  const segments = path.split('/');
  for (const candidate of paths) {
    const pattern = candidate.split('/');
    if (pattern.length !== segments.length || !candidate.includes('/:')) continue;
    const params: Record<string, string> = {};
    const fits = pattern.every((part, i) => {
      const actual = segments[i] ?? '';
      if (!part.startsWith(':')) return part === actual;
      // A field key is snake case (`first_day`); still one plain segment.
      if (!/^[\w-]{1,64}$/u.test(actual)) return false;
      params[part.slice(1)] = actual;
      return true;
    });
    if (fits) return { path: candidate, params };
  }
  return undefined;
}

/**
 * The remotes the shell loads, each an area of the app: the paths it owns, its
 * settings under Settings, the entitlement that opens it, and the prefix of its
 * runtime configuration — `<env>_REMOTE_URL`, `<env>_REMOTE_SSR_PUBLIC_KEY`
 * and `<env>_REMOTE_SSR=off`. A second remote is an entry here and its
 * configuration; nothing else in the plumbing names one.
 *
 * `name` is the federation name the remote is built with, and names its
 * server build (`ssr/<name>.cjs`). `dev` is where it runs locally when its URL
 * is unset.
 */
export const AREAS = {
  people: {
    name: 'people',
    label: 'People',
    home: '/people',
    settings: '/settings/people',
    entitlement: 'module.people',
    env: 'PEOPLE',
    dev: 'http://localhost:3002',
  },
  timeoff: {
    name: 'timeoff',
    label: 'Time off',
    home: '/time-off',
    settings: '/settings/time-off',
    entitlement: 'module.timeoff',
    env: 'TIMEOFF',
    dev: 'http://localhost:3003',
  },
} as const;
export type Area = (typeof AREAS)[keyof typeof AREAS];

const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/** The area whose remote answers `path`, among its screens or its settings. */
export const areaOf = (path: string): Area | undefined =>
  Object.values(AREAS).find((a) => under(path, a.home) || under(path, a.settings));

/** Where an area's remote is deployed: what the server fetches, and what `remotePath` forwards to. */
export function remoteBase(area: Area): string {
  const url = process.env[`${area.env}_REMOTE_URL`];
  return (url === undefined || url === '' ? area.dev : url).replace(/\/$/, '');
}

/**
 * Where the browser loads an area's remote from: a path on the company's own
 * host, which `proxy.ts` forwards to `remoteBase()`.
 *
 * Same-origin, so CORS never applies. Every company is a subdomain of one
 * site, so a browser shares one cache entry per remote file across all of
 * them. Served cross-origin, that entry held the first company's
 * `Access-Control-Allow-Origin`, and the 304 that revalidated it carried none,
 * so the next company's import of `remoteEntry.js` was refused ("People is
 * unavailable"). Under each company's own host, each has its own entry and
 * nothing to check. The remote builds with `base: './'`, so its chunks and
 * stylesheet follow `remoteEntry.js` here. `_` because a Next folder starting
 * with one is never a route.
 */
export const remotePath = (area: Area): string => `/_${area.name}`;

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
    slots: slots['topBar'] === undefined ? {} : { topBar: slots['topBar'] },
  };
}
