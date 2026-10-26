/*
 * Kithena's push worker: a push becomes a notification on this device, and a
 * press on it opens the item. Messaging encrypts each push for this browser
 * alone; the payload is { title, body, url, tag }. Every open Kithena page is
 * told, so its Inbox and bell catch up without waiting to be reloaded.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || 'Kithena', {
        body: data.body || '',
        tag: data.tag || undefined,
        renotify: Boolean(data.tag),
        data: { url: data.url || '/inbox' },
      });
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) client.postMessage({ type: 'kithena:push' });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only ever this company's own app: a push names a path on it.
  const asked = new URL(event.notification.data?.url || '/inbox', self.location.origin);
  const to = new URL(`${asked.pathname}${asked.search}`, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab !== undefined) {
        await tab.focus();
        return tab.navigate(to);
      }
      return self.clients.openWindow(to);
    })(),
  );
});
