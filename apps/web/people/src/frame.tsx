import {
  AppBarBack,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbMenu,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  PageHeaderFrame,
} from '@reach/ui';
import { Fragment, type ComponentType, type JSX } from 'react';

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
   * The section's siblings, grouped: the last crumb becomes a menu of them, so
   * the next section over is one step away. Absent, it is plain text.
   */
  readonly siblings?: readonly {
    readonly label: string;
    readonly items: readonly {
      readonly href: string;
      readonly label: string;
      readonly current?: boolean;
    }[];
  }[];
  /** What the siblings are, for a screen reader: "People sections". */
  readonly siblingsLabel?: string;
  readonly actions?: readonly { readonly href: string; readonly label: string }[];
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

/** A screen with the host's frame applied to its header. Links are plain: the host follows them. */
export function framed<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P & { readonly frame?: Frame }> {
  function Framed({ frame, ...props }: P & { readonly frame?: Frame }): JSX.Element {
    const screen = <Screen {...(props as P)} />;
    if (frame === undefined) return screen;
    const {
      section = null,
      actions = [],
      trail = [{ href: '/people', label: 'People' }],
      siblings = [],
      siblingsLabel = 'Sections',
    } = frame;
    return (
      <PageHeaderFrame
        breadcrumb={
          section === null ? undefined : (
            <>
              {/* At a desk, the trail; its last crumb switches to a sibling. */}
              <Breadcrumb className="touch:hidden">
                <BreadcrumbList>
                  {trail.map((link) => (
                    <Fragment key={link.href}>
                      <BreadcrumbItem>
                        <BreadcrumbLink href={link.href}>{link.label}</BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </Fragment>
                  ))}
                  <BreadcrumbItem>
                    {siblings.length === 0 ? (
                      <BreadcrumbPage>{section}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbMenu label={section} groups={siblings} menuLabel={siblingsLabel} />
                    )}
                  </BreadcrumbItem>
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
                className="-mt-1 hidden min-h-12 items-center gap-2 touch:grid touch:grid-cols-[1fr_auto_1fr]"
              >
                <AppBarBack asChild className="justify-self-start">
                  <a href={phoneBack(trail)?.href ?? '/people/menu'}>
                    {phoneBack(trail)?.label ?? 'People'}
                  </a>
                </AppBarBack>
                {siblings.length === 0 ? (
                  <span className="truncate text-md font-semibold">{section}</span>
                ) : (
                  <BreadcrumbMenu
                    variant="title"
                    label={section}
                    groups={siblings}
                    menuLabel={`${siblingsLabel}, switch`}
                  />
                )}
                <span />
              </nav>
            </>
          )
        }
        actions={
          actions.length === 0
            ? undefined
            : actions.map((a) => (
                <Button key={a.href} variant="primary" asChild>
                  <a href={a.href}>{a.label}</a>
                </Button>
              ))
        }
      >
        {screen}
      </PageHeaderFrame>
    );
  }
  Framed.displayName = `Framed(${Screen.displayName ?? Screen.name})`;
  return Framed;
}
