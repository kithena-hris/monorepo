/*
 * The remotes, their places and how a path maps to one, as the browser and
 * the server both need them. Reading a remote's manifest is the server's
 * alone, in `remote-manifest.ts`, with the schema it is checked against.
 */
import type { Place } from './remote-manifest';

export type { Place } from './remote-manifest';

/**
 * The places in the shell's chrome a remote may fill: `topBar`, beside search
 * and the bell, and `home`, the app's front page, which People draws (its
 * overview folded into Home).
 */
export type SlotName = 'topBar' | 'home';

/**
 * The sections and actions this viewer's roles open, in the manifest's order.
 *
 * An umbrella section keeps only the tabs the viewer opens, and links to the
 * first of them, each named for the viewer: finance's Review opens on its requests. One
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
  const named = <T extends Pick<Place, 'labelFor' | 'label'>>(p: T): T => {
    const label = Object.entries(p.labelFor ?? {}).find(([role]) => roles[role] === true)?.[1];
    return label === undefined ? p : { ...p, label };
  };
  return {
    sections: nav.sections.filter(opens).flatMap((section): Place[] => {
      if (section.tabs === undefined) return [named(section)];
      const tabs = section.tabs.filter(opens).map(named);
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
 * of their places: `/people/review` to the first tab of Review they
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
 * is under, for the breadcrumb, with its
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
    // Every People page opens as "People › section", its siblings a click away.
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
