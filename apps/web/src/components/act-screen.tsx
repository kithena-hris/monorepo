'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useTransition, type JSX } from 'react';

import { onboardingAct } from '../app/(app)/onboarding/actions';
import { performanceAct } from '../app/(app)/performance/actions';
import { recruitingAct, type Done } from '../app/(app)/recruiting/actions';
import type { ScreenLoad } from '../lib/people-screens';
import { AREAS } from '../lib/remotes';
import type { areaFrame } from '../lib/shell-data';
import { withQuery } from '../lib/url-state';
import { useShellData } from './app-shell';
import { RemoteScreen, type RemoteRoute } from './remote-screen';

/**
 * A screen's props for a module that acts through one server action
 * (Recruiting, REC-070; Onboarding, ONB-010), as `documents-screen.tsx` is
 * Documents': the server's answer as it arrived, navigation, and one way to
 * act. Every screen gets the same three, so the shell does not learn each
 * screen's buttons; what Time Off and Documents would show beside a screen
 * (holidays, a signing envelope) is added here when they are present.
 */
export interface ActScreenProps {
  readonly route: RemoteRoute | null;
  readonly load: ScreenLoad | { readonly status: 'loading' };
  readonly frame: ReturnType<typeof areaFrame>;
  /** The address itself, for a screen that is one place per address (Recruiting's settings). */
  readonly path?: string;
  /** The route's own parts (`/jobs/:id/setup`) and the query: what the screen is of. */
  readonly params?: Readonly<Record<string, string>>;
  readonly search?: Readonly<Record<string, string>>;
  /** Drawn inside another page, the Inbox's pane: where its links go instead. */
  readonly embedded?: Embedded;
}

/**
 * A screen drawn inside another page. Each link the screen follows is handed
 * here, saying whether it came straight after a write (a review submitted
 * goes on to the list of reviews): the host decides whether to follow it.
 */
export interface Embedded {
  readonly navigate: (to: string, afterWrite: boolean) => void;
}

/** A link followed this soon after a write is the write's own way on. */
const AFTER_WRITE_MS = 10_000;

type Act = (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;

export const RecruitingScreen = (props: ActScreenProps): JSX.Element => (
  <ActScreen {...props} area="recruiting" act={recruitingAct} />
);

export const OnboardingScreen = (props: ActScreenProps): JSX.Element => (
  <ActScreen {...props} area="onboarding" act={onboardingAct} />
);

export const PerformanceScreen = (props: ActScreenProps): JSX.Element => (
  <ActScreen {...props} area="performance" act={performanceAct} />
);

/**
 * Performance's live screens (PRD §8.7): the page was drawn with the current
 * state, and the cycle stream moves it on by drawing it again, at most once
 * a second. No polling; `EventSource` reconnects by itself.
 */
const LIVE = new Set(['Home', 'Cycles', 'Overview']);

function useLive(
  component: string | undefined,
  cycleId: string | undefined,
  refresh: () => void,
): void {
  const last = useRef(0);
  useEffect(() => {
    if (component === undefined || !LIVE.has(component) || typeof EventSource === 'undefined')
      return;
    const source = new EventSource(
      `/api/performance/live${cycleId === undefined ? '' : `?cycle=${cycleId}`}`,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const moved = (): void => {
      const wait = Math.max(0, 1000 - (Date.now() - last.current));
      clearTimeout(timer);
      timer = setTimeout(() => {
        last.current = Date.now();
        refresh();
      }, wait);
    };
    source.addEventListener('next', moved);
    source.addEventListener('message', moved);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [component, cycleId, refresh]);
}

function ActScreen({
  route,
  load,
  frame,
  path,
  params = {},
  search = {},
  area,
  act,
  embedded,
}: ActScreenProps & {
  readonly area: 'recruiting' | 'onboarding' | 'performance';
  readonly act: Act;
}): JSX.Element {
  const router = useRouter();
  const shellData = useShellData();
  const [, startTransition] = useTransition();
  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);
  useLive(area === 'performance' ? route?.component : undefined, params['id'], refresh);
  const loadable =
    load.status === 'ready'
      ? { status: 'ready' as const, data: load.data }
      : load.status === 'error'
        ? {
            status: 'error' as const,
            message: load.message,
            ...(load.code === 'FORBIDDEN' ||
            load.code === 'NOT_ENTITLED' ||
            load.code === 'NOT_FOUND'
              ? { refused: true as const }
              : {
                  retry: () => {
                    startTransition(() => {
                      router.refresh();
                    });
                  },
                }),
          }
        : { status: 'loading' as const };
  const wrote = useRef(0);
  const acting: Act = useCallback(
    async (name, variables) => {
      const done = await act(name, variables);
      if (done.ok) wrote.current = Date.now();
      return done;
    },
    [act],
  );
  const go = (to: string): void => {
    if (embedded === undefined) router.push(to, { scroll: false });
    else embedded.navigate(to, Date.now() - wrote.current < AFTER_WRITE_MS);
  };
  return (
    <RemoteScreen
      name={AREAS[area].name}
      area={AREAS[area].label}
      route={route}
      props={{
        load: loadable,
        ...(path === undefined ? {} : { path }),
        params,
        search,
        onNavigate: go,
        onFilter: (patch: Readonly<Record<string, string | null>>) => {
          go(
            embedded === undefined || path === undefined
              ? withQuery(window.location.pathname, window.location.search, patch)
              : withQuery(path, search, patch),
          );
        },
        onAct: acting,
        onRefresh: () => {
          router.refresh();
        },
        // Which siblings are here: a screen offers what only they add.
        with: {
          people: shellData.sections.length > 0,
          timeoff: shellData.remotes?.['timeoff'] !== undefined,
          documents: shellData.remotes?.['documents'] !== undefined,
        },
        frame:
          load.status === 'ready' && load.notice !== undefined
            ? { ...frame, notice: load.notice }
            : frame,
      }}
      fallback={null}
    />
  );
}
