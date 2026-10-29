'use client';

import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  filterCommands,
  KbdShortcut,
  PageLayout,
  TabBar,
  TabBarItem,
  TooltipProvider,
  icons,
  runScreenCommand,
  setShortcutKeys,
  useScreenCommands,
  type CommandItem,
} from '@reach/ui';
import type { Route } from 'next';
import { Link } from '../lib/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  lazy,
  Suspense,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import { searchPeople } from '../app/(app)/people/actions';
import { saveLanguage } from '../app/(app)/settings/language/actions';
import { saveShortcuts } from '../app/(app)/settings/shortcuts/actions';
import { switchLanguage, useLanguage } from '../lib/i18n';
import { languageCookie, LANGUAGES } from '../lib/languages';
import { EMPTY_SHELL, type ShellData, type ShellSlot } from '../lib/shell-data';
import { prefetchPage, useInAppLinks, useWarmPages } from '../lib/links';
import { warmRemotes } from './remote-screen';
import { AREAS as REMOTES, currentPlace, firstUnder, matchPath, type Place } from '../lib/remotes';
import {
  DEFAULT_PREFS,
  adjacentPage,
  createOn,
  destinationOf,
  effective,
  isCharacterKey,
  type ShortcutPrefs,
} from '../lib/shortcuts';
import { themeCookie } from '../lib/theme';
import { Assistant } from './assistant';
import { InboxCount, InboxToasts, useInboxTodo } from './inbox/bell';
import type { InboxPeek } from '../lib/inbox/peek';
import { countOf, iconOf } from './people-nav';
import {
  SidebarRail,
  useWarmSidebar,
  type Presses,
  type ShellArea,
  type ShellSection,
} from './shell-sidebar';
import { RemoteSlot } from './remote-slot';
import {
  Shortcuts,
  ShortcutsHelp,
  focusList,
  focusPageSearch,
  shortcutHandler,
  submitFocused,
  isApple,
  useHint,
  useShortcuts,
  type ShortcutsValue,
} from './shortcuts';
import { t as tr } from '../lib/t';

/*
 * Reach's icon set, by meaning rather than by drawing.
 *
 * `icons.leave` rather than a calendar: the name says what the item is for, so
 * the day somebody decides time off should not be a calendar, it changes in one
 * place. Importing `lucide-react` here would also put a second copy of the icon
 * library in this app's bundle.
 */
const Home = icons.home;
const Leave = icons.leave;
const People = icons.people;
const Document = icons.document;
const Settings = icons.settings;
const SignOut = icons.signOut;
const ThemeDark = icons.themeDark;

/**
 * The signed-in shell: the rail of areas, the assistant in the bottom corner,
 * and a tab bar where there is no room for a rail.
 *
 * `PageLayout` owns the grid and the one scroll, the window's; the rail stays
 * where it is while the page moves. Each area's sections fly out of its icon
 * on hover, focus or a tap (`shell-sidebar.tsx`), so no column of sections
 * takes the page's width. Where the layout is too narrow for a rail (a 640px
 * container, never the window's) the tab bar takes over: Home, Time off,
 * People, Inbox and Me, the way every app on a phone already works.
 */
export interface AppShellProps {
  readonly person: {
    readonly name: string;
    readonly email: string | null;
    /**
     * A People administrator viewing the app as this person, read-only: who
     * (`by`). No banner — the account area says whose view it is, and "End
     * viewing as …" heads its menu and ⌘K. Null or absent on their own.
     */
    readonly viewing?: { readonly by: string | null } | null;
  };
  readonly companyName: string;
  /** The company's mark, shown above the areas when they have uploaded one. */
  readonly logoUrl?: string | null;
  /**
   * The modules the company bought, from the session (PEO-114). An area
   * belonging to a module not in it is not shown: it is not "coming soon",
   * it is something this company does not have.
   */
  readonly entitlements: readonly string[];
  /** People's places, counts and notices for this person (`shellData`). */
  readonly shell?: ShellData;
  /** This person's keyboard shortcuts, as identity keeps them (`ShortcutPrefs`). */
  readonly shortcuts?: ShortcutPrefs;
  /** What the company's remotes draw in the chrome (`lib/slots.ts`): Time Off's clock. */
  readonly slots?: readonly ShellSlot[];
  /**
   * The Inbox's counts and first rows (`inboxPeek`), still on its way: the
   * bell and the red number fill in when it lands, and nothing waits for it.
   */
  readonly inbox?: Promise<InboxPeek>;
  readonly children: ReactNode;
}

/**
 * What a person can reach today, and what is coming.
 *
 * The dashboard, Time off, People and Documents are built. The rest are listed as
 * disabled rather than hidden, because a sidebar that grows an item per
 * release teaches nobody where anything lives — and each one maps to a module
 * in `ModuleKey`, so this list is the product's shape rather than a guess at
 * one.
 */
const AREAS: readonly {
  readonly label: string;
  readonly icon: JSX.Element;
  readonly href: string;
  readonly built: boolean;
  /** The entitlement that must be held for the area to show; none for home. */
  readonly module?: string;
}[] = [
  {
    get label() {
      return tr('components.app-shell.home', 'Home');
    },
    icon: <Home />,
    href: '/',
    built: true,
  },
  {
    get label() {
      return tr('components.app-shell.inbox', 'Inbox');
    },
    icon: <icons.inbox />,
    href: '/inbox',
    built: true,
  },
  {
    get label() {
      return tr('components.app-shell.time_off', 'Time off');
    },
    icon: <Leave />,
    href: '/time-off',
    built: true,
    module: 'module.timeoff',
  },
  {
    get label() {
      return tr('components.app-shell.people', 'People');
    },
    icon: <People />,
    href: '/people',
    built: true,
    module: 'module.people',
  },
  {
    get label() {
      return tr('components.app-shell.documents', 'Documents');
    },
    icon: <Document />,
    href: '/documents',
    built: true,
    module: 'module.documents',
  },
  {
    get label() {
      return tr('components.app-shell.recruiting', 'Recruiting');
    },
    icon: <icons.work />,
    href: '/recruiting',
    built: true,
    module: 'module.recruiting',
  },
  {
    get label() {
      return tr('components.app-shell.onboarding', 'Onboarding');
    },
    icon: <icons.hire />,
    href: '/onboarding',
    built: true,
    module: 'module.onboarding',
  },
  {
    get label() {
      return tr('components.app-shell.performance', 'Performance');
    },
    icon: <icons.goal />,
    href: '/performance',
    built: true,
    module: 'module.performance',
  },
];

/**
 * The shell's People data and who is signed in, for what is drawn inside the
 * shell before the page it belongs to has arrived: a loading state knows the
 * tabs its page will have, and the account button in its header, from here
 * (`PageLoading`). One value from the server's render on, like every context
 * above the page (`useShortcutsFor` says why).
 */
const ShellContext = createContext<{
  readonly shell: ShellData;
  readonly person: AppShellProps['person'] | null;
  /** Whose account it is: the account menu says so. */
  readonly company?: string;
}>({ shell: EMPTY_SHELL, person: null });

export function useShellData(): ShellData {
  return use(ShellContext).shell;
}

/** The shell's own pages, beside People's routes (`isPage`). */
const HOST_PAGES = new Set([
  '/',
  '/inbox',
  '/inbox/todo',
  '/inbox/updates',
  '/inbox/requests',
  '/inbox/snoozed',
  '/inbox/done',
  '/people/menu',
  '/settings',
  '/settings/activity',
  '/settings/shortcuts',
  '/settings/notifications',
]);

/** The areas this company has: home, and each module it bought. */
function areasFor(entitlements: readonly string[]): typeof AREAS {
  return AREAS.filter((area) => area.module === undefined || entitlements.includes(area.module));
}

/** An area owns its whole subtree; home owns only itself. */
function isCurrent(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** How long a press may wait for its page before it is loaded the ordinary way. */
const PRESS_FALLBACK_MS = 8000;

/**
 * The areas as the sidebar draws them (`shell-sidebar.tsx`): each with where a
 * press goes, its sections and its settings, and which is current, on the
 * address the press is going to (`here`) so the panel turns at once.
 */
function shellAreas({
  areas,
  shell,
  here,
  inbox,
  hint,
  people,
  timeOff,
  foot,
}: {
  readonly areas: typeof AREAS;
  readonly shell: ShellData;
  readonly here: string;
  readonly inbox: JSX.Element;
  readonly hint: (path: string) => JSX.Element | undefined;
  readonly people: boolean;
  readonly timeOff: boolean;
  /** What a module's remote pins in the chrome, by its name: Time Off's clock. */
  readonly foot: (remote: string) => ReactNode;
}): { readonly areas: ShellArea[]; readonly settings: ShellArea } {
  const exact = (path: string): ShellSection['current'] => here === path;
  const placed = (
    places: readonly Place[],
    counts: Readonly<Record<string, number>>,
    at: string | null,
  ): ShellSection[] => {
    const current = currentPlace(places, at);
    return places.map((p) => ({
      path: p.path,
      label: p.label,
      icon: iconOf(p.icon),
      current: p === current,
      ...countOf(counts, p.path),
    }));
  };
  const remoteFor = (href: string) => {
    const area = Object.values(REMOTES).find((r) => r.home === href);
    return area === undefined ? undefined : { area, nav: shell.remotes?.[area.name] };
  };
  const list: ShellArea[] = areas
    .filter((a) => a.built)
    .map((a): ShellArea => {
      const base = {
        key: a.href,
        label: a.label,
        icon: a.icon,
        current: isCurrent(a.href, here),
        shortcut: hint(a.href),
      };
      if (a.href === '/') {
        return {
          ...base,
          href: '/',
          sections: [
            { path: '/', label: a.label, icon: <icons.home aria-hidden />, current: exact('/') },
            ...(people
              ? [
                  {
                    path: '/people/me',
                    label: tr('components.app-shell.your_profile', 'Your profile'),
                    icon: <icons.person aria-hidden />,
                    current: exact('/people/me'),
                  },
                ]
              : []),
            ...(timeOff
              ? [
                  {
                    path: '/time-off/overview',
                    label: tr('components.app-shell.your_time_off', 'Your time off'),
                    icon: <icons.leave aria-hidden />,
                    current: exact('/time-off/overview'),
                  },
                ]
              : []),
          ],
        };
      }
      if (a.href === '/inbox') {
        const views: [string, string, keyof typeof icons][] = [
          ['/inbox', tr('components.app-shell.inbox_all', 'Everything'), 'inbox'],
          ['/inbox/todo', tr('components.app-shell.inbox_needs_you', 'Needs you'), 'flagged'],
          [
            '/inbox/requests',
            tr('components.app-shell.inbox_waiting', 'Waiting on others'),
            'pending',
          ],
          ['/inbox/updates', tr('components.app-shell.inbox_updates', 'Updates'), 'notifications'],
          ['/inbox/snoozed', tr('components.app-shell.inbox_snoozed', 'Snoozed'), 'scheduled'],
          ['/inbox/done', tr('components.app-shell.inbox_done', 'Done'), 'success'],
        ];
        return {
          ...base,
          href: '/inbox',
          badge: inbox,
          sections: views.map(([path, label, icon]) => {
            const Icon = icons[icon];
            return { path, label, icon: <Icon aria-hidden />, current: exact(path) };
          }),
        };
      }
      const isPeople = a.href === '/people';
      const remote = remoteFor(a.href);
      const places = isPeople ? shell.sections : (remote?.nav?.sections ?? []);
      const settings = isPeople ? shell.settings : (remote?.nav?.settings ?? []);
      const at = isCurrent(a.href, here)
        ? (matchPath((isPeople ? shell.routes : remote?.nav?.routes) ?? [], here)?.path ?? null)
        : null;
      const settingsHome = remote?.area.settings;
      return {
        ...base,
        href: firstUnder(places, a.href) ?? a.href,
        sections: placed(places, (isPeople ? shell.counts : remote?.nav?.counts) ?? {}, at),
        settings:
          settings[0] === undefined
            ? undefined
            : {
                path: settings[0].path,
                current: settingsHome !== undefined && isCurrent(settingsHome, here),
              },
        foot: remote === undefined ? null : foot(remote.area.name),
      };
    });
  // Settings is an area of its own, at the rail's foot: its panel lists every module's.
  const modules = list.flatMap((a) =>
    a.settings === undefined
      ? []
      : [{ path: a.settings.path, label: a.label, icon: a.icon, current: a.settings.current }],
  );
  const settings: ShellArea = {
    key: '/settings',
    label: tr('components.app-shell.settings', 'Settings'),
    icon: <icons.settings aria-hidden />,
    href: '/settings',
    current: isCurrent('/settings', here),
    shortcut: hint('/settings'),
    sections: [
      {
        path: '/settings',
        label: tr('components.app-shell.settings_general', 'Company'),
        icon: <icons.company aria-hidden />,
        current: exact('/settings'),
      },
      ...modules,
      {
        path: '/settings/notifications',
        label: tr('components.app-shell.settings_notifications', 'Notifications'),
        icon: <icons.notifications aria-hidden />,
        current: exact('/settings/notifications'),
      },
      {
        path: '/settings/shortcuts',
        label: tr('components.app-shell.keyboard_shortcuts', 'Keyboard shortcuts'),
        icon: <icons.shortcuts aria-hidden />,
        current: exact('/settings/shortcuts'),
      },
      ...(shell.roles.admin
        ? [
            {
              path: '/settings/activity',
              label: tr('components.app-shell.settings_activity', 'Activity log'),
              icon: <icons.history aria-hidden />,
              current: here.startsWith('/settings/activity'),
            },
          ]
        : []),
    ],
  };
  return { areas: list, settings };
}

/** What their access is called, for the line under their name. */
function roleOf(roles: ShellData['roles']): string | null {
  if (roles.admin) return tr('components.app-shell.administrator', 'Administrator');
  if (roles.hr) return 'HR';
  if (roles.finance) return tr('components.app-shell.finance', 'Finance');
  return null;
}

/** Told when the class on `<html>` changes, whoever changed it. */
function onThemeChange(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => {
    observer.disconnect();
  };
}

/**
 * Light or dark, for whatever in this shell offers it.
 *
 * Read from `<html>` rather than from the cookie, because with nothing chosen
 * the inline script in the root layout followed the system preference — and
 * subscribed to it, so the menu at a desk and the sheet on a phone always
 * agree with the page and with each other.
 */
function useTheme(): readonly [boolean, (next: boolean) => void] {
  const dark = useSyncExternalStore(
    onThemeChange,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  );
  return [
    dark,
    (next: boolean) => {
      document.documentElement.classList.toggle('dark', next);
      document.cookie = themeCookie(next);
    },
  ] as const;
}

/**
 * The shortcuts, run: the table with this person's keys, where each go-to
 * key takes this viewer, and the one handler for all of them. `/` focuses the
 * page's search, or opens the palette where a page has none; `[` and `]` step
 * through the tabs or the Directory's views; `?` opens the list.
 */
function useShortcutsFor({
  prefs: saved,
  shell,
  people,
  timeOff,
  route,
  openPalette,
  openHelp,
  viewing,
}: {
  readonly prefs: ShortcutPrefs;
  readonly shell: ShellData;
  readonly people: boolean;
  readonly timeOff: boolean;
  readonly route: string | null;
  readonly openPalette: () => void;
  readonly openHelp: () => void;
  /** Viewing as somebody: `V` ends it. */
  readonly viewing: boolean;
}): ShortcutsValue {
  const router = useRouter();
  const pathname = usePathname();
  const commands = useScreenCommands();
  // A push arrived (`public/push-sw.js`): the bell and the Inbox catch up now, not on the next visit.
  // Registered on every visit, not only when push is turned on, so the
  // installed app (`app/manifest.ts`) has its worker from the first.
  useEffect(() => {
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    void worker?.register('/push-sw.js', { scope: '/' }).catch(() => undefined);
    const heard = (event: MessageEvent<unknown>): void => {
      if ((event.data as { type?: unknown } | null)?.type === 'kithena:push') router.refresh();
    };
    worker?.addEventListener('message', heard);
    return () => {
      worker?.removeEventListener('message', heard);
    };
  }, [router]);
  // Shown as chosen at once; the server's answer replaces it, or a refusal restores it.
  const [prefs, setPrefs] = useState(saved);
  useEffect(() => {
    setPrefs(saved);
  }, [saved]);
  const table = useMemo(() => effective(prefs.bindings), [prefs.bindings]);
  const destinations = useMemo(() => {
    const reach = {
      sections: shell.sections,
      people,
      timeOff,
      activity: shell.roles.admin || shell.roles.hr,
    };
    return new Map(
      table.flatMap((s) => {
        const to = destinationOf(s, reach);
        return to === null ? [] : [[s.id, to] as const];
      }),
    );
  }, [table, shell, people, timeOff]);

  // Reach's lists, rows and buttons read the same keys: one table.
  useEffect(() => {
    setShortcutKeys({
      keys: Object.fromEntries(table.map((s) => [s.id, s.keys])),
      characterKeys: prefs.characterKeys,
    });
  }, [table, prefs.characterKeys]);

  // What C makes here: what the screen offers, else the area's action for this page.
  const offered = commands.findLast((c) => c.id === 'create');
  // The fallback is drawn again each render; its label and path are what it is.
  const fallback = createOn(shell.actions ?? [], route, pathname);
  const fallbackLabel = fallback?.label;
  const fallbackPath = fallback?.path;
  const create = useMemo(
    () =>
      offered !== undefined
        ? { label: offered.label, run: offered.run }
        : fallbackLabel === undefined || fallbackPath === undefined
          ? null
          : {
              label: fallbackLabel,
              run: () => {
                router.push(fallbackPath);
              },
            },
    [offered, fallbackLabel, fallbackPath, router],
  );

  const run = useRef<(id: string, event?: KeyboardEvent) => boolean>(() => false);
  useEffect(() => {
    run.current = (id, event) => {
      if (id === 'create') {
        if (create === null) return false;
        create.run();
        return true;
      }
      if (id === 'view-as') {
        if (!viewing) return runScreenCommand('view-as');
        endViewing();
        return true;
      }
      if (id === 'form.submit') return submitFocused(event?.target ?? document.activeElement);
      if (id === 'list.next' || id === 'list.previous') return focusList();
      if (id === 'help') {
        openHelp();
        return true;
      }
      if (id === 'page.search') {
        if (!focusPageSearch()) openPalette();
        return true;
      }
      if (id === 'page.previous' || id === 'page.next') {
        const to = adjacentPage(
          shell.sections,
          route,
          window.location,
          id === 'page.next' ? 1 : -1,
        );
        if (to === null) return false;
        router.push(to);
        return true;
      }
      const to = destinations.get(id);
      // Not somewhere to go: what a screen on the page offers under the id (⌥T, the clock).
      if (to === undefined) return runScreenCommand(id);
      router.push(to);
      return true;
    };
  });
  useEffect(() => {
    const handler = shortcutHandler({
      table,
      characterKeys: prefs.characterKeys,
      run: (id, event) => run.current(id, event),
    });
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [table, prefs.characterKeys]);

  const keysFor = useMemo(() => {
    const byPath = new Map<string, readonly string[]>();
    for (const s of table) {
      const to = destinations.get(s.id);
      if (to !== undefined && !byPath.has(to)) byPath.set(to, s.keys);
    }
    // Hints only for keys that work: none for single keys once they are off.
    return (path: string): readonly string[] | undefined => {
      const keys = byPath.get(path);
      return keys !== undefined && !prefs.characterKeys && keys.some(isCharacterKey)
        ? undefined
        : keys;
    };
  }, [table, destinations, prefs.characterKeys]);
  /*
   * One value for as long as nothing in it changes.
   *
   * It is a context above every page, and a page streamed after the shell
   * sits in its `loading.tsx` boundary, which hydrates after the shell does.
   * A new value reaching that boundary before it has hydrated makes React
   * give up on the server's HTML and draw the page again in the browser —
   * the remote's server-rendered screen thrown away for a skeleton. So
   * nothing here may change merely because the shell rendered again (as it
   * does once hydrated, for the keyboard's ⌘ or Ctrl): `isApple` is asked
   * when a save happens, not during render.
   */
  return useMemo(
    () => ({
      prefs,
      table,
      destinations,
      keysFor,
      openHelp,
      create,
      save: async (next: ShortcutPrefs) => {
        const before = prefs;
        setPrefs(next);
        const result = await saveShortcuts(next, isApple());
        if (!result.ok) {
          setPrefs(before);
          return result.message;
        }
        // The layout reads them again, so every hint and the handler agree with what was kept.
        router.refresh();
        return null;
      },
    }),
    [prefs, table, destinations, keysFor, openHelp, create, router],
  );
}

export function AppShell({
  person,
  companyName,
  logoUrl = null,
  entitlements,
  shell = EMPTY_SHELL,
  shortcuts = DEFAULT_PREFS,
  slots = [],
  inbox,
  children,
}: AppShellProps): JSX.Element {
  const [dark, setTheme] = useTheme();
  const shellView = useMemo(
    () => ({ shell, person, company: companyName }),
    [shell, person, companyName],
  );
  const areas = areasFor(entitlements);
  const pathname = usePathname();
  // The item pressed is marked at once, while its page is still on its way;
  // the address catching up (or going elsewhere) ends it. Remembered with the
  // address it was pressed from, so no effect has to clear it.
  const [pressed, setPressed] = useState<{ path: string; from: string } | null>(null);
  const here = pressed !== null && pressed.from === pathname ? pressed.path : pathname;
  // A press whose page never came (a navigation the router dropped) is loaded
  // the ordinary way rather than leaving the press looking ignored.
  useEffect(() => {
    if (pressed === null || pressed.from !== pathname) return;
    const late = window.setTimeout(() => {
      window.location.assign(pressed.path);
    }, PRESS_FALLBACK_MS);
    return () => {
      window.clearTimeout(late);
    };
  }, [pressed, pathname]);
  const presses: Presses = useMemo(
    () => ({
      pending: (path) => pressed !== null && pressed.from === pathname && pressed.path === path,
      press: (path) => {
        if (path !== pathname) setPressed({ path, from: pathname });
      },
    }),
    [pressed, pathname],
  );
  const role = roleOf(shell.roles);
  // Which of People's routes the address is, to mark its section: the shell is
  // drawn once, by the layout, so it reads that from the address rather than
  // being told by each page.
  const route = isCurrent('/people', pathname)
    ? (matchPath(shell.routes, pathname)?.path ?? null)
    : null;
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const keys = useShortcutsFor({
    prefs: shortcuts,
    shell,
    people: entitlements.includes('module.people'),
    timeOff: areas.some((a) => a.href === '/time-off' && a.built),
    route,
    openPalette: useCallback(() => {
      setPaletteOpen(true);
    }, []),
    openHelp: useCallback(() => {
      setHelpOpen(true);
    }, []),
    viewing: person.viewing != null,
  });
  // `useHint` for what is drawn here, above the provider it reads.
  const hint = (path: string): JSX.Element | undefined => {
    const k = keys.keysFor(path);
    return k === undefined ? undefined : <KbdShortcut keys={k} />;
  };
  // Hover-prefetch a plain link only where there is a page: People's routes,
  // every remote's and the host's own, never a file or a download behind a
  // route handler. A sidebar link without this waits for the server on the
  // click instead of on the hover before it.
  const remotes = useMemo(() => Object.values(shell.remotes ?? {}), [shell.remotes]);
  const isPage = useCallback(
    (path: string) =>
      HOST_PAGES.has(path) ||
      matchPath(shell.routes, path) !== undefined ||
      remotes.some((r) => matchPath(r.routes, path) !== undefined),
    [shell.routes, remotes],
  );
  useInAppLinks(isPage);
  const router = useRouter();
  const warmSidebar = useWarmSidebar(
    useCallback(
      (href: string) => {
        if (!isPage(new URL(href, window.location.origin).pathname)) return;
        prefetchPage(router, href);
        warmRemotes();
      },
      [isPage, router],
    ),
  );
  const navAreas = shellAreas({
    areas,
    shell,
    here,
    inbox: <InboxCount inbox={inbox} />,
    hint,
    people: entitlements.includes('module.people'),
    timeOff: areas.some((a) => a.href === '/time-off' && a.built),
    foot: (remote) => {
      const pinned = slots.filter((s) => s.area === remote);
      return pinned.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          {pinned.map((s) => (
            <RemoteSlot key={`${s.area} ${s.slot}`} slot={s} />
          ))}
        </div>
      );
    },
  });
  // The other tabs of this page's place, fetched whole once it has settled.
  const warmAreas = useMemo(
    () => [
      { places: [...shell.sections, ...shell.settings], routes: shell.routes },
      ...remotes.map((r) => ({ places: [...r.sections, ...r.settings], routes: r.routes })),
    ],
    [shell, remotes],
  );
  useWarmPages(pathname, warmAreas);
  /*
   * `TooltipProvider` wraps the whole shell, not just the sidebar.
   *
   * `NavItem` renders a `Tooltip` when the rail is collapsed — that is how a
   * destination keeps its name when the label is gone — and Radix throws
   * without a provider above it.
   */
  return (
    <ShellContext value={shellView}>
      <Shortcuts value={keys}>
        <TooltipProvider>
          <PageLayout
            preset="sidebar"
            bottomBar={<MobileTabs areas={areas} inbox={inbox} />}
            bottomBarVariant="floating"
            // Where the sidebar is (a 40rem container), the tab bar is not.
            bottomBarClassName="@min-[40rem]/page:hidden"
            // The gutter is a variable too, so a page's sticky header spans it edge to edge.
            contentClassName="relative px-(--reach-page-gutter) pt-3 pb-28 [--reach-page-gutter:1rem] @min-[40rem]/page:pt-8 @min-[40rem]/page:pb-12 @min-[40rem]/page:[--reach-page-gutter:2.5rem]"
            /*
          The company's own, never ours: its logo where it has uploaded one,
          its initials where it has not.

          This is the top-left of an employee's own workplace tool and the
          question it answers is "whose account am I in" — a person signing in
          to Acme should see Acme. One link home, named for the company; the
          mark is decoration beside a name that says whose it is, and in the
          rail, where the name is hidden, the link's label still does.
        */
            /*
          The company's own mark, never ours, at the top of the rail: its logo
          where it has uploaded one, its initials where it has not. One link
          home, named for the company, in both states of the sidebar.
        */
            sidebarHeader={
              <Link
                href="/"
                aria-label={tr('components.app-shell.home_2', '{{companyName}}, home', {
                  companyName,
                })}
                className="flex rounded-[0.75rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                <Avatar
                  size="md"
                  shape="rounded"
                  // A designed mark is never cropped; initials take the company's
                  // own tone rather than a grey square.
                  fit={logoUrl === null ? 'cover' : 'contain'}
                  src={logoUrl ?? undefined}
                  name={companyName}
                  aria-hidden
                />
              </Link>
            }
            // The sidebar is the rail alone: every area as an icon, fixed while the
            // page scrolls, its sections flying out on hover, focus or a tap.
            sidebarRail={
              <SidebarRail
                areas={navAreas.areas}
                settings={navAreas.settings}
                search={{
                  onOpen: () => {
                    setPaletteOpen(true);
                  },
                  shortcut: (() => {
                    const k = keys.table.find((x) => x.id === 'palette')?.keys;
                    return k === undefined || k.length === 0 ? undefined : <KbdShortcut keys={k} />;
                  })(),
                }}
                presses={presses}
                onIntent={warmSidebar}
                account={
                  <PersonMenu
                    compact
                    person={person}
                    subtitle={
                      person.viewing == null
                        ? [role, companyName].filter((x) => x !== null).join(' · ')
                        : tr(
                            'components.app-shell.viewing_as_read_only',
                            'Viewing as {{value}} · read-only',
                            { value: person.name.split(' ')[0] ?? person.name },
                          )
                    }
                    companyName={companyName}
                    timeOff={areas.some((a) => a.href === '/time-off' && a.built)}
                    dark={dark}
                    onTheme={setTheme}
                  />
                }
              />
            }
          >
            <InboxToasts inbox={inbox} />
            <SearchPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              shell={shell}
              dark={dark}
              onTheme={setTheme}
              viewing={person.viewing == null ? null : person.name}
            />
            {/*
          The page's own `loading.tsx` stands in for it while it is fetched: a
          prefetched link shows that skeleton on the frame after the click,
          in the page's shape, rather than leaving the last page frozen.
        */}
            {children}
          </PageLayout>
          <Assistant />
          <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
        </TooltipProvider>
      </Shortcuts>
    </ShellContext>
  );
}

/** The palette's last commands on this device, most recent first: a convenience, so the browser's. */
const RECENT = 'kithena.palette.recent';
function recentCommands(): readonly string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
function rememberCommand(id: string): void {
  try {
    localStorage.setItem(
      RECENT,
      JSON.stringify([id, ...recentCommands().filter((other) => other !== id)].slice(0, 5)),
    );
  } catch {
    // Private windows and blocked storage: the palette simply has no recents.
  }
}

/** In a chunk of its own, fetched when the palette is first opened: no page's first load pays for it. */
const CommandPalette = lazy(() =>
  import('@reach/ui/command-palette').then((m) => ({ default: m.CommandPalette })),
);

/**
 * ⌘K: pages, people and actions, from one field. Each action shows its keys;
 * what was run last on this device comes first.
 */
function SearchPalette({
  open,
  onOpenChange,
  shell,
  dark,
  onTheme,
  viewing,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly shell: ShellData;
  readonly dark: boolean;
  readonly onTheme: (dark: boolean) => void;
  readonly viewing: string | null;
}): JSX.Element | null {
  const router = useRouter();
  const { prefs, table, destinations, keysFor, openHelp, create } = useShortcuts();
  const commands = useScreenCommands();
  // The palette is fetched the first time it is asked for (`CommandPalette`
  // below); until then ⌘K is heard here, and from then on by the palette.
  const [wanted, setWanted] = useState(open);
  useEffect(() => {
    if (open) setWanted(true);
  }, [open]);
  useEffect(() => {
    if (wanted) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [wanted, onOpenChange]);
  const [recent, setRecent] = useState<readonly string[]>([]);
  useEffect(() => {
    if (open) setRecent(recentCommands());
  }, [open]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<readonly { value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setFound([]);
      return undefined;
    }
    setLoading(true);
    let live = true;
    const timer = setTimeout(() => {
      void searchPeople(text).then((people) => {
        if (!live) return;
        setFound(people.slice(0, 8));
        setLoading(false);
      });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const pages = useMemo<CommandItem[]>(
    () =>
      [
        // Every go-to destination People's sections do not already list: home,
        // the inbox, your profile, settings and what is under it.
        ...table.flatMap((s) => {
          const path = destinations.get(s.id);
          if (path === undefined || shell.sections.some((p) => p.path === path)) return [];
          return [
            {
              id: s.id,
              path,
              label: s.label,
              icon: s.icon,
              group: path.startsWith('/settings') ? 'Settings' : 'Pages',
            },
          ];
        }),
        ...shell.sections.flatMap((s) => [
          { ...s, group: 'People' },
          // Each tab of an umbrella page is somewhere to go too, under its section.
          ...(s.tabs ?? []).map((t) => ({
            id: `tab:${t.path}`,
            path: t.path,
            label: t.label,
            icon: s.icon,
            description: tr('components.app-shell.in', 'In {{label}}', { label: s.label }),
            group: 'People',
          })),
        ]),
        ...shell.settings.map((s) => ({ ...s, group: 'Settings' })),
      ]
        .map((p): CommandItem => {
          const keys = keysFor(p.path);
          return {
            id: 'id' in p ? p.id : p.path,
            label: p.label,
            group: p.group,
            icon: iconOf(p.icon),
            ...('description' in p && p.description !== undefined
              ? { description: p.description }
              : {}),
            ...(keys === undefined ? {} : { shortcut: keys }),
            onSelect: () => {
              router.push(p.path);
            },
          };
        })
        .concat(actionsOf()),
    [shell, router, prefs, table, destinations, keysFor, openHelp, create, commands, dark, onTheme],
  );

  /** What the palette runs rather than opens, each with its keys where it has some. */
  function actionsOf(): CommandItem[] {
    const keysOfId = (id: string): { shortcut?: readonly string[] } => {
      const keys = table.find((s) => s.id === id)?.keys;
      return keys === undefined || (!prefs.characterKeys && keys.some(isCharacterKey))
        ? {}
        : { shortcut: keys };
    };
    const exports = shell.sections.some((section) => section.path === '/people/import-export');
    return [
      ...(create === null || create === undefined
        ? []
        : [
            {
              id: 'create',
              label: tr('components.app-shell.create', 'Create… {{label}}', {
                label: create.label,
              }),
              group: 'Actions',
              icon: iconOf('add'),
              keywords: [
                tr('components.app-shell.keyword_new', 'new'),
                tr('components.app-shell.keyword_add', 'add'),
              ],
              ...keysOfId('create'),
              onSelect: create.run,
            },
          ]),
      ...commands
        .filter((c) => c.id !== 'create')
        .map((c) => ({
          id: `command:${c.id}`,
          label: c.label,
          group: 'Actions',
          ...(c.id === 'view-as' ? { icon: iconOf('visible') } : {}),
          ...keysOfId(c.id),
          onSelect: c.run,
        })),
      ...(exports
        ? [
            {
              id: 'export',
              label: tr('components.app-shell.export_people', 'Export people'),
              group: 'Actions',
              icon: iconOf('export'),
              keywords: [
                tr('components.app-shell.keyword_download', 'download'),
                tr('components.app-shell.keyword_csv', 'csv'),
              ],
              onSelect: () => {
                router.push('/people/export');
              },
            },
          ]
        : []),
      {
        id: 'theme',
        label: dark
          ? tr('components.app-shell.switch_to_light_mode', 'Switch to light mode')
          : tr('components.app-shell.switch_to_dark_mode', 'Switch to dark mode'),
        group: 'Actions',
        icon: iconOf('themeDark'),
        keywords: [
          tr('components.app-shell.keyword_theme', 'theme'),
          tr('components.app-shell.keyword_dark', 'dark'),
          tr('components.app-shell.keyword_light', 'light'),
        ],
        onSelect: () => {
          onTheme(!dark);
        },
      },
      {
        id: 'help',
        label: tr('components.app-shell.show_keyboard_shortcuts', 'Show keyboard shortcuts'),
        group: 'Actions',
        icon: iconOf('shortcuts'),
        keywords: [
          tr('components.app-shell.keyword_keys', 'keys'),
          tr('components.app-shell.keyword_hotkeys', 'hotkeys'),
        ],
        ...keysOfId('help'),
        onSelect: openHelp,
      },
    ];
  }

  // Recent first: in a group of their own with nothing typed, and ahead of an
  // equal match when something is.
  const ranked = [...pages]
    .map((item) => ({
      ...item,
      onSelect: () => {
        rememberCommand(item.id);
        item.onSelect?.();
      },
    }))
    .toSorted((a, b) => rank(a.id) - rank(b.id));
  function rank(id: string): number {
    const at = recent.indexOf(id);
    return at === -1 ? recent.length : at;
  }
  const shown =
    query.trim() === ''
      ? ranked.map((item) => (recent.includes(item.id) ? { ...item, group: 'Recent' } : item))
      : ranked;

  // While viewing as somebody, the way back comes before anything else.
  const viewKeys = shownKeys(table.find((s) => s.id === 'view-as')?.keys, prefs.characterKeys);
  const back: CommandItem[] =
    viewing === null
      ? []
      : [
          {
            id: 'view-as.end',
            label: tr('components.app-shell.end_viewing_as', 'End viewing as {{name}}', {
              name: viewing,
            }),
            group: tr('components.app-shell.viewing_as', 'Viewing as {{name}}', { name: viewing }),
            icon: iconOf('close'),
            keywords: [
              tr('components.app-shell.keyword_view_as', 'view as'),
              tr('components.app-shell.keyword_stop', 'stop'),
              tr('components.app-shell.keyword_exit', 'exit'),
            ],
            ...(viewKeys.length === 0 ? {} : { shortcut: viewKeys }),
            onSelect: endViewing,
          },
        ];

  const items = [
    ...filterCommands(back, query),
    ...found.map((p): CommandItem => ({
      id: `person:${p.value}`,
      label: p.label,
      group: tr('components.app-shell.people_you_can_see', 'People you can see'),
      avatar: <Avatar name={p.label} size="sm" />,
      onSelect: () => {
        router.push(`/people/${p.value}` as Route);
      },
    })),
    ...filterCommands(shown, query),
  ];

  return !wanted ? null : (
    <Suspense fallback={null}>
      <CommandPalette
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next) setQuery('');
        }}
        hotkey="k"
        label={tr('components.app-shell.search_people_and_pages', 'Search people and pages')}
        placeholder={tr('components.app-shell.search_people_and_pages', 'Search people and pages')}
        items={items}
        filter={false}
        loading={loading}
        onQueryChange={setQuery}
        empty={tr(
          'components.app-shell.nobody_and_nothing_by_that_name',
          'Nobody and nothing by that name.',
        )}
      />
    </Suspense>
  );
}

/**
 * The person, at the end of the sidebar: the account menu (V9).
 *
 * Who you are, then what is yours: your own profile (`G` `M`), your time off,
 * the keyboard shortcuts,
 * your preferences, the company you are in, and signing out. Your profile is
 * about you rather than about managing people, so it lives here, one click
 * from anywhere, rather than among People's sections.
 *
 * Opens on hover **and** on click and keyboard. Hover alone would put signing
 * out behind a gesture a keyboard cannot make and a touch screen does not have
 * — which is also why this is a menu rather than a `HoverCard`.
 *
 * Sign-out is a form rather than a link. It changes server state, and a `GET`
 * that ends a session is one a prefetcher or a link scanner can fire.
 */
function PersonMenu({
  person,
  subtitle,
  companyName,
  timeOff,
  dark,
  onTheme,
  compact = false,
}: {
  /** In the rail: the avatar alone, its name in the menu it opens. */
  compact?: boolean;
  person: AppShellProps['person'];
  subtitle: string;
  companyName: string;
  /**
   * Whether time off is there to open: the company has it and the area is
   * built, as the sidebar's row says. Otherwise the item is disabled.
   */
  timeOff: boolean;
  dark: boolean;
  onTheme: (next: boolean) => void;
}): JSX.Element {
  const signOut = useRef<HTMLFormElement>(null);
  const { prefs, table, openHelp } = useShortcuts();
  const hint = useHint();
  const viewKeys = shownKeys(table.find((s) => s.id === 'view-as')?.keys, prefs.characterKeys);
  return (
    <DropdownMenu openOnHover>
      <DropdownMenuTrigger
        aria-label={compact ? person.name : undefined}
        className={
          compact
            ? 'hover:bg-surface-hover focus-visible:outline-border-focus flex min-h-tap w-full items-center justify-center rounded-[0.75rem] p-1 focus-visible:outline-2 focus-visible:outline-offset-2'
            : 'hover:bg-surface-hover focus-visible:outline-border-focus flex min-h-tap w-full items-center gap-2.5 rounded-md p-2.5 text-left shadow-[inset_0_0_0_1px_var(--reach-color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:p-1 group-data-[collapsed]/sidebar:shadow-none'
        }
      >
        <Avatar name={person.name} size="md" />
        {compact ? null : (
          <>
            <span
              data-rail-label=""
              className="min-w-0 flex-1 group-data-[collapsed]/sidebar:hidden"
            >
              <span className="block truncate text-sm font-semibold">{person.name}</span>
              {subtitle === '' ? null : (
                <span className="text-fg-muted block truncate text-xs">{subtitle}</span>
              )}
            </span>
            <icons.expand
              aria-hidden
              data-rail-label=""
              className="text-fg-subtle size-4 shrink-0 group-data-[collapsed]/sidebar:hidden"
            />
          </>
        )}
      </DropdownMenuTrigger>

      {/* Out to the right like the navigation's flyouts, its foot level with the trigger's. */}
      <DropdownMenuContent side="right" align="end" sideOffset={16} className="w-65">
        <DropdownMenuLabel className="flex items-center gap-2.5 py-2 text-sm font-normal text-fg">
          <Avatar name={person.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{person.name}</span>
            <span className="block truncate text-xs text-fg-muted">
              {subtitle === '' ? (person.email ?? '') : subtitle}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {person.viewing == null ? null : (
          <>
            <DropdownMenuItem onSelect={endViewing}>
              <icons.close />
              {tr('components.app-shell.end_viewing_as_2', 'End viewing as')} {person.name}
              {viewKeys.length === 0 ? null : (
                <DropdownMenuShortcut className="flex">
                  <KbdShortcut keys={viewKeys} />
                </DropdownMenuShortcut>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/people/me">
            <icons.person />
            {tr('components.app-shell.my_profile', 'My profile')}
            {hint('/people/me') === undefined ? null : (
              <DropdownMenuShortcut className="flex">{hint('/people/me')}</DropdownMenuShortcut>
            )}
          </Link>
        </DropdownMenuItem>
        {/* Not a link until the company has time off: an item that 404s says less than a disabled one. */}
        {timeOff ? (
          <DropdownMenuItem asChild>
            <Link href="/time-off/overview">
              <icons.calendar />
              {tr('components.app-shell.my_time_off', 'My time off')}
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <icons.calendar />
            {tr('components.app-shell.my_time_off', 'My time off')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={openHelp}>
          <icons.shortcuts />
          {tr('components.app-shell.keyboard_shortcuts', 'Keyboard shortcuts')}
          {prefs.characterKeys ? (
            <DropdownMenuShortcut className="flex">
              <KbdShortcut keys={table.find((s) => s.id === 'help')?.keys ?? []} />
            </DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <icons.adjust />
            {tr('components.app-shell.preferences', 'Preferences')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <ThemeChoice dark={dark} onChange={onTheme} />
            <DropdownMenuSeparator />
            <LanguageChoice />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {/* The session knows one company: it is listed, ticked, so the menu says where you are. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <icons.company />
            {tr('components.app-shell.switch_company', 'Switch company')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuLabel>
              {tr('components.app-shell.your_companies', 'Your companies')}
            </DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked
              onSelect={(event) => {
                event.preventDefault();
              }}
            >
              <span className="truncate">{companyName}</span>
            </DropdownMenuCheckboxItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          onSelect={() => {
            signOut.current?.requestSubmit();
          }}
        >
          <SignOut />
          {tr('components.app-shell.sign_out', 'Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
      {/* A POST, so no prefetcher or link scanner can end a session. */}
      <form ref={signOut} action="/auth/sign-out" method="post" hidden />
    </DropdownMenu>
  );
}

/**
 * Light or dark, in the menu where the rest of this person's preferences are:
 * a switch, because dark mode is a setting that is on or off, not an option
 * that is ticked. `onSelect` is prevented from closing the menu, so somebody
 * can look at the result and change their mind without opening it again.
 */
function ThemeChoice({
  dark,
  onChange,
}: {
  readonly dark: boolean;
  readonly onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <DropdownMenuCheckboxItem
      indicator="switch"
      checked={dark}
      onSelect={(event) => {
        event.preventDefault();
      }}
      onCheckedChange={onChange}
    >
      <ThemeDark />
      {tr('components.app-shell.dark_mode', 'Dark mode')}
    </DropdownMenuCheckboxItem>
  );
}

/**
 * The language Kithena speaks to this person, among their preferences: one of
 * a list, each named in itself. Kept with their account and on this device
 * (`app/(app)/settings/language/actions.ts`), then the page loads again in it,
 * so every screen, the remotes' module-level words included, is in the new one.
 */
function LanguageChoice(): JSX.Element {
  const language = useLanguage();
  const router = useRouter();
  return (
    <>
      <DropdownMenuLabel>{tr('components.app-shell.language', 'Language')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={language}
        onValueChange={(next) => {
          const chosen = LANGUAGES.find((l) => l.code === next)?.code;
          if (chosen === undefined || chosen === language) return;
          // On this device at once: the cookie, then every screen in the new words.
          document.cookie = languageCookie(chosen);
          void switchLanguage(chosen).then(() => {
            // What the server drew follows, without leaving the page.
            router.refresh();
          });
          void saveLanguage(chosen).then((result) => {
            // Viewing as somebody changes nothing of theirs: back to the language they had.
            if (!result.ok && result.code === 'view_only') {
              document.cookie = languageCookie(language);
              void switchLanguage(language).then(() => {
                router.refresh();
              });
            }
          });
        }}
      >
        {LANGUAGES.map((l) => (
          <DropdownMenuRadioItem
            key={l.code}
            value={l.code}
            lang={l.code}
            onSelect={(event) => {
              event.preventDefault();
            }}
          >
            {l.name}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </>
  );
}

/**
 * The account, for a screen with no sidebar (MA A3): a small menu anchored to
 * the person's avatar in a phone's title bar, not a sheet. Who they are, their
 * profile and time off, Settings, dark mode, the company and signing out.
 * While viewing as somebody, ending it comes first.
 */
export function AccountSheet({
  person,
}: {
  readonly person: AppShellProps['person'];
}): JSX.Element {
  const [dark, setTheme] = useTheme();
  const { shell, company } = use(ShellContext);
  const signOut = useRef<HTMLFormElement>(null);
  const role = roleOf(shell.roles);
  const timeOff = shell.remotes?.['timeoff'] !== undefined;
  const who =
    person.viewing == null
      ? [person.name, role, company].filter((x) => x != null && x !== '').join(' · ')
      : tr('components.app-shell.viewing_as_read_only', 'Viewing as {{value}} · read-only', {
          value: person.name.split(' ')[0] ?? person.name,
        });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative tap-target rounded-full p-0"
          aria-label={tr('components.app-shell.your_account', 'Your account')}
        >
          <Avatar name={person.name} size="md" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-75">
        <DropdownMenuLabel className="text-sm font-normal text-fg-muted">{who}</DropdownMenuLabel>
        {person.viewing == null ? null : (
          <>
            <DropdownMenuItem onSelect={endViewing}>
              <icons.close />
              {tr('components.app-shell.end_viewing_as_2', 'End viewing as')} {person.name}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/people/me">
            <icons.person />
            {tr('components.app-shell.my_profile', 'My profile')}
          </Link>
        </DropdownMenuItem>
        {timeOff ? (
          <DropdownMenuItem asChild>
            <Link href="/time-off/overview">
              <icons.calendar />
              {tr('components.app-shell.my_time_off', 'My time off')}
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <icons.calendar />
            {tr('components.app-shell.my_time_off', 'My time off')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings />
            {tr('components.app-shell.settings', 'Settings')}
          </Link>
        </DropdownMenuItem>
        <ThemeChoice dark={dark} onChange={setTheme} />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <icons.adjust />
            {tr('components.app-shell.language', 'Language')}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <LanguageChoice />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {company === undefined ? null : (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <icons.company />
              {tr('components.app-shell.switch_company', 'Switch company')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuLabel>
                {tr('components.app-shell.your_companies', 'Your companies')}
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked
                onSelect={(event) => {
                  event.preventDefault();
                }}
              >
                <span className="truncate">{company}</span>
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => {
            signOut.current?.requestSubmit();
          }}
        >
          <SignOut />
          {tr('components.app-shell.sign_out', 'Sign out')}
        </DropdownMenuItem>
      </DropdownMenuContent>
      {/* A POST, so no prefetcher or link scanner can end a session. */}
      <form ref={signOut} action="/auth/sign-out" method="post" hidden />
    </DropdownMenu>
  );
}

/**
 * Ends viewing as somebody: a POST to `/auth/view-as/end`, which signs the
 * view-as session out and puts the administrator's own back. A full
 * navigation, since everything on the page was the employee's.
 */
function endViewing(): void {
  const form = document.createElement('form');
  form.method = 'post';
  form.action = '/auth/view-as/end';
  form.hidden = true;
  document.body.append(form);
  form.submit();
}

/** A shortcut's keys as a hint shows them: none once single keys are off. */
function shownKeys(keys: readonly string[] | undefined, characterKeys: boolean): readonly string[] {
  return keys === undefined || (!characterKeys && keys.some(isCharacterKey)) ? [] : keys;
}

/**
 * The sidebar, for a layout too narrow to hold one: a floating tab bar.
 *
 * Home, Time off, People, Inbox and Me. Time off opens its overview; People
 * opens the section list (the sidebar's menu, as a page); Inbox is what the
 * bell holds; Me is their own record.
 * Areas that are not built yet are left off here rather than disabled: five
 * slots is the ceiling, and a dead tab costs one of them.
 */
function MobileTabs({
  areas,
  inbox,
}: {
  readonly areas: typeof AREAS;
  readonly inbox: Promise<InboxPeek> | undefined;
}): JSX.Element {
  const pathname = usePathname();
  const todo = useInboxTodo(inbox);
  const people = areas.some((a) => a.href === '/people');
  const timeOff = areas.some((a) => a.href === '/time-off' && a.built);
  const tabs: readonly {
    href: string;
    label: string;
    icon: JSX.Element;
    current: boolean;
    count?: number;
  }[] = [
    {
      href: '/',
      label: tr('components.app-shell.home_tab', 'Home'),
      icon: <Home />,
      current: pathname === '/',
    },
    ...(timeOff
      ? [
          {
            href: '/time-off/overview',
            label: tr('components.app-shell.time_off', 'Time off'),
            icon: <Leave />,
            current: isCurrent('/time-off', pathname),
          },
        ]
      : []),
    ...(people
      ? [
          {
            href: '/people/menu',
            label: tr('components.app-shell.people', 'People'),
            icon: <People />,
            current: isCurrent('/people', pathname) && !isCurrent('/people/me', pathname),
          },
          {
            href: '/inbox',
            label: tr('components.app-shell.inbox', 'Inbox'),
            icon: <icons.inbox />,
            current: isCurrent('/inbox', pathname),
            count: todo,
          },
          {
            href: '/people/me',
            label: tr('components.app-shell.me', 'Me'),
            icon: <icons.person />,
            current: isCurrent('/people/me', pathname),
          },
        ]
      : []),
  ];
  return (
    <TabBar
      label={tr('components.app-shell.main_compact', 'Main, compact')}
      className="border-0 bg-transparent p-0 shadow-none"
    >
      {tabs.map((t) => (
        <TabBarItem
          key={t.href}
          asChild
          icon={t.icon}
          label={t.label}
          current={t.current}
          {...(t.count === undefined || t.count === 0 ? {} : { count: t.count })}
        >
          <Link href={t.href as Route} />
        </TabBarItem>
      ))}
    </TabBar>
  );
}
