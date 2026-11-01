import { preloadModule } from 'react-dom';

import { openTaskScreen } from '../../app/(app)/inbox/pane-actions';
import type { TaskScreen } from '../../lib/inbox/task-screen';

/*
 * Its own module, not `task-screen.tsx`: the list asks ahead from here, and
 * the pane that draws a screen (with every module's screen wrapper) loads
 * only when an item opens.
 */

/** A link as the screen's read keeps it: path and query. */
export const addressOf = (link: string): string => {
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
