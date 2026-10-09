'use server';

import { refresh } from 'next/cache';

import { Notifications } from '../../../../lib/inbox/notifications';
import { writePreference } from '../../../../lib/preferences';

/** Keep where this person's tasks and updates reach them; refused as it came if it is not one. */
export async function saveNotifications(
  value: unknown,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const parsed = Notifications.safeParse(value);
  if (!parsed.success) return { ok: false, message: 'Those settings are not ones Kithena knows' };
  const saved = await writePreference('notifications', parsed.data);
  if (saved === 'saved') {
    refresh();
    return { ok: true };
  }
  return {
    ok: false,
    message:
      saved === 'view_only' ? 'Viewing as somebody is read-only' : 'That did not save; try again',
  };
}
