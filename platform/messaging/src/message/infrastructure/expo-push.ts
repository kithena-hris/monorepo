import type { PushMessage } from '../application/push.js';

/**
 * A phone's push, through Expo's push service (the Kithena app is an Expo
 * app): the title, the line and the item's path, which the app opens. Expo
 * passes it on to Apple's or Google's service; it needs no key of ours.
 */
export function expoPush(endpoint = 'https://exp.host/--/api/v2/push/send') {
  return async (tokens: readonly string[], message: PushMessage): Promise<void> => {
    const path = (() => {
      try {
        const u = new URL(message.url, 'https://app.invalid');
        return `${u.pathname}${u.search}`;
      } catch {
        return '/inbox';
      }
    })();
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: message.title,
          body: message.body,
          sound: 'default',
          priority: message.urgent ? 'high' : 'normal',
          data: { path, tag: message.tag },
          collapseId: message.tag.slice(0, 64),
          threadId: 'inbox',
        })),
      ),
      signal: AbortSignal.timeout(5000),
    });
  };
}
