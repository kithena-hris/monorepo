import dynamic from 'next/dynamic';
import type { JSX } from 'react';

// Its own chunk, with the time picker in it: nothing a page loads up front
// imports a picker (`apps/web/acceptance/perf.acceptance.test.ts`, the budgets).
const NotificationSettings = dynamic(() =>
  import('../../../../components/inbox/notification-settings').then((m) => m.NotificationSettings),
);
import { notificationsOf } from '../../../../lib/inbox/notifications';
import { inboxState } from '../../../../lib/inbox/server';
import { readPreference } from '../../../../lib/preferences';

/**
 * Settings › You › Notifications (P1): where tasks and updates reach this
 * person, and what they muted. Everybody's own, kept with their account.
 */
export default async function NotificationsSettings(): Promise<JSX.Element> {
  const [saved, state] = await Promise.all([readPreference('notifications'), inboxState()]);
  return <NotificationSettings initial={notificationsOf(saved)} muted={state.muted} />;
}
