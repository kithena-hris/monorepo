'use client';

import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  KithenaLogo,
  Nav,
  NavGroup,
  NavItem,
  NavList,
  PageLayout,
  TooltipProvider,
} from '@reach/ui';
import { icons } from '@reach/ui';
import type { JSX, ReactNode } from 'react';

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
  readonly children: ReactNode;
}

/**
 * What a person can reach today, and what is coming.
 *
 * Only the dashboard is built. The rest are listed as disabled rather than
 * hidden, because a sidebar that grows an item per release teaches nobody where
 * anything lives — and each one maps to a module in `ModuleKey`, so this list is
 * the product's shape rather than a guess at one.
 */
const AREAS = [
  { label: 'Home', icon: <Home />, href: '/', current: true },
  { label: 'Time off', icon: <Leave />, href: '/time-off', current: false },
  { label: 'People', icon: <People />, href: '/people', current: false },
  { label: 'Documents', icon: <Document />, href: '/documents', current: false },
] as const;

export function AppShell({ person, companyName, children }: AppShellProps): JSX.Element {
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
        contentClassName="px-6 py-8"
        sidebar={
          <div
            // The expanded width lives here, not in PageLayout: its grid column
            // is `auto`, so the rail is as wide as whatever it is given. The
            // collapsed width is the layout's own `md:w-14`, which is why this
            // one drops away once the rail is collapsed.
            className="flex h-full w-60 flex-col gap-4 p-3 group-data-[collapsed]/sidebar:w-auto group-data-[collapsed]/sidebar:p-2"
          >
            <KithenaLogo className="text-fg px-2 pt-1" />

            <Nav label="Areas" className="flex-1">
              <NavList>
                {AREAS.map((area) => (
                  <NavItem
                    key={area.label}
                    href={area.href}
                    icon={area.icon}
                    current={area.current}
                    // Not yet built. Disabled rather than absent: a link that
                    // 404s is worse than one that says "not yet".
                    {...(area.current ? {} : { 'aria-disabled': true, tabIndex: -1 })}
                  >
                    {area.label}
                  </NavItem>
                ))}
              </NavList>

              <NavList className="mt-4">
                <NavGroup label={companyName}>
                  <NavList level={2}>
                    <NavItem
                      level={2}
                      href="/settings"
                      icon={<Settings />}
                      aria-disabled
                      tabIndex={-1}
                    >
                      Settings
                    </NavItem>
                  </NavList>
                </NavGroup>
              </NavList>
            </Nav>

            <PersonMenu person={person} />
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
function PersonMenu({ person }: { person: AppShellProps['person'] }): JSX.Element {
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
