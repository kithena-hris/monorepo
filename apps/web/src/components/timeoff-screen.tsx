'use client';

import { Skeleton } from '@reach/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition, type JSX } from 'react';

import * as settings from '../app/(app)/settings/time-off/actions';
import * as actions from '../app/(app)/time-off/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { AREAS, matchPath, remotePath } from '../lib/remotes';
import { areaFrame } from '../lib/shell-data';
import { noteInAddress, withQuery, type HistoryMode } from '../lib/url-state';
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
  /** A navigation the screen asks for: client-side, the page where it was. */
  const go = (to: string, mode: HistoryMode = 'push'): void => {
    if (mode === 'push') router.push(to, { scroll: false });
    else router.replace(to, { scroll: false });
  };
  const loadable =
    load.status === 'ready'
      ? { status: 'ready' as const, data: load.data }
      : load.status === 'error'
        ? { status: 'error' as const, message: load.message, retry: refresh }
        : { status: 'loading' as const };
  /** Another view in the address (a path, a query patch), followed client-side so the server reads it. */
  const goTo = (patch: Readonly<Record<string, string | null>>, path?: string): void => {
    startTransition(() => {
      const to = withQuery(path ?? window.location.pathname, window.location.search, patch);
      router.push(to, { scroll: false });
    });
  };

  const props = ((): Record<string, unknown> => {
    switch (route?.component) {
      case 'Overview':
        return { load: loadable, onPunch: actions.punch };
      case 'ParentalPlan':
        return {
          load: loadable,
          onPreview: actions.parentalEntitlement,
          onAnswer: actions.answerParental,
          onBlocks: actions.editParentalBlocks,
          onHandover: actions.saveParentalHandover,
          onSend: actions.sendParentalPlan,
          onBirth: actions.recordParentalBirth,
          onNavigate: go,
        };
      case 'ParentalCase':
        return {
          load: loadable,
          onApprove: actions.approveParentalPlan,
        };
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
      // The employee's screens (TOF-062 to TOF-067).
      case 'RequestTimeOff':
        return {
          load: loadable,
          // What is asked lives in the address; the server asks Time Off again.
          onAsk: (patch: Readonly<Record<string, string | null>>, mode: HistoryMode) => {
            go(withQuery(window.location.pathname, window.location.search, patch), mode);
          },
          onSend: actions.sendRequest,
          onNavigate: go,
        };
      case 'MyRequestsUpcoming':
      case 'MyRequestsPast':
      case 'MyRequestsCancelled':
      case 'RequestDetail':
        return {
          load: loadable,
          onCancel: actions.cancelRequest,
          onChange: actions.changeRequest,
          onShorten: actions.shortenRequest,
          onAnswer: actions.answerSuggestion,
        };
      case 'Balance':
        return { load: loadable };
      case 'Holidays':
        return { load: loadable, onNavigate: go, onSubscribe: actions.subscribeToCalendar };
      // TOF-074 to TOF-077: attendance.
      case 'Timesheet':
        return { load: loadable, onCorrect: actions.correctPunch };
      case 'TeamNow':
      case 'Exceptions':
      case 'ParentalCases':
        return { load: loadable };
      // What the nudge includes and whether it is open are the address.
      case 'Insights':
        return {
          load: loadable,
          onAsk: (patch: Readonly<Record<string, string | null>>) => {
            goTo(patch);
          },
          onSendNudges: actions.sendNudges,
        };
      case 'AttendanceRequests':
        return { load: loadable, onDecide: actions.decideOvertime };
      case 'PayPeriod':
        return {
          load: loadable,
          onClose: actions.closePayPeriod,
          onRemind: actions.remindPayPeriod,
        };
      // Settings (TOF-078 to TOF-083).
      case 'LeaveTypes':
        return {
          load: loadable,
          onAsk: (patch: Readonly<Record<string, string | null>>) => {
            goTo(patch);
          },
          onAdd: settings.addLeaveType,
          onNavigate: go,
          onSaveParentalCompany: settings.saveParentalCompany,
        };
      case 'LeaveType':
        return {
          load: loadable,
          onSaveDraft: settings.savePolicyDraft,
          onPublish: settings.publishPolicy,
          onShadow: settings.shadowRun,
          onStartPolicy: settings.startPolicy,
          onPolicy: (policy: string) => {
            goTo({ policy, as: null });
          },
          onPreviewAs: (as: string) => {
            goTo({ as });
          },
        };
      case 'NegativeBalance':
        return { load: loadable, onSave: settings.saveNegativeBalance };
      case 'AttendanceSettings':
        return { load: loadable, onSave: settings.saveAttendanceRules };
      case 'ApprovalSettings':
        return { load: loadable, onSave: settings.saveApprovals };
      case 'HolidaySettings':
        return {
          load: loadable,
          onYear: (year: number) => {
            goTo({}, `/settings/time-off/holidays/${String(year)}`);
          },
          onAsk: (patch: Readonly<Record<string, string | null>>) => {
            goTo(patch);
          },
          onSaveCalendar: settings.saveHolidayCalendar,
          onRemoveCalendar: settings.removeHolidayCalendar,
          onAssign: settings.assignHolidayCalendars,
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
      props={{
        ...props,
        // What the address asked for and Time Off refused, said above the page.
        frame:
          load.status === 'ready' && load.notice !== undefined
            ? { ...frame, notice: load.notice }
            : frame,
      }}
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
