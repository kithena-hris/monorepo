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

export const RouteManifest = z.object({
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
