'use client';

import { Spinner } from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';
import { preloadModule } from 'react-dom';

import { openTaskScreen } from '../../app/(app)/inbox/actions';
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
import { FramePane } from './frame-pane';

const ACT_SCREENS: Readonly<
  Record<Exclude<TaskScreen['area'], 'documents'>, (props: ActScreenProps) => JSX.Element>
> = {
  onboarding: OnboardingScreen,
  performance: PerformanceScreen,
  recruiting: RecruitingScreen,
};

/** A link as the screen's read keeps it: path and query. */
const addressOf = (link: string): string => {
  const url = new URL(link, 'http://inbox');
  return `${url.pathname}${url.search}`;
};

/**
 * Each task's screen, asked for once and kept until the Inbox is read again
 * (a write): opened, it draws from what is here. Asked for ahead, as a pointer
 * rests on a row or while the browser is idle, with the screen's code.
 */
const asked = new Map<string, Promise<TaskScreen | null>>();

export function prefetchTaskScreen(link: string): Promise<TaskScreen | null> {
  const address = addressOf(link);
  let screen = asked.get(address);
  if (screen === undefined) {
    screen = openTaskScreen(address).then((s) => {
      if (s !== null) preloadModule(s.route.entry);
      return s;
    });
    asked.set(address, screen);
    // A failure is asked again next time.
    screen.catch(() => asked.delete(address));
  }
  return screen;
}

/** The Inbox was read again: every kept screen may be out of date. */
export function forgetTaskScreens(): void {
  asked.clear();
}

/**
 * A task done in the pane: the page its link (or a link in its body) names,
 * drawn here rather than a link away. A module whose screen the shell can
 * hand its data (Performance, Recruiting, Onboarding, Documents) is drawn
 * directly, read again whenever the Inbox is (a write redraws both); any
 * other page (People's Review, a person, Time Off) is the page itself in a
 * frame (`frame-pane.tsx`). A link the screen follows stays in the pane;
 * straight after a write the task is done, and the Inbox moves on.
 */
export function TaskScreenPane({
  link: start,
  label,
  version,
  initial,
  onDone,
}: {
  readonly link: string;
  /** What it opens, for the wait and a screen reader: "Performance". */
  readonly label: string;
  /** Changes when the Inbox is read again: the screen is read again with it. */
  readonly version: unknown;
  /** Read with the page, for the item the address opened: no wait for its first draw. */
  readonly initial?: TaskScreen | null;
  readonly onDone: () => void;
}): JSX.Element {
  const [link, setLink] = useState(() => addressOf(start));
  const [asked, setAsked] = useState<TaskScreen | null | undefined>(undefined);
  // The page's own read, while it is of this address: drawn again with the
  // Inbox after every write, so nothing more is asked for.
  const fromPage =
    initial === undefined || (initial !== null && initial.link !== link) ? undefined : initial;
  const waiting = fromPage === undefined;
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    void prefetchTaskScreen(link).then((s) => {
      if (live) setAsked(s);
    });
    return () => {
      live = false;
    };
  }, [waiting, version, link]);
  const screen = fromPage ?? asked;

  if (screen === undefined) return <Wait label={label} />;
  // Not one the shell can draw: the page itself, in a frame.
  if (screen === null) return <FramePane key={link} link={link} label={label} />;
  // Another address asked for, still on its way.
  if (screen.link !== link) return <Wait label={label} />;
  const embedded: Embedded = {
    navigate: (to, afterWrite) => {
      if (afterWrite) onDone();
      else setLink(addressOf(to));
    },
  };
  const Screen = screen.area === 'documents' ? null : ACT_SCREENS[screen.area];
  return (
    <div className="flex flex-col gap-4" data-task-screen="">
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

function Wait({ label }: { readonly label: string }): JSX.Element {
  return (
    <div className="grid min-h-48 place-items-center">
      <Spinner
        label={t('components.inbox.task-screen.opening', 'Opening {{openIn}}', { openIn: label })}
      />
    </div>
  );
}
