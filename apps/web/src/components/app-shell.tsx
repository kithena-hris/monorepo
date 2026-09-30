'use client';

import {
  Avatar,
  Badge,
  Button,
  CommandPalette,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Field,
  FieldControl,
  FieldLabel,
  filterCommands,
  KbdShortcut,
  KithenaLogo,
  KithenaMark,
  Nav,
  NavItem,
  NavList,
  NotificationCenter,
  NotificationItem,
  PageLayout,
  Separator,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Switch,
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
import Link from 'next/link';
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
import { saveShortcuts } from '../app/(app)/settings/shortcuts/actions';
import { EMPTY_SHELL, type ShellData } from '../lib/shell-data';
import { useInAppLinks } from '../lib/links';
import { matchPath } from '../lib/remotes';
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
import { iconOf, PeopleSections, PeopleSubnav } from './people-nav';
import {
  Shortcuts,
  ShortcutsHelp,
  focusList,
  focusPageSearch,
  shortcutHandler,
  submitFocused,
  useApple,
  useHint,
  useShortcuts,
  type ShortcutsValue,
} from './shortcuts';

import { since } from './since';

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
 * The signed-in shell: the sidebar with its People menu, search and the bell
 * in the top corner, the assistant in the bottom one, and a tab bar where
 * there is no room for a sidebar.
 *
 * `PageLayout` owns the grid, the collapsed rail (its buttons, its edge, the
 * `⌘\` shortcut and remembering it on this device) and `Nav` owns the list
 * semantics. People's sections sit inline under its item while you are in
 * People; in the collapsed rail they are its flyout. Where the layout is too
 * narrow for a sidebar (a 640px container, never the window's) the tab bar
 * takes over: Home, People, Inbox and Me, the way every app on a phone
 * already works.
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
  readonly children: ReactNode;
}

/**
 * What a person can reach today, and what is coming.
 *
 * The dashboard and People are built. The rest are listed as disabled rather
 * than hidden, because a sidebar that grows an item per release teaches nobody
 * where anything lives — and each one maps to a module in `ModuleKey`, so this
 * list is the product's shape rather than a guess at one.
 */
const AREAS: readonly {
  readonly label: string;
  readonly icon: JSX.Element;
  readonly href: string;
  readonly built: boolean;
  /** The entitlement that must be held for the area to show; none for home. */
  readonly module?: string;
}[] = [
  { label: 'Home', icon: <Home />, href: '/', built: true },
  { label: 'Time off', icon: <Leave />, href: '/time-off', built: false, module: 'module.timeoff' },
  { label: 'People', icon: <People />, href: '/people', built: true, module: 'module.people' },
  {
    label: 'Documents',
    icon: <Document />,
    href: '/documents',
    built: false,
    module: 'module.documents',
  },
];

/**
 * The shell's People data, for what is drawn inside the shell before the page
 * it belongs to has arrived: a loading skeleton knows the tabs its page will
 * have from here (`PeopleLoading`).
 */
const ShellContext = createContext<ShellData>(EMPTY_SHELL);

export function useShellData(): ShellData {
  return use(ShellContext);
}

/** The shell's own pages, beside People's routes (`isPage`). */
const HOST_PAGES = new Set([
  '/',
  '/inbox',
  '/people/menu',
  '/settings',
  '/settings/activity',
  '/settings/shortcuts',
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
  if (roles.admin) return 'Administrator';
  if (roles.hr) return 'HR';
  if (roles.finance) return 'Finance';
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
  const apple = useApple();
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
  const fallback = createOn(shell.actions ?? [], route, pathname);
  const create =
    offered !== undefined
      ? { label: offered.label, run: offered.run }
      : fallback === null
        ? null
        : {
            label: fallback.label,
            run: () => {
              router.push(fallback.path);
            },
          };

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
        const to = adjacentPage(shell.sections, route, window.location, id === 'page.next' ? 1 : -1);
        if (to === null) return false;
        router.push(to);
        return true;
      }
      const to = destinations.get(id);
      if (to === undefined) return false;
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
  return {
    prefs,
    table,
    destinations,
    keysFor,
    openHelp,
    create,
    save: async (next) => {
      const before = prefs;
      setPrefs(next);
      const result = await saveShortcuts(next, apple);
      if (!result.ok) {
        setPrefs(before);
        return result.message;
      }
      // The layout reads them again, so every hint and the handler agree with what was kept.
      router.refresh();
      return null;
    },
  };
}

export function AppShell({
  person,
  companyName,
  logoUrl = null,
  entitlements,
  shell = EMPTY_SHELL,
  sidebarCollapsed,
  shortcuts = DEFAULT_PREFS,
  children,
}: AppShellProps): JSX.Element {
  const [dark, setTheme] = useTheme();
  const areas = areasFor(entitlements);
  const pathname = usePathname();
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
  // Hover-prefetch a plain link only where there is a page: People's routes
  // and the host's own, never a file or a download behind a route handler.
  const isPage = useCallback(
    (path: string) => HOST_PAGES.has(path) || matchPath(shell.routes, path) !== undefined,
    [shell.routes],
  );
  useInAppLinks(isPage);
  /*
   * `TooltipProvider` wraps the whole shell, not just the sidebar.
   *
   * `NavItem` renders a `Tooltip` when the rail is collapsed — that is how a
   * destination keeps its name when the label is gone — and Radix throws
   * without a provider above it.
   */
  return (
    <ShellContext value={shell}>
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
        bottomBar={<MobileTabs areas={areas} inbox={shell.notices.length} />}
        bottomBarVariant="floating"
        // Where the sidebar is (a 40rem container), the tab bar is not.
        bottomBarClassName="@min-[40rem]/page:hidden"
        contentClassName="relative px-4 pt-3 pb-28 @min-[40rem]/page:px-10 @min-[40rem]/page:pt-8 @min-[40rem]/page:pb-12"
        /*
          The company's mark where theirs exists, ours where it does not.

          Not both. This is the top-left of an employee's own workplace tool and
          the question it answers is "whose account am I in" — a person signing
          in to Acme should see Acme.
        */
        sidebarHeader={
          logoUrl === null ? (
            <>
              <KithenaLogo
                data-rail-label=""
                className="text-fg h-6 w-auto shrink-0 group-data-[collapsed]/sidebar:hidden"
              />
              <KithenaMark
                title="Kithena"
                className="text-fg hidden size-7 group-data-[collapsed]/sidebar:block"
              />
            </>
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size="md" shape="rounded" fit="contain" src={logoUrl} name={companyName} />
              <span
                data-rail-label=""
                className="truncate text-sm font-semibold group-data-[collapsed]/sidebar:hidden"
              >
                {companyName}
              </span>
            </div>
          )
        }
        sidebar={
          <div className="flex h-full min-h-0 w-62 flex-col gap-1 px-3.5 pt-2 pb-4 group-data-[collapsed]/sidebar:w-auto group-data-[collapsed]/sidebar:p-2">
            <Nav label="Areas" className="min-h-0 flex-1 overflow-y-auto">
              <NavList>
                {areas.map((area) =>
                  area.built ? (
                    <NavItem
                      key={area.label}
                      asChild
                      icon={area.icon}
                      current={isCurrent(area.href, pathname)}
                      shortcut={hint(area.href)}
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
                            expanded: isCurrent(area.href, pathname),
                            flyout: (
                              <PeopleSections
                                sections={shell.sections}
                                route={route}
                                counts={shell.counts}
                              />
                            ),
                            flyoutSize: 'compact' as const,
                          }
                        : {})}
                    >
                      <Link href={area.href as Route}>{area.label}</Link>
                    </NavItem>
                  ) : (
                    <NavItem
                      key={area.label}
                      href={area.href}
                      icon={area.icon}
                      // Not yet built. Disabled rather than absent: a link that
                      // 404s is worse than one that says "not yet".
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
              <Nav label="Account">
                <NavList>
                  <NavItem
                    asChild
                    icon={<Settings />}
                    current={isCurrent('/settings', pathname)}
                    shortcut={hint('/settings')}
                  >
                    <Link href="/settings">Settings</Link>
                  </NavItem>
                </NavList>
              </Nav>
              <PersonMenu
                person={person}
                subtitle={
                  person.viewing == null
                    ? [role, companyName].filter((x) => x !== null).join(' · ')
                    : `Viewing as ${person.name.split(' ')[0] ?? person.name} · read-only`
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
        <TopCorner
          shell={shell}
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
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

/**
 * Search and the bell, in the top corner of the content at a desk.
 *
 * Search is the command palette: every People page this person may open, and
 * anybody they may read, found as they type (`searchPeople`). The bell is
 * what People says is waiting for them — approvals to decide, details to add —
 * which is the same list the phone's Inbox tab shows.
 */
function TopCorner({
  shell,
  open,
  onOpenChange: setOpen,
  dark,
  onTheme,
  viewing,
}: {
  readonly shell: ShellData;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly dark: boolean;
  readonly onTheme: (dark: boolean) => void;
  /** Whose view this is, while an administrator views as them; null otherwise. */
  readonly viewing: string | null;
}): JSX.Element {
  return (
    <div className="absolute end-6 top-5 z-20 hidden items-center gap-2 @min-[40rem]/page:flex">
      <Button
        size="sm"
        className="w-56 justify-start rounded-control text-fg-muted"
        startIcon={<icons.search aria-hidden />}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span className="flex-1 text-start font-normal">Search people</span>
        <KbdShortcut keys={useShortcuts().table.find((s) => s.id === 'palette')?.keys ?? []} />
      </Button>
      <SearchPalette
        open={open}
        onOpenChange={setOpen}
        shell={shell}
        dark={dark}
        onTheme={onTheme}
        viewing={viewing}
      />
      <Notices shell={shell} />
    </div>
  );
}

/** The bell and what is behind it. */
export function Notices({ shell }: { readonly shell: ShellData }): JSX.Element {
  const count = shell.notices.length;
  return (
    <NotificationCenter
      title="Notifications"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          className="relative"
          aria-label={count === 0 ? 'Notifications' : `Notifications, ${String(count)} waiting`}
          startIcon={<icons.notifications aria-hidden />}
        >
          {count === 0 ? null : (
            <Badge
              size="xs"
              variant="solid"
              tone="danger"
              aria-hidden
              className="absolute -top-0.5 -end-0.5 ring-2 ring-canvas"
            >
              {count}
            </Badge>
          )}
        </Button>
      }
    >
      {count === 0 ? (
        <p className="px-4 py-6 text-sm text-fg-muted">Nothing is waiting for you.</p>
      ) : (
        <NoticeList shell={shell} />
      )}
    </NotificationCenter>
  );
}

/** The notices as items: the bell's panel, and the Inbox page. */
export function NoticeList({ shell }: { readonly shell: ShellData }): JSX.Element {
  return (
    <>
      {shell.notices.map((n) => (
        <NotificationItem
          key={n.id}
          title={n.title}
          description={n.detail}
          time={n.at === null || shell.now === null ? 'To do' : since(n.at, shell.now)}
          unread
          href={n.href}
          {...(n.person === null
            ? {
                icon:
                  n.kind === 'missing' ? (
                    <icons.person aria-hidden />
                  ) : n.kind === 'viewed' ? (
                    <icons.visible aria-hidden />
                  ) : (
                    <icons.approve aria-hidden />
                  ),
                tone: 'warning' as const,
              }
            : { avatar: <Avatar name={n.person} size="lg" /> })}
        />
      ))}
    </>
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
            description: `In ${s.label}`,
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
              label: `Create… ${create.label}`,
              group: 'Actions',
              icon: iconOf('add'),
              keywords: ['new', 'add'],
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
              label: 'Export people',
              group: 'Actions',
              icon: iconOf('export'),
              keywords: ['download', 'csv'],
              onSelect: () => {
                router.push('/people/export');
              },
            },
          ]
        : []),
      {
        id: 'theme',
        label: dark ? 'Switch to light mode' : 'Switch to dark mode',
        group: 'Actions',
        icon: iconOf('themeDark'),
        keywords: ['theme', 'dark', 'light'],
        onSelect: () => {
          onTheme(!dark);
        },
      },
      {
        id: 'sidebar',
        label: 'Collapse or expand the sidebar',
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
        label: 'Show keyboard shortcuts',
        group: 'Actions',
        icon: iconOf('shortcuts'),
        keywords: ['keys', 'hotkeys'],
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
            label: `End viewing as ${viewing}`,
            group: `Viewing as ${viewing}`,
            icon: iconOf('close'),
            keywords: ['view as', 'stop', 'exit'],
            ...(viewKeys.length === 0 ? {} : { shortcut: viewKeys }),
            onSelect: endViewing,
          },
        ];

  const items = [
    ...filterCommands(back, query),
    ...found.map((p): CommandItem => ({
      id: `person:${p.value}`,
      label: p.label,
      group: 'People you can see',
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
      label="Search people and pages"
      placeholder="Search people and pages"
      items={items}
      filter={false}
      loading={loading}
      onQueryChange={setQuery}
      empty="Nobody and nothing by that name."
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
              End viewing as {person.name}
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
            My profile
            {hint('/people/me') === undefined ? null : (
              <DropdownMenuShortcut className="flex">{hint('/people/me')}</DropdownMenuShortcut>
            )}
          </Link>
        </DropdownMenuItem>
        {/* Not a link until the company has time off: an item that 404s says less than a disabled one. */}
        {timeOff ? (
          <DropdownMenuItem asChild>
            <Link href="/time-off">
              <icons.calendar />
              My time off
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <icons.calendar />
            My time off
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={openHelp}>
          <icons.shortcuts />
          Keyboard shortcuts
          {prefs.characterKeys ? (
            <DropdownMenuShortcut className="flex">
              <KbdShortcut keys={table.find((s) => s.id === 'help')?.keys ?? []} />
            </DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <icons.adjust />
            Preferences
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <ThemeChoice dark={dark} onChange={onTheme} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        {/* The session knows one company: it is listed, ticked, so the menu says where you are. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <icons.company />
            Switch company
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuLabel>Your companies</DropdownMenuLabel>
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
          Sign out
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
      Dark mode
    </DropdownMenuCheckboxItem>
  );
}

/**
 * The account, for a screen with no sidebar: settings, the theme and signing
 * out, behind the person's avatar in a phone's title bar.
 */
export function AccountSheet({
  person,
}: {
  readonly person: AppShellProps['person'];
}): JSX.Element {
  const [dark, setTheme] = useTheme();
  const pathname = usePathname();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative tap-target rounded-full p-0"
          aria-label="Your account"
        >
          <Avatar name={person.name} size="md" />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="pb-safe-bottom">
        <SheetHeader>
          <SheetTitle>{person.name}</SheetTitle>
          <SheetDescription>
            {person.viewing == null
              ? (person.email ?? person.name)
              : `Viewing as ${person.name.split(' ')[0] ?? person.name} · read-only`}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {person.viewing == null ? null : (
            <Button
              variant="primary"
              fullWidth
              startIcon={<icons.close />}
              className="mb-2"
              onClick={endViewing}
            >
              End viewing as {person.name}
            </Button>
          )}
          <Nav label="Account">
            <NavList>
              <NavItem asChild icon={<Settings />} current={isCurrent('/settings', pathname)}>
                <Link href="/settings">Settings</Link>
              </NavItem>
            </NavList>
          </Nav>
          {/* The same switch as the menu at a desk: on is dark. */}
          <Field orientation="horizontal" className="mt-2 items-center justify-between gap-4 px-3">
            <FieldLabel>Dark mode</FieldLabel>
            <FieldControl>
              <Switch checked={dark} onCheckedChange={setTheme} />
            </FieldControl>
          </Field>
          <form action="/auth/sign-out" method="post" className="mt-1 w-full">
            <Button
              type="submit"
              variant="ghost"
              fullWidth
              startIcon={<SignOut />}
              className="justify-start"
            >
              Sign out
            </Button>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
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
 * Home, People, Inbox and Me. People opens the section list (the sidebar's
 * menu, as a page); Inbox is what the bell holds; Me is their own record.
 * Areas that are not built yet are left off here rather than disabled: five
 * slots is the ceiling, and a dead tab costs one of them.
 */
function MobileTabs({
  areas,
  inbox,
}: {
  readonly areas: typeof AREAS;
  readonly inbox: number;
}): JSX.Element {
  const pathname = usePathname();
  const people = areas.some((a) => a.href === '/people');
  const tabs: readonly {
    href: string;
    label: string;
    icon: JSX.Element;
    current: boolean;
    count?: number;
  }[] = [
    { href: '/', label: 'Home', icon: <Home />, current: pathname === '/' },
    ...(people
      ? [
          {
            href: '/people/menu',
            label: 'People',
            icon: <People />,
            current: isCurrent('/people', pathname) && !isCurrent('/people/me', pathname),
          },
          {
            href: '/inbox',
            label: 'Inbox',
            icon: <icons.inbox />,
            current: pathname === '/inbox',
            count: inbox,
          },
          {
            href: '/people/me',
            label: 'Me',
            icon: <icons.person />,
            current: isCurrent('/people/me', pathname),
          },
        ]
      : []),
  ];
  return (
    <TabBar label="Main, compact" className="border-0 bg-transparent p-0 shadow-none">
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
