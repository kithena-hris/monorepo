'use client';

import { Button, Spinner, icons } from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type JSX } from 'react';

import { openTaskScreen } from '../../app/(app)/inbox/actions';
import type { Shown } from '../../lib/inbox/model';
import type { TaskScreen } from '../../lib/inbox/task-screen';
import { t } from '../../lib/t';
import {
  OnboardingScreen,
  PerformanceScreen,
  RecruitingScreen,
  type ActScreenProps,
  type Embedded,
} from '../act-screen';
import { DocumentsScreen } from '../documents-screen';
import { Actions } from './pane';

const ACT_SCREENS: Readonly<
  Record<Exclude<TaskScreen['area'], 'documents'>, (props: ActScreenProps) => JSX.Element>
> = {
  onboarding: OnboardingScreen,
  performance: PerformanceScreen,
  recruiting: RecruitingScreen,
};

const pathOf = (link: string): string => new URL(link, 'http://inbox').pathname;
/** A link as the screen's read keeps it: path and query. */
const addressOf = (link: string): string => {
  const url = new URL(link, 'http://inbox');
  return `${url.pathname}${url.search}`;
};

/**
 * A task the Inbox has no form of its own for, done in the pane all the same:
 * its module's own screen (the review to write, the peers to pick, the
 * envelope to sign) drawn here rather than a link away. The screen is read
 * again whenever the Inbox is (a write redraws both), and a link it follows
 * within the same screen, a filter or a step, stays in the pane. Straight
 * after a write the task is done, so the Inbox moves on to the next; any
 * other link is a deliberate way out, and is followed.
 */
export function TaskScreenPane({
  item,
  initial,
  onDone,
}: {
  readonly item: Shown;
  /** Read with the page, for the item the address opened: no wait for its first draw. */
  readonly initial?: TaskScreen | null;
  readonly onDone: () => void;
}): JSX.Element {
  const router = useRouter();
  const [link, setLink] = useState(() => addressOf(item.link));
  const [asked, setAsked] = useState<TaskScreen | null | undefined>(undefined);
  // The page's own read, while it is of this address: drawn again with the
  // Inbox after every write, so nothing more is asked for.
  const fromPage =
    initial === undefined || (initial !== null && initial.link !== link) ? undefined : initial;
  const waiting = fromPage === undefined;
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    void openTaskScreen(link).then((s) => {
      if (live) setAsked(s);
    });
    return () => {
      live = false;
    };
    // `item`, not its link: a new object is the Inbox read again after a write.
  }, [waiting, item, link]);
  const screen = fromPage ?? asked;

  if (screen === undefined)
    return (
      <div className="grid min-h-48 place-items-center">
        <Spinner
          label={t('components.inbox.task-screen.opening', 'Opening {{openIn}}', {
            openIn: item.openIn,
          })}
        />
      </div>
    );
  if (screen === null)
    return (
      <div className="flex flex-col gap-3">
        {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
        <Actions>
          <Button asChild startIcon={<icons.externalLink aria-hidden />}>
            <a href={item.link}>
              {t('components.inbox.detail.open_in', 'Open in {{openIn}}', {
                openIn: item.openIn,
              })}
            </a>
          </Button>
        </Actions>
      </div>
    );
  const embedded: Embedded = {
    navigate: (to, afterWrite) => {
      if (afterWrite) onDone();
      else if (pathOf(to) === screen.path) setLink(addressOf(to));
      else router.push(to, { scroll: false });
    },
  };
  const Screen = screen.area === 'documents' ? null : ACT_SCREENS[screen.area];
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4" data-task-screen="">
      {Screen === null ? (
        <DocumentsScreen
          route={screen.route}
          load={screen.load}
          frame={screen.frame}
          path={screen.path}
          embedded={embedded}
        />
      ) : (
        <Screen
          route={screen.route}
          load={screen.load}
          frame={screen.frame}
          path={screen.path}
          params={screen.params}
          search={screen.search}
          embedded={embedded}
        />
      )}
    </div>
  );
}
