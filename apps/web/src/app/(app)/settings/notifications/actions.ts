'use server';

import { refresh } from 'next/cache';

import { Notifications } from '../../../../lib/inbox/notifications';
import { readPreference, writePreference } from '../../../../lib/preferences';
import { devicesOf, PushDevice, withDevice, withoutDevice } from '../../../../lib/push/devices';
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

/** This browser, added to the devices pushed to: what `PushSubscription.toJSON()` gives, and a name. */
export async function savePushDevice(
  subscription: unknown,
  label: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  const t = await serverWords();
  const sub = subscription as { endpoint?: unknown; keys?: unknown } | null;
  const device = PushDevice.safeParse({
    kind: 'web',
    endpoint: sub?.endpoint,
    keys: sub?.keys,
    label: label.slice(0, 80),
    at: new Date().toISOString(),
  });
  if (!device.success)
    return {
      ok: false,
      message: t(
        'app.app.settings.notifications.actions.this_browser_did_not_give_a_subscription',
        'This browser did not give a subscription Kithena can push to',
      ),
    };
  const saved = await writePreference('push', {
    devices: withDevice(devicesOf(await readPreference('push')), device.data),
  });
  return saved === 'saved'
    ? { ok: true }
    : {
        ok: false,
        message: t(
          'app.app.settings.notifications.actions.that_did_not_save_try_again',
          'That did not save; try again',
        ),
      };
}

/** This browser, no longer pushed to. */
export async function removePushDevice(endpoint: string): Promise<void> {
  await writePreference('push', {
    devices: withoutDevice(devicesOf(await readPreference('push')), endpoint),
  });
}
