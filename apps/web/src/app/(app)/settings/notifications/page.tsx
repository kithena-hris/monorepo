import type { JSX } from 'react';

import { NotificationSettings } from '../../../../components/inbox/notification-settings';
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
