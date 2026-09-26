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
 */
const Place = z.object({
  path: z.string().startsWith('/'),
  label: z.string().min(1),
  group: z.string().min(1).optional(),
  for: z.array(z.string().min(1)).optional(),
  owns: z.array(z.string().startsWith('/')).optional(),
});
export type Place = z.infer<typeof Place>;

const RouteManifest = z.object({
  routes: z.array(z.object({ path: z.string().startsWith('/'), component: z.string().min(1) })),
  sections: z.array(Place).default([]),
  actions: z.array(Place).default([]),
});

/** The sections and actions this viewer's roles open, in the manifest's order. */
export function placesFor(
  nav: { readonly sections: readonly Place[]; readonly actions: readonly Place[] },
  roles: Readonly<Record<string, boolean>>,
): { readonly sections: readonly Place[]; readonly actions: readonly Place[] } {
  const opens = (p: Place): boolean => p.for === undefined || p.for.some((r) => roles[r] === true);
  return { sections: nav.sections.filter(opens), actions: nav.actions.filter(opens) };
}

export interface RemoteRoute {
  /** The remote's `remoteEntry.js`, loaded by the browser. */
  readonly entry: string;
  /** Where the remote is served from, for its stylesheet and chunks. */
  readonly base: string;
  /** The export of the remote's `index.ts` that renders this path. */
  readonly component: string;
  /** The manifest route that matched, as written there: `/people/:id`. */
  readonly path: string;
  /** `:name` segments of the manifest path, as matched: `/people/:id` → `{ id }`. */
  readonly params: Readonly<Record<string, string>>;
  /** Every section and action the manifest lists, for the host's navigation. */
  readonly nav: { readonly sections: readonly Place[]; readonly actions: readonly Place[] };
}

export interface Matched {
  readonly component: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly nav: RemoteRoute['nav'];
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
  const { routes, sections, actions } = parsed.data;
  const nav = { sections, actions };
  const literal = routes.find((route) => route.path === path);
  if (literal !== undefined) {
    return { component: literal.component, path: literal.path, params: {}, nav };
  }

  const segments = path.split('/');
  for (const route of routes) {
    const pattern = route.path.split('/');
    if (pattern.length !== segments.length || !route.path.includes('/:')) continue;
    const params: Record<string, string> = {};
    const fits = pattern.every((part, i) => {
      const actual = segments[i] ?? '';
      if (!part.startsWith(':')) return part === actual;
      if (!/^[A-Za-z0-9-]{1,64}$/.test(actual)) return false;
      params[part.slice(1)] = actual;
      return true;
    });
    if (fits) return { component: route.component, path: route.path, params, nav };
  }
  return undefined;
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
  const matched = matchRoute(manifest, path);
  return matched == null ? matched : { entry: `${base}/remoteEntry.js`, base, ...matched };
}
