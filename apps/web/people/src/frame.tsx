import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
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
  readonly actions?: readonly { readonly href: string; readonly label: string }[];
}

/** A screen with the host's frame applied to its header. Links are plain: the host follows them. */
export function framed<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P & { readonly frame?: Frame }> {
  function Framed({ frame, ...props }: P & { readonly frame?: Frame }): JSX.Element {
    const screen = <Screen {...(props as P)} />;
    if (frame === undefined) return screen;
    const { section = null, actions = [], trail = [{ href: '/people', label: 'People' }] } = frame;
    return (
      <PageHeaderFrame
        breadcrumb={
          section === null ? undefined : (
            // A phone has the host's section select in its place.
            <Breadcrumb className="max-md:hidden">
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
                  <BreadcrumbPage>{section}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
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
