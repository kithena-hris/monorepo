import {
  Alert,
  AppBarBack,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbMenu,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Badge,
  Button,
  PageHeaderFrame,
  Stack,
  TertiaryNav,
  icons,
  type IconName,
} from '@reach/ui';
import { Fragment, createElement, type ComponentType, type JSX, type ReactNode } from 'react';

/**
 * What the host puts in a screen's header: where the screen is, and the
 * actions the viewer may start from it. Plain data, because it crosses into
 * the remote as JSON.
 *
 * The host decides which of the manifest's places this viewer's roles open;
 * the screen draws them in its own `PageHeader`, so a page opens with one
 * header rather than the host's row above the screen's.
 */
export interface Frame {
  /** The screen's section, for a trail of People › section. None on People's front page. */
  readonly section?: string | null;
  /**
   * The links before the section, root first. Absent, it is People alone; a
   * settings screen is Settings › People › section.
   */
  readonly trail?: readonly { readonly href: string; readonly label: string }[];
  /**
   * The sections, grouped: the section's crumb becomes a menu of them, so the
   * next section over is one step away. Absent, it is plain text. `icon` is a
   * Reach icon name; `count` is what needs action there.
   */
  readonly siblings?: readonly {
    readonly label: string;
    readonly items: readonly {
      readonly href: string;
      readonly label: string;
      readonly current?: boolean;
      readonly icon?: string;
      readonly count?: number;
    }[];
  }[];
  /** What the siblings are, for a screen reader: "People sections". */
  readonly siblingsLabel?: string;
  /** What the address asked for and People refused; the page is shown without it. */
  readonly notice?: string;
  /**
   * The umbrella page's tabs this viewer may open, in order, each its own URL.
   * Drawn under the screen's header, so a screen never draws its own. Absent:
   * no tabs.
   */
  readonly tabs?: readonly {
    readonly href: string;
    readonly label: string;
    /** Its label as a pill under a finger, where one is shorter: "Access". */
    readonly short?: string;
    readonly current: boolean;
    readonly count?: number;
  }[];
  readonly actions?: readonly {
    readonly href: string;
    readonly label: string;
    /** A Reach icon name, drawn before the label. */
    readonly icon?: string;
  }[];
}

/**
 * Where a phone's back link goes: the last link of the trail, except that
 * People itself is the People tab's list of sections rather than its overview.
 */
function phoneBack(
  trail: readonly { readonly href: string; readonly label: string }[],
): { readonly href: string; readonly label: string } | undefined {
  const last = trail.at(-1);
  return last?.href === '/people' ? { href: '/people/menu', label: last.label } : last;
}

/** A Reach icon by name; an unknown name draws nothing rather than failing. */
function iconOf(name: string | undefined): ReactNode {
  return name !== undefined && name in icons
    ? createElement(icons[name as IconName], { 'aria-hidden': true })
    : undefined;
}

/** What needs action in a section, as the sidebar shows it: approvals urgent, the rest a warning. */
function countOf(href: string, count: number | undefined): ReactNode {
  return count === undefined ? undefined : (
    <Badge size="xs" variant="solid" tone={href.endsWith('/approvals') ? 'danger' : 'warning'}>
      {count}
      <span className="sr-only"> waiting</span>
    </Badge>
  );
}

/**
 * The host's frame around a screen: its breadcrumb (a phone's bar under a
 * finger), its actions, and an umbrella page's tabs.
 *
 * At a desk the trail ends in two switchers on an umbrella page, "People ›
 * Data health ▾ › Duplicates ▾": the section's menu lists the sections and,
 * under "In Data health", its tabs, the one you are on ticked; the tab's lists
 * the tabs. Under a finger the bar's title is the section's switcher, each
 * section with its icon and count, and the tabs are a row of pills.
 */
export function ScreenFrame({
  frame,
  children,
}: {
  readonly frame: Frame;
  readonly children: ReactNode;
}): JSX.Element {
  const {
    section = null,
    actions = [],
    trail = [{ href: '/people', label: 'People' }],
    siblings = [],
    siblingsLabel = 'Sections',
    tabs = [],
    notice,
  } = frame;
  const tab = tabs.find((t) => t.current);
  const withIcons = siblings.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, icon: iconOf(item.icon) })),
  }));
  return (
    <PageHeaderFrame
      // A switcher in the phone's bar names the page; the large title would repeat it.
      quietTitleOnTouch={section !== null && siblings.length > 0}
      tabs={
        tabs.length === 0 ? undefined : (
          <TertiaryNav
            label={`${section ?? 'Page'} tabs`}
            orientation="horizontal"
            variant="line"
            current="page"
            touchLayout="pills"
            {...(tab === undefined ? {} : { activeId: tab.href })}
            items={tabs.map((t) => ({
              id: t.href,
              href: t.href,
              label: t.label,
              ...(t.short === undefined ? {} : { shortLabel: t.short }),
              ...(t.count === undefined ? {} : { count: t.count }),
            }))}
          />
        )
      }
      breadcrumb={
        section === null ? undefined : (
          <>
            {/* At a desk, the trail; its last crumb switches to a sibling. */}
            <Breadcrumb className="touch:hidden">
              <BreadcrumbList>
                {trail.map((link) => (
                  <Fragment key={`${link.href} ${link.label}`}>
                    <BreadcrumbItem>
                      <BreadcrumbLink href={link.href}>{link.label}</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </Fragment>
                ))}
                <BreadcrumbItem>
                  {siblings.length === 0 ? (
                    tab === undefined ? (
                      <BreadcrumbPage>{section}</BreadcrumbPage>
                    ) : (
                      <span className="font-medium text-fg-muted">{section}</span>
                    )
                  ) : (
                    <BreadcrumbMenu
                      label={section}
                      current={tab === undefined}
                      menuLabel={siblingsLabel}
                      groups={
                        tab === undefined
                          ? withIcons
                          : [
                              ...withIcons,
                              {
                                label: `In ${section}`,
                                items: tabs.map((t) => ({
                                  href: t.href,
                                  label: t.label,
                                  current: t.current,
                                })),
                              },
                            ]
                      }
                    />
                  )}
                </BreadcrumbItem>
                {tab === undefined ? null : (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbMenu
                        label={tab.label}
                        menuLabel={`${section} tabs`}
                        groups={[
                          {
                            label: section,
                            items: tabs.map((t) => ({
                              href: t.href,
                              label: t.label,
                              current: t.current,
                            })),
                          },
                        ]}
                      />
                    </BreadcrumbItem>
                  </>
                )}
              </BreadcrumbList>
            </Breadcrumb>
            {/*
              Under a finger, a phone's navigation bar: back to the parent,
              and the section as a small title that is itself the switcher,
              opening its siblings as a sheet. The screen's heading below it
              is the large title.
            */}
            <nav
              aria-label="Back"
              className="-mt-1 hidden min-h-12 items-center gap-2 touch:grid touch:grid-cols-[6rem_minmax(0,1fr)_6rem]"
            >
              <AppBarBack asChild className="max-w-full min-w-0 justify-self-start">
                <a href={phoneBack(trail)?.href ?? '/people/menu'}>
                  {phoneBack(trail)?.label ?? 'People'}
                </a>
              </AppBarBack>
              <div className="flex min-w-0 justify-center">
                {siblings.length === 0 ? (
                  <span className="truncate text-md font-semibold">{section}</span>
                ) : (
                  <BreadcrumbMenu
                    variant="title"
                    label={section}
                    groups={siblings.map((group) => ({
                      ...group,
                      items: group.items.map((item) => ({
                        ...item,
                        icon: iconOf(item.icon),
                        badge: countOf(item.href, item.count),
                      })),
                    }))}
                    menuLabel={`${siblingsLabel}, switch`}
                  />
                )}
              </div>
              <span />
            </nav>
          </>
        )
      }
      // Under a finger the actions are the phone bar's, top right, as icons.
      touchBarActions
      actions={
        actions.length === 0
          ? undefined
          : actions.map((a) => (
              <Fragment key={a.href}>
                <Button
                  variant="primary"
                  asChild
                  startIcon={iconOf(a.icon)}
                  className="touch:hidden"
                  // A page's action is what C makes there (the shell's `create`).
                  shortcut="create"
                >
                  <a href={a.href}>{a.label}</a>
                </Button>
                <Button
                  size="xs"
                  asChild
                  startIcon={iconOf(a.icon)}
                  className="hidden touch:inline-flex"
                >
                  {a.icon === undefined ? (
                    <a href={a.href}>{a.label}</a>
                  ) : (
                    <a href={a.href} aria-label={a.label} />
                  )}
                </Button>
              </Fragment>
            ))
      }
    >
      {notice === undefined ? (
        children
      ) : (
        // Said, not swallowed: the link asked for something it cannot have.
        <Stack gap={4}>
          <Alert tone="warning" title={notice}>
            Showing the page without it.
          </Alert>
          {children}
        </Stack>
      )}
    </PageHeaderFrame>
  );
}

/** A screen with the host's frame applied to its header. Links are plain: the host follows them. */
export function framed<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P & { readonly frame?: Frame }> {
  function Framed({ frame, ...props }: P & { readonly frame?: Frame }): JSX.Element {
    const screen = <Screen {...(props as P)} />;
    if (frame === undefined) return screen;
    return <ScreenFrame frame={frame}>{screen}</ScreenFrame>;
  }
  Framed.displayName = `Framed(${Screen.displayName ?? Screen.name})`;
  return Framed;
}
