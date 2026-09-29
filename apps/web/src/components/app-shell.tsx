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
  Kbd,
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
  type CommandItem,
} from '@reach/ui';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type JSX,
  type ReactNode,
} from 'react';

import { searchPeople } from '../app/(app)/people/actions';
import { EMPTY_SHELL, type ShellData } from '../lib/shell-data';
import { useInAppLinks } from '../lib/links';
import { matchPath } from '../lib/remotes';
import { SIDEBAR_COOKIE } from '../lib/sidebar';
import { themeCookie } from '../lib/theme';
import { Assistant } from './assistant';
import { iconOf, PeopleSections, PeopleSubnav } from './people-nav';

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
  readonly person: { readonly name: string; readonly email: string | null };
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
 * G then P opens People, and G then M your own profile, from anywhere but a
 * field: the shortcuts the People flyout and the account menu print.
 */
function useGoShortcut(entitled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!entitled) return undefined;
    let armed = 0;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'g') {
        armed = Date.now();
        return;
      }
      const to = key === 'p' ? '/people' : key === 'm' ? '/people/me' : null;
      if (to !== null && Date.now() - armed < 1000) {
        armed = 0;
        router.push(to);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [entitled, router]);
}

export function AppShell({
  person,
  companyName,
  logoUrl = null,
  entitlements,
  shell = EMPTY_SHELL,
  sidebarCollapsed,
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
  useGoShortcut(entitlements.includes('module.people'));
  useInAppLinks();
  /*
   * `TooltipProvider` wraps the whole shell, not just the sidebar.
   *
   * `NavItem` renders a `Tooltip` when the rail is collapsed — that is how a
   * destination keeps its name when the label is gone — and Radix throws
   * without a provider above it.
   */
  return (
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
                  <NavItem asChild icon={<Settings />} current={isCurrent('/settings', pathname)}>
                    <Link href="/settings">Settings</Link>
                  </NavItem>
                </NavList>
              </Nav>
              <PersonMenu
                person={person}
                subtitle={[role, companyName].filter((x) => x !== null).join(' · ')}
                companyName={companyName}
                timeOff={areas.some((a) => a.href === '/time-off' && a.built)}
                dark={dark}
                onTheme={setTheme}
              />
            </div>
          </div>
        }
      >
        <TopCorner shell={shell} />
        {/*
          No boundary here, on purpose: a navigation is a transition and keeps
          this page on screen until the next is ready, and a first load waits
          for the page rather than flashing a stand-in for it.
        */}
        {children}
      </PageLayout>
      <Assistant />
    </TooltipProvider>
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
function TopCorner({ shell }: { readonly shell: ShellData }): JSX.Element {
  const [open, setOpen] = useState(false);
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
        <Kbd keyName="mod" />
        <Kbd>K</Kbd>
      </Button>
      <SearchPalette open={open} onOpenChange={setOpen} shell={shell} />
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

/** ⌘K: pages and people, from one field. */
function SearchPalette({
  open,
  onOpenChange,
  shell,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly shell: ShellData;
}): JSX.Element {
  const router = useRouter();
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
        { path: '/', label: 'Home', icon: 'home', group: 'Pages' },
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
      ].map((p) => ({
        id: 'id' in p ? p.id : p.path,
        label: p.label,
        group: p.group,
        icon: iconOf(p.icon),
        ...('description' in p && p.description !== undefined
          ? { description: p.description }
          : {}),
        onSelect: () => {
          router.push(p.path);
        },
      })),
    [shell, router],
  );

  const items = [
    ...found.map((p): CommandItem => ({
      id: `person:${p.value}`,
      label: p.label,
      group: 'People you can see',
      avatar: <Avatar name={p.label} size="sm" />,
      onSelect: () => {
        router.push(`/people/${p.value}` as Route);
      },
    })),
    ...filterCommands(pages, query),
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
        <DropdownMenuItem asChild>
          <Link href="/people/me">
            <icons.person />
            My profile
            <DropdownMenuShortcut className="flex gap-0.75">
              <Kbd>G</Kbd>
              <Kbd>M</Kbd>
            </DropdownMenuShortcut>
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
          <SheetDescription>{person.email ?? person.name}</SheetDescription>
        </SheetHeader>
        <SheetBody>
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
