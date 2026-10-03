/*
 * The kiosk's service worker (TOF-108, PRD §11.9), registered by
 * `/kiosk/<id>` with that scope and nothing wider.
 *
 * Two jobs. **It keeps the kiosk's taps through a dropped network**: every
 * tap the page sends to `/kiosk/<id>/api/punches` joins a queue in Cache
 * Storage first, and the queue is sent whole, in sequence order, whenever it
 * can be — at once, on the page's nudge when the network returns, and on a
 * background sync where the browser has one. Each tap keeps the instant it
 * was taken and its sequence; every batch carries the tablet's time of
 * sending, which is how Time Off measures the tablet's clock. A queue that
 * is not empty takes new taps behind it, never beside it: Time Off ignores a
 * sequence below the last it synced, so order is the whole guarantee.
 *
 * **It lets the kiosk open without a network**: every GET from a kiosk page
 * goes to the network first and to the last copy when there is none.
 *
 * Plain JavaScript, served as it is: a service worker is fetched by URL and
 * Next does not compile `public/`.
 *
 * ponytail: a queued PIN sits in Cache Storage on the tablet until it syncs.
 * The tablet is the company's and the PIN is useless without the badge-less
 * kiosk it was typed at; encrypt the queue if a tablet ever leaves the wall.
 */

const QUEUE = 'kithena-kiosk-queue';
const PAGES = 'kithena-kiosk-pages';
const QUEUE_KEY = '/kiosk-queue.json';
const PUNCHES = /^\/kiosk\/[^/]+\/api\/punches$/u;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** One queue operation at a time: a tap arriving mid-flush waits for it. */
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function readQueue() {
  const hit = await (await caches.open(QUEUE)).match(QUEUE_KEY);
  return hit ? hit.json() : [];
}

async function writeQueue(items) {
  await (
    await caches.open(QUEUE)
  ).put(
    QUEUE_KEY,
    new Response(JSON.stringify(items), { headers: { 'content-type': 'application/json' } }),
  );
}

const json = (body, status) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/**
 * Everything queued, one batch per kiosk address and token, oldest sequence
 * first. Kept when the network or Time Off is not there (no answer, or a
 * 5xx); dropped once Time Off has answered it, refused or not — a revoked
 * token or a malformed tap is nothing a retry would change.
 */
async function flush() {
  const queued = await readQueue();
  if (queued.length === 0) return null;
  const batches = new Map();
  for (const item of queued) {
    const key = `${item.url} ${item.token}`;
    const batch = batches.get(key) ?? { url: item.url, token: item.token, items: [] };
    batch.items.push(item);
    batches.set(key, batch);
  }
  const keep = [];
  let answer = null;
  for (const { url, token, items } of batches.values()) {
    let response = null;
    try {
      // oxlint-disable-next-line no-await-in-loop -- one kiosk's batch after another
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          sentAt: new Date().toISOString(),
          punches: items.map((i) => i.punch).toSorted((a, b) => a.sequence - b.sequence),
        }),
      });
    } catch {
      response = null;
    }
    if (response === null || response.status >= 500) keep.push(...items);
    else answer = response;
  }
  await writeQueue(keep);
  return answer;
}

/** A tap from the page: behind whatever is queued, then the queue sent. */
async function take(request) {
  const body = await request.json();
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /u, '');
  const queued = await readQueue();
  await writeQueue([
    ...queued,
    ...body.punches.map((punch) => ({ url: request.url, token, punch })),
  ]);
  const answer = await flush();
  const left = (await readQueue()).length;
  if (left > 0) return json({ queued: left }, 202);
  return answer ?? json({ results: [] }, 200);
}

async function networkFirst(request) {
  const pages = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (response.ok) await pages.put(request, response.clone());
    return response;
  } catch (error) {
    const kept = await pages.match(request);
    if (kept) return kept;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && PUNCHES.test(url.pathname)) {
    event.respondWith(serial(() => take(request)));
  } else if (request.method === 'GET') {
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'flush') event.waitUntil(serial(flush));
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'kiosk-punches') event.waitUntil(serial(flush));
});
