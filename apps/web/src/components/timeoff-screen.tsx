'use client';

import { Skeleton } from '@reach/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type JSX } from 'react';

import * as actions from '../app/(app)/time-off/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { AREAS, matchPath, remotePath } from '../lib/remotes';
import { areaFrame } from '../lib/shell-data';
import { noteInAddress } from '../lib/url-state';
import { useShellData } from './app-shell';
import { RemoteScreen, remoteLoaded, type RemoteRoute } from './remote-screen';

/**
 * A Time Off screen's props, from what the server fetched and the actions
 * that call Time Off (TOF-060), as `people-screen.tsx` is People's.
 *
 * The one place the shell knows each Time Off screen's prop names. It adds
 * nothing to the data: the `Loadable` is the server's answer as it arrived,
 * and every callback is a server action or a navigation. A screen with no
 * case here is drawn with its frame alone.
 */
export interface TimeOffScreenProps {
  readonly route: RemoteRoute | null;
  readonly load: ScreenLoad | { readonly status: 'loading' };
  /** The screen's header from the area's places (`areaFrame`), as JSON. */
  readonly frame: ReturnType<typeof areaFrame>;
}

export function TimeOffScreen({ route, load, frame }: TimeOffScreenProps): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const live = useSearchParams();
  const [, startTransition] = useTransition();
  const refresh = (): void => {
    startTransition(() => {
      router.refresh();
    });
  };
  const go = (href: string): void => {
    router.push(href, { scroll: false });
  };
  const loadable =
    load.status === 'ready'
      ? { status: 'ready' as const, data: load.data }
      : load.status === 'error'
        ? { status: 'error' as const, message: load.message, retry: refresh }
        : { status: 'loading' as const };

  const props = ((): Record<string, unknown> => {
    switch (route?.component) {
      case 'Overview':
        return { load: loadable, onPunch: actions.punch };
      // The manager's (TOF-068 to TOF-073). Which tab, request or view is the
      // address; a month, a scope or a clash is a navigation Time Off answers,
      // and the types, holidays and day open are noted in the address only.
      case 'Approvals':
        return {
          load: loadable,
          path: pathname,
          onApprove: actions.approveRequests,
          onDecide: actions.decideRequest,
          onSuggest: actions.suggestDates,
          onNavigate: go,
        };
      case 'Delegation':
        return {
          load: loadable,
          onSave: actions.setDelegation,
          onRemove: actions.removeDelegation,
        };
      case 'TeamCalendar':
        return {
          load: loadable,
          path: pathname,
          query: Object.fromEntries(live),
          onNavigate: go,
          onFilter: (patch: Readonly<Record<string, string | null>>) => {
            noteInAddress(patch, 'push');
          },
          onSubscribe: actions.subscribeCalendar,
          onSuggest: actions.suggestDates,
          onDecide: actions.decideRequest,
        };
      default:
        return {};
    }
  })();

  return (
    <RemoteScreen
      name={AREAS.timeoff.name}
      area={AREAS.timeoff.label}
      route={route}
      props={{ ...props, frame }}
      // Drawn in the browser, the screen is its header's shape until it is.
      fallback={
        <Skeleton
          shape="page"
          label="Loading Time off"
          breadcrumb={frame.section !== null}
          tabs={frame.tabs?.length ?? 0}
        />
      }
    />
  );
}

/**
 * A Time Off page while it is fetched (`PageLoading`): the screen itself in
 * its loading state, so each draws its own skeleton in its exact shape under
 * the real header. Before the remote's code is in the page, the page
 * skeleton with that header's shape.
 */
export function TimeOffLoading(): JSX.Element {
  const shell = useShellData();
  const pathname = usePathname();
  const places = shell.remotes?.[AREAS.timeoff.name];
  const matched = places === undefined ? undefined : matchPath(places.routes, pathname);
  const frame = areaFrame(AREAS.timeoff, matched?.path ?? null, places);
  const component = matched === undefined ? undefined : places?.screens?.[matched.path];
  const entry = `${remotePath(AREAS.timeoff)}/remoteEntry.js`;
  if (component === undefined || !remoteLoaded(entry)) {
    return (
      <Skeleton
        shape="page"
        label="Loading Time off"
        breadcrumb={frame.section !== null}
        tabs={frame.tabs?.length ?? 0}
      />
    );
  }
  return <TimeOffScreen route={{ entry, component }} load={{ status: 'loading' }} frame={frame} />;
}
