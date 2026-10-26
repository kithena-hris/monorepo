import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import type { Signed } from '../people/api';
import { Platform } from 'react-native';

import { changeInbox, readInbox, readNotifications, savePushToken } from './api';
import { whatToSay, type Settings } from './say';
import { t as tr } from '../i18n';

/**
 * The phone's notifications for the Inbox (INB-051, M:A2): a task one by one,
 * with Open and Remind me tomorrow on it; updates grouped into one. Said when
 * the app reads the Inbox (signing in, coming back to the front, every few
 * minutes while open), for what is new since it last said anything, as the
 * person chose in Me › Settings › Notifications. Quiet hours hold them, except
 * a task due today.
 *
 * Pushed by Kithena once this phone has a push token (a build with the Expo
 * project's id): Messaging then sends each one as it happens, closed app or
 * not, and the app stops raising its own, so nothing is said twice. Without
 * one, the app raises them from its own reads.
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
    {
      identifier: 'open',
      buttonTitle: tr('inbox.notify.open', 'Open'),
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'tomorrow',
      buttonTitle: tr('inbox.notify.remind_me_tomorrow', 'Remind me tomorrow'),
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

/** This phone's push token, kept with the account; false when the build has no Expo project id. */
async function registerForPush(signed: Signed): Promise<boolean> {
  try {
    if (!(await ready())) return false;
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return await savePushToken(signed, token, Platform.OS === 'ios' ? 'iPhone' : 'Android phone');
  } catch {
    return false;
  }
}

/** The item a push names: `/inbox?item=…`. */
const itemOf = (data: Record<string, unknown>): string | null => {
  if (typeof data['id'] === 'string') return data['id'];
  if (typeof data['path'] !== 'string') return null;
  try {
    return new URL(data['path'], 'https://app.invalid').searchParams.get('item');
  } catch {
    return null;
  }
};

/** Read the Inbox and say what is new, as the person chose; only the badge when pushed to. */
async function check(signed: Signed, pushed: boolean): Promise<void> {
  const [answer, chosen] = await Promise.all([
    readInbox(signed, 30_000),
    readNotifications<Settings>(signed),
  ]);
  if (!answer.ok) return;
  const settings = chosen.ok ? chosen.data : {};
  const already = seen();
  const first = already.size === 0;
  const { tasks, updates } = whatToSay(answer.data, settings, already, new Date());
  await Notifications.setBadgeCountAsync(answer.data.counts.todo).catch(() => false);
  // The first read after installing only learns what is there: nothing is new to it.
  if (!pushed && !first && (tasks.length > 0 || updates.length > 0) && (await ready())) {
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
          title:
            updates.length === 1
              ? tr('inbox.notify.an_update', 'An update')
              : tr('inbox.notify.updates', '{{String}} updates', {
                  String: String(updates.length),
                }),
          body:
            updates.length === 1
              ? newest.title
              : tr('inbox.notify.and_more', '{{title}}, and {{String}} more', {
                  title: newest.title,
                  String: String(updates.length - 1),
                }),
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
  const pushed = useRef(false);
  useEffect(() => {
    void registerForPush(signed).then((ok) => {
      pushed.current = ok;
      void check(signed, ok);
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void check(signed, pushed.current);
    }, 5 * 60_000);
    const state = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check(signed, pushed.current);
    });
    const pressed = Notifications.addNotificationResponseReceivedListener((response) => {
      const id = itemOf(response.notification.request.content.data ?? {});
      if (id === null) return;
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
