import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * The kiosk's service worker (`public/kiosk-sw.js`, TOF-108), run in a fake
 * worker scope: Cache Storage as a map, `fetch` as a switch the test flips.
 */

const SOURCE = readFileSync(new URL('../../public/kiosk-sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://acme.kithena.test';
const PUNCHES_URL = `${ORIGIN}/kiosk/d-1/api/punches`;

type Handler = (event: Record<string, unknown>) => void;

function worker() {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const caches = {
    open: (name: string) => {
      const store = stores.get(name) ?? new Map<string, Response>();
      stores.set(name, store);
      return Promise.resolve({
        match: (key: string | Request) =>
          Promise.resolve(store.get(typeof key === 'string' ? key : key.url)?.clone()),
        put: (key: string | Request, response: Response) => {
          store.set(typeof key === 'string' ? key : key.url, response.clone());
          return Promise.resolve();
        },
      });
    },
  };
  let online = true;
  const sent: { sentAt: string; punches: { sequence: number }[] }[] = [];
  const fetch = vi.fn((_url: string, init: { body: string }) => {
    if (!online) return Promise.reject(new TypeError('Failed to fetch'));
    const body = JSON.parse(init.body) as (typeof sent)[number];
    sent.push(body);
    return Promise.resolve(
      new Response(
        JSON.stringify({
          results: body.punches.map((p) => ({ sequence: p.sequence, outcome: 'punched' })),
        }),
        { status: 200 },
      ),
    );
  });
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: () => Promise.resolve() },
    skipWaiting: () => Promise.resolve(),
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
  };
  // A worker's own global scope: only what a worker has, and these fakes.
  runInNewContext(SOURCE, { self, caches, fetch, Response, Request, URL });

  const tap = async (sequence: number): Promise<Response> => {
    let answer: Promise<Response> | undefined;
    handlers.get('fetch')?.({
      request: new Request(PUNCHES_URL, {
        method: 'POST',
        headers: { authorization: 'Bearer kk_token' },
        body: JSON.stringify({
          sentAt: '2026-10-01T06:52:00.000Z',
          punches: [
            { sequence, at: '2026-10-01T06:52:00.000Z', credential: { kind: 'badge', value: '1' } },
          ],
        }),
      }),
      respondWith: (p: Promise<Response>) => {
        answer = p;
      },
    });
    if (answer === undefined) throw new Error('the worker did not answer');
    return answer;
  };
  const nudge = async (): Promise<void> => {
    let done: Promise<unknown> | undefined;
    handlers.get('message')?.({ data: 'flush', waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  return {
    tap,
    nudge,
    sent,
    setOnline: (v: boolean) => {
      online = v;
    },
  };
}

describe('the kiosk’s service worker', () => {
  it('sends a tap at once when the network is there, and answers with Time Off’s results', async () => {
    const sw = worker();
    const answer = await sw.tap(1);
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ results: [{ sequence: 1, outcome: 'punched' }] });
    expect(sw.sent).toHaveLength(1);
  });

  it('keeps taps through a dropped network and sends them all, in order, when it is back', async () => {
    const sw = worker();
    sw.setOnline(false);
    expect((await sw.tap(2)).status).toBe(202);
    expect(await (await sw.tap(1)).json()).toEqual({ queued: 2 });
    expect(sw.sent).toHaveLength(0);

    sw.setOnline(true);
    await sw.nudge();
    expect(sw.sent).toHaveLength(1);
    expect(sw.sent[0]?.punches.map((p) => p.sequence)).toEqual([1, 2]);
    // The time of sending is the tablet's now, not the tap's.
    expect(sw.sent[0]?.sentAt).not.toBe('2026-10-01T06:52:00.000Z');
    await sw.nudge();
    expect(sw.sent).toHaveLength(1);
  });

  it('puts a new tap behind a queue, never beside it', async () => {
    const sw = worker();
    sw.setOnline(false);
    await sw.tap(1);
    sw.setOnline(true);
    await sw.tap(2);
    expect(sw.sent.map((b) => b.punches.map((p) => p.sequence))).toEqual([[1, 2]]);
  });
});
