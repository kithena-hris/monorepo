'use client';

import {
  Avatar,
  Button,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  KithenaLogo,
  Nav,
  NavItem,
  NavList,
  PageLayout,
  TooltipProvider,
} from '@reach/ui';
import { icons } from '@reach/ui';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type JSX, type ReactNode } from 'react';

import { THEME_KEY } from '../lib/theme';

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
const ThemeLight = icons.theme;

/**
 * The signed-in shell: sidebar, content, and the person at the bottom of it.
 *
 * `PageLayout` owns the grid, the collapsed rail and the `⌘B` shortcut, and
 * `Nav` owns the list semantics — `<ul>`/`<li>` so a screen reader announces
 * how much navigation there is, and `aria-current="page"` on the current item
 * rather than a colour. Neither is re-implemented here, which is the whole
 * point of them existing.
 */
export interface AppShellProps {
  readonly person: { readonly name: string; readonly email: string | null };
  readonly companyName: string;
  /** The company's mark, shown above the areas when they have uploaded one. */
  readonly logoUrl?: string | null;
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
const AREAS = [
  { label: 'Home', icon: <Home />, href: '/', built: true },
  { label: 'Time off', icon: <Leave />, href: '/time-off', built: false },
  { label: 'People', icon: <People />, href: '/people', built: true },
  { label: 'Documents', icon: <Document />, href: '/documents', built: false },
] as const;

/** An area owns its whole subtree; home owns only itself. */
function isCurrent(href: string, pathname: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Light or dark, for whatever in this shell offers it.
 *
 * Read from the DOM rather than from storage, because the inline script in the
 * root layout may have honoured a stored choice that disagrees with the system
 * preference — and reading anything else would show the wrong state on the
 * control that sets it.
 */
function useTheme(): readonly [boolean, (next: boolean) => void] {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  return [
    dark,
    (next: boolean) => {
      setDark(next);
      document.documentElement.classList.toggle('dark', next);
      // `try`, because Safari's private mode throws on write — and a theme that
      // cannot be remembered is not a reason to break the control.
      try {
        localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
      } catch {
        /* not remembered, still applied */
      }
    },
  ] as const;
}

export function AppShell({
  person,
  companyName,
  logoUrl = null,
  children,
}: AppShellProps): JSX.Element {
  const [dark, setTheme] = useTheme();
  const pathname = usePathname();
  /*
   * `TooltipProvider` wraps the whole shell, not just the sidebar.
   *
   * `NavItem` renders a `Tooltip` when the rail is collapsed — that is how a
   * destination keeps its name when the label is gone — and Radix throws
   * without a provider above it. It is a hard error at render rather than a
   * type error, which is why building and typechecking both passed and the
   * page still 500'd.
   */
  return (
    <TooltipProvider>
      <PageLayout
        // Without this the grid is a single column and the sidebar renders
        // across the whole page: `hasSidebar` is true the moment one is
        // passed, but the column template comes from `preset`, which defaults
        // to `stacked`.
        preset="sidebar"
        sidebarCollapse={{ mode: 'rail', defaultCollapsed: false }}
        /*
          Below `md` the sidebar is gone — `PageLayout` hides it, because a
          240px rail on a 390px screen is most of the screen. Without a
          replacement that left a phone with a page and no way off it, which is
          what "the sidebar is gone" looked like.

          Tabs rather than a hamburger: the destinations are four, they fit, and
          a bar that is always on screen costs one tap where a drawer costs two
          and hides where you are. It is the pattern every app on the device
          already uses, which is the argument for it.
        */
        bottomBar={<MobileTabs person={person} dark={dark} onTheme={setTheme} />}
        bottomBarClassName="md:hidden"
        contentClassName="px-6 py-8"
        /*
          The company's mark where theirs exists, ours where it does not.

          Not both. This is the top-left of an employee's own workplace tool and
          the question it answers is "whose account am I in" — a person signing
          in to Acme should see Acme. Kithena is the vendor, and a vendor's mark
          stacked above a customer's is an advertisement in a place that is
          supposed to be orienting.

          In `sidebarHeader` rather than inside the sidebar itself, so it shares
          the row with the collapse control instead of sitting under a strip of
          empty chrome. The name collapses with the rail; the mark survives,
          which is what the 3.5rem column has room for.
        */
        sidebarHeader={
          logoUrl === null ? (
            <KithenaLogo className="text-fg h-6 w-auto shrink-0" />
          ) : (
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar size="md" shape="rounded" fit="contain" src={logoUrl} name={companyName} />
              <span className="truncate text-sm font-semibold group-data-[collapsed]/sidebar:hidden">
                {companyName}
              </span>
            </div>
          )
        }
        sidebar={
          <div
            // The expanded width lives here, not in PageLayout: its grid column
            // is `auto`, so the rail is as wide as whatever it is given. The
            // collapsed width is the layout's own `md:w-14`, which is why this
            // one drops away once the rail is collapsed.
            // `min-h-0` matters more than it looks. A flex child's default
            // `min-height: auto` refuses to shrink below its content, so the
            // scrolling region below would grow the column instead of
            // scrolling and the whole sidebar — profile included — would move
            // off-screen together.
            className="flex h-full min-h-0 w-60 flex-col gap-4 p-3 group-data-[collapsed]/sidebar:w-auto group-data-[collapsed]/sidebar:p-2"
          >
            {/*
              The areas scroll; the mark above and the person below do not.

              `flex-1 min-h-0 overflow-y-auto` rather than letting the column
              grow: with enough modules switched on this list is taller than the
              viewport, and a sidebar that scrolls as one piece takes the
              profile and sign-out with it — so the control somebody reaches for
              to leave is the one that disappears first. Pinning the ends and
              scrolling the middle keeps both reachable at any height.
            */}
            <Nav label="Areas" className="min-h-0 flex-1 overflow-y-auto">
              <NavList>
                {AREAS.map((area) => (
                  <NavItem
                    key={area.label}
                    href={area.href}
                    icon={area.icon}
                    current={isCurrent(area.href, pathname)}
                    // Not yet built. Disabled rather than absent: a link that
                    // 404s is worse than one that says "not yet".
                    {...(area.built ? {} : { 'aria-disabled': true, tabIndex: -1 })}
                  >
                    {area.label}
                  </NavItem>
                ))}
              </NavList>
            </Nav>

            {/* Pinned. `shrink-0` so it keeps its height when the list above
                is long, and `mt-auto` so it sits at the bottom when the list is
                short rather than floating under the last item.

                Settings sits here rather than in the scrolling list above: it
                is where you go to change something rather than somewhere you
                work, so it belongs with the account controls and not among the
                areas — and pinned, it stays reachable however many modules a
                company switches on. */}
            <div className="border-border mt-auto flex shrink-0 flex-col gap-3 border-t pt-3">
              <Nav label="Account">
                <NavList>
                  <NavItem href="/settings" icon={<Settings />} aria-disabled tabIndex={-1}>
                    Settings
                  </NavItem>
                </NavList>
              </Nav>
              {/*
                A visible control, not only an item inside the profile menu.

                It was in the menu alone, which opens on hovering the person's
                name at the very bottom of the sidebar — something somebody has
                to already know about to find. A preference nobody can see is a
                preference nobody has.

                A `Button`, not a `NavItem`: this changes something rather than
                going somewhere, and `NavItem` renders an anchor. `asChild` on
                it would be the obvious way round that and does not work —
                `Slot` needs a single child and `NavItem` gives it an icon, a
                label and a badge slot.
              */}
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                aria-pressed={dark}
                startIcon={dark ? <ThemeLight /> : <ThemeDark />}
                className="justify-start group-data-[collapsed]/sidebar:hidden"
                onClick={() => {
                  setTheme(!dark);
                }}
              >
                {dark ? 'Light mode' : 'Dark mode'}
              </Button>

              <PersonMenu person={person} dark={dark} onTheme={setTheme} />
            </div>
          </div>
        }
      >
        {children}
      </PageLayout>
    </TooltipProvider>
  );
}

/**
 * The person, at the end of the sidebar.
 *
 * Opens on hover **and** on click and keyboard. Hover alone would put signing
 * out behind a gesture a keyboard cannot make and a touch screen does not have
 * — which is also why this is a menu rather than a `HoverCard`, whose content
 * Radix documents as non-essential. Signing out is not non-essential.
 *
 * Sign-out is a form rather than a link. It changes server state, and a `GET`
 * that ends a session is one a prefetcher or a link scanner can fire.
 */
function PersonMenu({
  person,
  dark,
  onTheme,
}: {
  person: AppShellProps['person'];
  dark: boolean;
  onTheme: (next: boolean) => void;
}): JSX.Element {
  return (
    <DropdownMenu openOnHover>
      <DropdownMenuTrigger className="border-border hover:bg-surface-hover focus-visible:outline-border-focus flex min-h-tap w-full items-center gap-3 rounded-md border px-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2">
        <Avatar name={person.name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{person.name}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="truncate font-normal">
          {person.email ?? person.name}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeChoice dark={dark} onChange={onTheme} />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action="/auth/sign-out" method="post" className="w-full">
            <button type="submit" className="flex w-full items-center gap-2">
              <SignOut />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Light or dark, in the menu where the rest of this person's preferences are.
 *
 * A checkbox item rather than a button in the sidebar: the rail collapses to
 * 3.5rem and a preference is not worth one of the few slots that survive that.
 * It is also where every tool this audience already uses keeps it.
 *
 * `onSelect` is prevented from closing the menu, so somebody can look at the
 * result and change their mind without opening it again — which is most of what
 * anybody does with this control.
 *
 * The state is read from the DOM rather than from storage, because the inline
 * script in the root layout may have honoured a stored choice that disagrees
 * with the system preference. Reading anything else would show the wrong tick.
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
 * The sidebar, for a screen too narrow to hold one.
 *
 * Everything the rail offers is reachable here and nothing is dropped: the four
 * areas are tabs, and the fifth slot opens a sheet holding what the sidebar
 * keeps pinned to its foot — settings, the theme, the person, signing out.
 *
 * Five is the ceiling. A sixth tab on a 390px screen is a 60px target with a
 * clipped word under it, and the thing that gets cut is always the one
 * somebody needs; the sheet is what stops the list growing into the labels.
 */
function MobileTabs({
  person,
  dark,
  onTheme,
}: {
  readonly person: AppShellProps['person'];
  readonly dark: boolean;
  readonly onTheme: (next: boolean) => void;
}): JSX.Element {
  const pathname = usePathname();
  return (
    <nav aria-label="Main, compact" className="flex">
      {AREAS.map((area) => (
        <a
          key={area.label}
          href={area.href}
          aria-current={isCurrent(area.href, pathname) ? 'page' : undefined}
          // Not yet built, like the sidebar's copy of the same list.
          {...(area.built ? {} : { 'aria-disabled': true, tabIndex: -1 })}
          className={`focus-visible:outline-border-focus flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs focus-visible:outline-2 focus-visible:-outline-offset-2 ${
            isCurrent(area.href, pathname) ? 'text-accent-fg' : 'text-fg-muted'
          } ${area.built ? '' : 'opacity-60'}`}
        >
          <span aria-hidden className="[&_svg]:size-5">
            {area.icon}
          </span>
          {area.label}
        </a>
      ))}

      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            className="focus-visible:outline-border-focus text-fg-muted flex min-h-tap flex-1 flex-col items-center justify-center gap-0.5 py-2 text-2xs focus-visible:outline-2 focus-visible:-outline-offset-2"
          >
            <Avatar name={person.name} size="xs" />
            You
          </button>
        </SheetTrigger>

        <SheetContent side="bottom" className="pb-safe-bottom">
          <SheetHeader>
            <SheetTitle>{person.name}</SheetTitle>
            <SheetDescription>{person.email ?? person.name}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            <Nav label="Account">
              <NavList>
                <NavItem href="/settings" icon={<Settings />} aria-disabled tabIndex={-1}>
                  Settings
                </NavItem>
              </NavList>
            </Nav>

            <Button
              variant="ghost"
              fullWidth
              aria-pressed={dark}
              startIcon={dark ? <ThemeLight /> : <ThemeDark />}
              className="mt-2 justify-start"
              onClick={() => {
                onTheme(!dark);
              }}
            >
              {dark ? 'Light mode' : 'Dark mode'}
            </Button>

            {/* A form, not a link, for the same reason as in the sidebar: it
                changes server state, and a `GET` that ends a session is one a
                prefetcher can fire. */}
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
    </nav>
  );
}
