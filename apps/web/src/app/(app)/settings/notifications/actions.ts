'use server';

import { refresh } from 'next/cache';

import { Notifications } from '../../../../lib/inbox/notifications';
import { writePreference } from '../../../../lib/preferences';
import { serverWords } from '../../../../lib/server-words';

/** Keep where this person's tasks and updates reach them; refused as it came if it is not one. */
export async function saveNotifications(
  value: unknown,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const t = await serverWords();
  const parsed = Notifications.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      message: t(
        'app.app.settings.notifications.actions.those_settings_are_not_ones_kithena_knows',
        'Those settings are not ones Kithena knows',
      ),
    };
  const saved = await writePreference('notifications', parsed.data);
  if (saved === 'saved') {
    refresh();
    return { ok: true };
  }
  return {
    ok: false,
    message:
      saved === 'view_only'
        ? t(
            'app.app.settings.notifications.actions.viewing_as_somebody_is_read_only',
            'Viewing as somebody is read-only',
          )
        : t(
            'app.app.settings.notifications.actions.that_did_not_save_try_again',
            'That did not save; try again',
          ),
  };
}
