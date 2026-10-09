import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Signed } from '../people/api';
import { changeInbox, readInbox, readNotifications } from './api';
import { whatToSay, type Settings } from './say';

/**
 * The phone's notifications for the Inbox (INB-051, M:A2): a task one by one,
 * with Open and Remind me tomorrow on it; updates grouped into one. Said when
 * the app reads the Inbox (signing in, coming back to the front, every few
 * minutes while open), for what is new since it last said anything, as the
 * person chose in Me › Settings › Notifications. Quiet hours hold them, except
 * a task due today.
 *
 * ponytail: raised by the app from its own read, so nothing arrives while it is
 * closed; Expo's push service from the server is the upgrade once the app has
 * a build with a push credential.
 */

const CATEGORY = 'inbox-task';
const SEEN = new File(Paths.document, 'inbox-notified.json');

function seen(): Set<string> {
  try {
    return SEEN.exists ? new Set(JSON.parse(SEEN.textSync()) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function remember(ids: Iterable<string>): void {
  try {
    if (!SEEN.exists) SEEN.create();
    SEEN.write(JSON.stringify([...ids].slice(-500)));
  } catch {
    // A phone that cannot keep the list says some things twice; nothing is lost.
  }
}

async function ready(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return false;
  await Notifications.setNotificationCategoryAsync(CATEGORY, [
    { identifier: 'open', buttonTitle: 'Open', options: { opensAppToForeground: true } },
    {
      identifier: 'tomorrow',
      buttonTitle: 'Remind me tomorrow',
      options: { opensAppToForeground: false },
    },
  ]);
  return true;
}

Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
});

/** Read the Inbox and say what is new, as the person chose. */
async function check(signed: Signed): Promise<void> {
  const [answer, chosen] = await Promise.all([
    readInbox(signed),
    readNotifications<Settings>(signed),
  ]);
  if (!answer.ok) return;
  const settings = chosen.ok ? chosen.data : {};
  const already = seen();
  const first = already.size === 0;
  const { tasks, updates } = whatToSay(answer.data, settings, already, new Date());
  await Notifications.setBadgeCountAsync(answer.data.counts.todo).catch(() => false);
  // The first read after installing only learns what is there: nothing is new to it.
  if (!first && (tasks.length > 0 || updates.length > 0) && (await ready())) {
    for (const t of tasks) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: t.title,
          ...(t.summary === null ? {} : { body: t.summary }),
          categoryIdentifier: CATEGORY,
          data: { id: t.id },
        },
        trigger: null,
      });
    }
    const [newest] = updates;
    if (newest !== undefined) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: updates.length === 1 ? 'An update' : `${String(updates.length)} updates`,
          body:
            updates.length === 1
              ? newest.title
              : `${newest.title}, and ${String(updates.length - 1)} more`,
          data: { id: newest.id },
        },
        trigger: null,
      });
    }
  }
  remember([
    ...already,
    ...tasks.map((t) => t.id),
    ...updates.map((u) => u.id),
    ...(first
      ? Object.values(answer.data.lanes).flatMap((g) => g.flatMap((x) => x.items.map((i) => i.id)))
      : []),
  ]);
}

/**
 * Notifications while signed in: checked now, when the app comes to the
 * front, and every five minutes it stays there. A press opens the item; its
 * Remind me tomorrow snoozes it to nine the next morning.
 */
export function useInboxNotifications(signed: Signed, openItem: (id: string) => void): void {
  const open = useRef(openItem);
  open.current = openItem;
  useEffect(() => {
    void check(signed);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void check(signed);
    }, 5 * 60_000);
    const state = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check(signed);
    });
    const pressed = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = (response.notification.request.content.data as { id?: unknown }).id;
      if (typeof id !== 'string') return;
      if (response.actionIdentifier === 'tomorrow') {
        const at = new Date();
        at.setDate(at.getDate() + 1);
        at.setHours(9, 0, 0, 0);
        void changeInbox(signed, { kind: 'snooze', id, until: at.toISOString() });
        return;
      }
      open.current(id);
    });
    return () => {
      clearInterval(timer);
      state.remove();
      pressed.remove();
    };
  }, [signed]);
}
