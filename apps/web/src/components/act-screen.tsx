'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type JSX } from 'react';

import { onboardingAct } from '../app/(app)/onboarding/actions';
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
}

type Act = (name: string, variables: Readonly<Record<string, unknown>>) => Promise<Done>;

export const RecruitingScreen = (props: ActScreenProps): JSX.Element => (
  <ActScreen {...props} area="recruiting" act={recruitingAct} />
);

export const OnboardingScreen = (props: ActScreenProps): JSX.Element => (
  <ActScreen {...props} area="onboarding" act={onboardingAct} />
);

function ActScreen({
  route,
  load,
  frame,
  area,
  act,
}: ActScreenProps & {
  readonly area: 'recruiting' | 'onboarding';
  readonly act: Act;
}): JSX.Element {
  const router = useRouter();
  const shellData = useShellData();
  const [, startTransition] = useTransition();
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
  const go = (to: string): void => {
    router.push(to, { scroll: false });
  };
  return (
    <RemoteScreen
      name={AREAS[area].name}
      area={AREAS[area].label}
      route={route}
      props={{
        load: loadable,
        onNavigate: go,
        onFilter: (patch: Readonly<Record<string, string | null>>) => {
          go(withQuery(window.location.pathname, window.location.search, patch));
        },
        onAct: act,
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
