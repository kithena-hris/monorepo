'use client';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  icons,
} from '@reach/ui';
import { useEffect, useState, useTransition, type JSX } from 'react';

import { removePushDevice, savePushDevice } from '../app/(app)/settings/notifications/actions';
import { t } from '../lib/t';

/**
 * Push on this device (Settings › Notifications): the browser asks once, the
 * subscription is kept with the account, and Messaging pushes to it what the
 * rows below say reaches "phone". Off again forgets this browser.
 */

type State = 'unsupported' | 'blocked' | 'off' | 'on' | 'loading';

/** The VAPID key, as `applicationServerKey` takes it. */
const keyOf = (base64url: string): Uint8Array<ArrayBuffer> => {
  const raw = atob(base64url.replace(/-/gu, '+').replace(/_/gu, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

/** "Chrome on macOS", as far as the browser says. */
const labelOf = (): string => {
  const ua = navigator.userAgent;
  const browser = /Edg\//u.test(ua)
    ? 'Edge'
    : /Firefox\//u.test(ua)
      ? 'Firefox'
      : /Chrome\//u.test(ua)
        ? 'Chrome'
        : /Safari\//u.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /iPhone|iPad/u.test(ua)
    ? 'iOS'
    : /Android/u.test(ua)
      ? 'Android'
      : /Mac OS X/u.test(ua)
        ? 'macOS'
        : /Windows/u.test(ua)
          ? 'Windows'
          : 'Linux';
  return `${browser} · ${os}`;
};

export async function pushWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
}

export function PushDevice({ vapidKey }: { readonly vapidKey: string | null }): JSX.Element {
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (vapidKey === null || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('blocked');
      return;
    }
    void navigator.serviceWorker
      .getRegistration('/')
      .then((r) => r?.pushManager.getSubscription() ?? null)
      .then((s) => {
        setState(s === null ? 'off' : 'on');
      });
  }, [vapidKey]);

  const turnOn = (): void => {
    if (vapidKey === null) return;
    setError(null);
    start(async () => {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await pushWorker();
      await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyOf(vapidKey),
        }));
      const saved = await savePushDevice(subscription.toJSON(), labelOf());
      if (!saved.ok) {
        setError(saved.message);
        return;
      }
      setState('on');
    });
  };

  const turnOff = (): void => {
    start(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription != null) {
        await removePushDevice(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState('off');
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle level={2}>
          {t('components.push-device.push_on_this_device', 'Push notifications on this device')}
        </CardTitle>
        <CardDescription>
          {state === 'unsupported'
            ? t(
                'components.push-device.this_browser_cannot',
                'This browser cannot receive push notifications from Kithena. On a phone, the Kithena app can.',
              )
            : state === 'blocked'
              ? t(
                  'components.push-device.blocked',
                  'Notifications are blocked for Kithena in this browser. Allow them in the site settings, then come back.',
                )
              : t(
                  'components.push-device.what_reaches_this_device',
                  'What you route to your phone below reaches this device too, the moment it arrives, even with Kithena closed.',
                )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error === null ? null : (
          <Alert tone="danger" title={t('components.push-device.not_turned_on', 'Not turned on')}>
            {error}
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {state === 'on' ? (
            <>
              <Badge dot tone="success">
                {t('components.push-device.on', 'On')}
              </Badge>
              <Button loading={pending} onClick={turnOff}>
                {t('components.push-device.turn_off', 'Turn off on this device')}
              </Button>
            </>
          ) : state === 'off' ? (
            <Button
              variant="primary"
              loading={pending}
              startIcon={<icons.notifications aria-hidden />}
              onClick={turnOn}
            >
              {t('components.push-device.turn_on', 'Turn on push notifications')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
