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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PageHeader,
  PageHeaderFrame,
  Stack,
  TertiaryNav,
  TooltipProvider,
  icons,
  type IconName,
} from '@reach/ui';
import {
  Fragment,
  createContext,
  createElement,
  useContext,
  type ComponentType,
  type JSX,
  type ReactNode,
} from 'react';
import { t as tr } from './i18n';

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
  /** The screen's section, for a trail of Documents › section. */
  readonly section?: string | null;
  /**
   * The section's one line, the same on each of its tabs: every screen's
   * header shows it (`Header`), so switching tabs never moves them.
   */
  readonly description?: string;
  /**
   * The links before the section, root first. Absent, it is Documents alone; a
   * settings screen is Settings › Documents › section.
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
  /** What the siblings are, for a screen reader: "Documents sections". */
  readonly siblingsLabel?: string;
  /** What the address asked for and Documents refused; the page is shown without it. */
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
  /**
   * What is under the header is on its way: the host keeps this screen while
   * the tab now marked current is fetched. The header stays; the body is a
   * skeleton until it lands.
   */
  readonly pending?: boolean;
  readonly actions?: readonly {
    readonly href: string;
    readonly label: string;
    /** A Reach icon name, drawn before the label. */
    readonly icon?: string;
    /** Not the page's one thing: in the header's More menu rather than a button. */
    readonly menu?: boolean;
  }[];
}

/** The section and its line, for every screen's `Header`. */
const SectionContext = createContext<{
  readonly section: string | null;
  readonly description: string | null;
}>({ section: null, description: null });

/**
 * A Documents screen's header. A section's screens share one title and one
 * line, its own, so the header is the same height on every tab and the tabs
 * never move; what a view adds ("6 people report to you") goes in its body.
 * A page of its own under a section (a request, a balance, delegation)
 * passes its own `title` and `description`.
 */
export function Header({
  title,
  description,
  fallback,
  meta,
  actions,
}: {
  /** A page of its own: its own title, over the section's. */
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  /** The section's title and line where no host frames the screen (a test, a standalone run). */
  readonly fallback?: { readonly title: string; readonly description?: string };
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
}): JSX.Element {
  const here = useContext(SectionContext);
  return (
    <PageHeader
      title={title ?? here.section ?? fallback?.title ?? ''}
      // Always a line, so a page never grows one when its data lands.
      description={description ?? here.description ?? fallback?.description ?? '\u00a0'}
      {...(meta === undefined ? {} : { meta })}
      {...(actions === undefined ? {} : { actions })}
    />
  );
}

/** Where a phone's back link goes: the last link of the trail, Documents itself by default. */
const phoneBack = (
  trail: readonly { readonly href: string; readonly label: string }[],
): { readonly href: string; readonly label: string } =>
  trail.at(-1) ?? { href: '/documents', label: tr('frame.documents', 'Documents') };

/** A Reach icon by name; an unknown name draws nothing rather than failing. */
function iconOf(name: string | undefined): ReactNode {
  return name !== undefined && name in icons
    ? createElement(icons[name as IconName], { 'aria-hidden': true })
    : undefined;
}

/** What needs action in a section, as the sidebar shows it: requests urgent, the rest a warning. */
function countOf(href: string, count: number | undefined): ReactNode {
  return count === undefined ? undefined : (
    <Badge
      size="xs"
      variant="solid"
      tone={/\/(requests|approvals)\//.test(href) ? 'danger' : 'warning'}
    >
      {count}
      <span className="sr-only"> {tr('frame.waiting', 'waiting')}</span>
    </Badge>
  );
}

/**
 * The host's frame around a screen: its breadcrumb (a phone's bar under a
 * finger), its actions, and an umbrella page's tabs.
 *
 * At a desk the trail ends in two switchers on an umbrella page, "Documents ›
 * Requests ▾ › Decided ▾": the section's menu lists the sections and,
 * under "In Requests", its tabs, the one you are on ticked; the tab's lists
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
    description,
    actions = [],
    trail = [{ href: '/documents', label: tr('frame.documents', 'Documents') }],
    siblings = [],
    siblingsLabel = tr('frame.sections', 'Sections'),
    tabs = [],
    notice,
    pending = false,
  } = frame;
  const tab = tabs.find((t) => t.current);
  // One tab is the page itself: no row for it.
  const shownTabs = tabs.length > 1 ? tabs : [];
  const buttons = actions.filter((a) => a.menu !== true);
  const menu = actions.filter((a) => a.menu === true);
  const withIcons = siblings.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, icon: iconOf(item.icon) })),
  }));
  return (
    <PageHeaderFrame
      // A switcher in the phone's bar names the page; the large title would repeat it.
      quietTitleOnTouch={section !== null && siblings.length > 0}
      pending={pending}
      tabs={
        shownTabs.length === 0 ? undefined : (
          <TertiaryNav
            label={
              section === null
                ? tr('frame.page_tabs', 'Page tabs')
                : tr('frame.tabs', '{{value}} tabs', { value: section })
            }
            orientation="horizontal"
            variant="line"
            current="page"
            touchLayout="pills"
            {...(tab === undefined ? {} : { activeId: tab.href })}
            items={shownTabs.map((t) => ({
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
                                label: tr('frame.in', 'In {{section}}', { section }),
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
                        menuLabel={tr('frame.tabs_2', '{{section}} tabs', { section })}
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
              aria-label={tr('frame.back', 'Back')}
              className="-mt-1 hidden min-h-12 items-center gap-2 touch:grid touch:grid-cols-[6rem_minmax(0,1fr)_6rem]"
            >
              <AppBarBack asChild className="max-w-full min-w-0 justify-self-start">
                <a href={phoneBack(trail).href}>{phoneBack(trail).label}</a>
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
                    menuLabel={tr('frame.switch', '{{siblingsLabel}}, switch', { siblingsLabel })}
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
        actions.length === 0 ? undefined : (
          <>
            {buttons.map((a) => (
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
            ))}
            {menu.length === 0 ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="secondary"
                    aria-label={tr('frame.more', 'More')}
                    startIcon={<icons.more aria-hidden />}
                    className="flex-none! touch:size-11"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  {menu.map((a) => (
                    <DropdownMenuItem key={a.href} asChild>
                      <a href={a.href}>
                        {iconOf(a.icon)}
                        {a.label}
                      </a>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )
      }
    >
      <SectionContext value={{ section, description: description ?? null }}>
        {notice === undefined ? (
          children
        ) : (
          // Said, not swallowed: the link asked for something it cannot have.
          <Stack gap={4}>
            <Alert tone="warning" title={notice}>
              {tr('frame.showing_the_page_without_it', 'Showing the page without it.')}
            </Alert>
            {children}
          </Stack>
        )}
      </SectionContext>
    </PageHeaderFrame>
  );
}

/** A screen with the host's frame applied to its header. Links are plain: the host follows them. */
export function framed<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P & { readonly frame?: Frame }> {
  function Framed({ frame, ...props }: P & { readonly frame?: Frame }): JSX.Element {
    const screen = <Screen {...(props as P)} />;
    // The screen's own tooltip provider. In the browser the shell's surrounds
    // it; on the server the shell renders the screen alone
    // (`lib/remote-renderer.ts`), and a chart's tooltip without one threw,
    // so Insights fell back to the browser (React #419).
    return (
      <TooltipProvider>
        {frame === undefined ? screen : <ScreenFrame frame={frame}>{screen}</ScreenFrame>}
      </TooltipProvider>
    );
  }
  Framed.displayName = tr('frame.framed', 'Framed({{value}})', {
    value: Screen.displayName ?? Screen.name,
  });
  return Framed;
}
