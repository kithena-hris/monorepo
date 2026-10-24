'use client';

import {
  Avatar,
  Button,
  CommandPalette,
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
  Nav,
  NavItem,
  NavList,
  PageLayout,
  Separator,
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
import { useInAppLinks, useWarmPages } from '../lib/links';
import { AREAS as REMOTES, firstUnder, matchPath } from '../lib/remotes';
import {
  DEFAULT_PREFS,
  adjacentPage,
  createOn,
  destinationOf,
  effective,
  isCharacterKey,
  type ShortcutPrefs,
} from '../lib/shortcuts';
import { SIDEBAR_COOKIE } from '../lib/sidebar';
import { themeCookie } from '../lib/theme';
import { Assistant } from './assistant';
import { InboxCount, InboxToasts, useInboxTodo } from './inbox/bell';
import type { InboxPeek } from '../lib/inbox/peek';
import { iconOf, PeopleSections, PeopleSubnav } from './people-nav';
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
 * The signed-in shell: the sidebar with search and the bell under the logo,
 * its People menu, the assistant in the bottom corner, and a tab bar where
 * there is no room for a sidebar.
 *
 * `PageLayout` owns the grid, the collapsed rail (its buttons, its edge, the
 * `⌘\` shortcut and remembering it on this device) and `Nav` owns the list
 * semantics. People's sections sit inline under its item while you are in
 * People; in the collapsed rail they are its flyout. Where the layout is too
 * narrow for a sidebar (a 640px container, never the window's) the tab bar
 * takes over: Home, Time off, People, Inbox and Me, the way every app on a
 * phone already works. Time off's sections sit under its item the same way.
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
  /**
   * Whether this device keeps the sidebar collapsed, read from its cookie on
   * the server (`sidebarCollapsed`), so the first paint is already the rail
   * or the full sidebar. `undefined`: never chosen, and a narrow layout starts
   * as the rail.
   */
  readonly sidebarCollapsed?: boolean | undefined;
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
  sidebarCollapsed,
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
  const [pressed, setPressed] = useState<{ href: string; from: string } | null>(null);
  const here = pressed !== null && pressed.from === pathname ? pressed.href : pathname;
  const role = roleOf(shell.roles);
  // Which of People's routes the address is, to mark its section: the shell is
  // drawn once, by the layout, so it reads that from the address rather than
  // being told by each page.
  const route = isCurrent('/people', pathname)
    ? (matchPath(shell.routes, pathname)?.path ?? null)
    : null;
  /**
   * A remote area by its home, and which of its routes the address is while
   * you are in it. An area with one section has nothing to list under its
   * item: the item is the section.
   */
  const remoteOf = (href: string) => {
    const remote = shell.remotes?.[Object.values(REMOTES).find((r) => r.home === href)?.name ?? ''];
    if (remote === undefined || remote.sections.length < 2) return null;
    return {
      ...remote,
      route: isCurrent(href, pathname) ? (matchPath(remote.routes, pathname)?.path ?? null) : null,
    };
  };
  // Every area's sections inline under its item while you are in it (V2), as
  // People's: Time Off, Documents, Recruiting, Onboarding and Performance alike.
  const inlineSubnav = (href: string, label: string) => {
    const remote = remoteOf(href);
    if (remote === null) return {};
    return {
      subnav: (
        <PeopleSubnav
          sections={remote.sections}
          route={remote.route}
          counts={remote.counts ?? {}}
          label={tr('components.app-shell.sections', '{{label}} sections', { label })}
        />
      ),
      expanded: isCurrent(href, here),
    };
  };
  // The same sections as the collapsed rail's flyout (V8), as People's are.
  const railFlyout = (href: string, label: string) => {
    const remote = remoteOf(href);
    if (remote === null) return {};
    return {
      flyout: (
        <PeopleSections
          title={label}
          home={href}
          sections={remote.sections}
          route={remote.route}
          counts={remote.counts ?? {}}
        />
      ),
      flyoutSize: 'compact' as const,
    };
  };
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
            // Collapsed or not is remembered on this device, in a cookie the
            // server reads; with nothing remembered, a layout under 1024px starts
            // as the rail.
            sidebarCollapse={{
              mode: 'rail',
              ...(sidebarCollapsed === undefined ? {} : { defaultCollapsed: sidebarCollapsed }),
              onCollapsedChange: rememberSidebar,
            }}
            bottomBar={<MobileTabs areas={areas} inbox={inbox} />}
            bottomBarVariant="floating"
            // Where the sidebar is (a 40rem container), the tab bar is not.
            bottomBarClassName="@min-[40rem]/page:hidden"
            contentClassName="relative px-4 pt-3 pb-28 @min-[40rem]/page:px-10 @min-[40rem]/page:pt-8 @min-[40rem]/page:pb-12"
            /*
          The company's own, never ours: its logo where it has uploaded one,
          its initials where it has not.

          This is the top-left of an employee's own workplace tool and the
          question it answers is "whose account am I in" — a person signing in
          to Acme should see Acme. One link home, named for the company; the
          mark is decoration beside a name that says whose it is, and in the
          rail, where the name is hidden, the link's label still does.
        */
            sidebarHeader={
              <Link
                href="/"
                aria-label={tr('components.app-shell.home_2', '{{companyName}}, home', {
                  companyName,
                })}
                className="flex min-w-0 flex-1 items-center gap-2.5"
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
                <span
                  data-rail-label=""
                  className="truncate text-sm font-semibold group-data-[collapsed]/sidebar:hidden"
                >
                  {companyName}
                </span>
              </Link>
            }
            sidebar={
              <div className="flex h-full min-h-0 w-62 flex-col gap-1 px-3.5 pt-2 pb-4 group-data-[collapsed]/sidebar:w-auto group-data-[collapsed]/sidebar:p-2">
                {/* Under the logo, before any area: search (the command palette, every
                    page and anybody they may read), then the areas. What is waiting for
                    them is the Inbox, with its count beside its name. */}
                <Nav label={tr('components.app-shell.search', 'Search')}>
                  <NavList>
                    <NavItem
                      asChild
                      icon={<icons.search aria-hidden />}
                      shortcut={
                        <KbdShortcut
                          keys={keys.table.find((s) => s.id === 'palette')?.keys ?? []}
                        />
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPaletteOpen(true);
                        }}
                      >
                        {tr('components.app-shell.search', 'Search')}
                      </button>
                    </NavItem>
                  </NavList>
                </Nav>
                <Nav
                  label={tr('components.app-shell.areas', 'Areas')}
                  className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
                >
                  <NavList>
                    {areas.map((area) =>
                      area.built ? (
                        <NavItem
                          key={area.label}
                          asChild
                          icon={area.icon}
                          current={isCurrent(area.href, here)}
                          shortcut={hint(area.href)}
                          {...(area.href === '/inbox'
                            ? { badge: <InboxCount inbox={inbox} /> }
                            : {})}
                          {...(area.href === '/people' && shell.sections.length > 0
                            ? {
                                // Inline while you are in People (V2); from the
                                // collapsed rail, the same six as a flyout (V8).
                                subnav: (
                                  <PeopleSubnav
                                    sections={shell.sections}
                                    route={route}
                                    counts={shell.counts}
                                  />
                                ),
                                expanded: isCurrent(area.href, here),
                                flyout: (
                                  <PeopleSections
                                    sections={shell.sections}
                                    route={route}
                                    counts={shell.counts}
                                  />
                                ),
                                flyoutSize: 'compact' as const,
                              }
                            : {
                                // Every other area with sections: inline while you
                                // are in it, and from the collapsed rail as a flyout.
                                ...inlineSubnav(area.href, area.label),
                                ...railFlyout(area.href, area.label),
                              })}
                        >
                          {/* Where the area's address redirects (`firstUnder`, as the
                              server does), so a press is one round trip, not two:
                              every remote's, by its home, not only those with a
                              subnav. */}
                          <Link
                            href={
                              (firstUnder(
                                area.href === '/people'
                                  ? shell.sections
                                  : (shell.remotes?.[
                                      Object.values(REMOTES).find((r) => r.home === area.href)
                                        ?.name ?? ''
                                    ]?.sections ?? []),
                                area.href,
                              ) ?? (area.href === '/inbox' ? '/inbox/todo' : area.href)) as Route
                            }
                            onClick={() => {
                              setPressed({ href: area.href, from: pathname });
                            }}
                          >
                            {area.label}
                          </Link>
                        </NavItem>
                      ) : (
                        <NavItem
                          key={area.label}
                          icon={area.icon}
                          // Not yet built. Disabled rather than absent, and not a
                          // link at all — no `href` — as the account menu's item
                          // and `g t` are not: a link that 404s is worse than one
                          // that says "not yet".
                          aria-disabled
                          tabIndex={-1}
                          className="opacity-60"
                        >
                          {area.label}
                        </NavItem>
                      ),
                    )}
                  </NavList>
                </Nav>

                {/* Pinned: settings and the person stay reachable however long the list above grows. */}
                <div className="mt-auto flex shrink-0 flex-col gap-2">
                  <Separator className="mx-1.5 my-1 group-data-[collapsed]/sidebar:hidden" />
                  <Nav label={tr('components.app-shell.account', 'Account')}>
                    <NavList>
                      <NavItem
                        asChild
                        icon={<Settings />}
                        current={isCurrent('/settings', pathname)}
                        shortcut={hint('/settings')}
                      >
                        <Link href="/settings">
                          {tr('components.app-shell.settings', 'Settings')}
                        </Link>
                      </NavItem>
                    </NavList>
                  </Nav>
                  {/* The clock (Time Off's, TOF-059), above the person; not in the rail, where it has no room. */}
                  {slots.length === 0 ? null : (
                    <div className="flex flex-col gap-2 group-data-[collapsed]/sidebar:hidden">
                      {slots.map((s) => (
                        <RemoteSlot key={`${s.area} ${s.slot}`} slot={s} />
                      ))}
                    </div>
                  )}
                  <PersonMenu
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
                </div>
              </div>
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
}): JSX.Element {
  const router = useRouter();
  const { prefs, table, destinations, keysFor, openHelp, create } = useShortcuts();
  const commands = useScreenCommands();
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
        id: 'sidebar',
        label: tr(
          'components.app-shell.collapse_or_expand_the_sidebar',
          'Collapse or expand the sidebar',
        ),
        group: 'Actions',
        icon: iconOf('menu'),
        ...keysOfId('sidebar'),
        onSelect: () => {
          // ponytail: `PageLayout` owns the rail and answers ⌘\; the palette presses
          // it rather than holding a second copy of that state.
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
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

  return (
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
}: {
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
      <DropdownMenuTrigger className="hover:bg-surface-hover focus-visible:outline-border-focus flex min-h-tap w-full items-center gap-2.5 rounded-md p-2.5 text-left shadow-[inset_0_0_0_1px_var(--reach-color-border)] focus-visible:outline-2 focus-visible:outline-offset-2 group-data-[collapsed]/sidebar:justify-center group-data-[collapsed]/sidebar:p-1 group-data-[collapsed]/sidebar:shadow-none">
        <Avatar name={person.name} size="md" />
        <span data-rail-label="" className="min-w-0 flex-1 group-data-[collapsed]/sidebar:hidden">
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
 * Remembers the person's choice for the server's next render. A year, like
 * any preference; `Lax`, because it only shapes the page.
 */
function rememberSidebar(collapsed: boolean): void {
  document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
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
            href: '/inbox/todo',
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
