import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/** The push worker (`public/push-sw.js`), run in a fake worker scope. */

const SOURCE = readFileSync(new URL('../../../public/push-sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://acme.app.kithena.test';

function worker(tabs: { url: string }[] = []) {
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const told: unknown[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const clients = tabs.map((t) => ({
    url: t.url,
    postMessage: (m: unknown) => told.push(m),
    focus: () => Promise.resolve(),
    navigate: (to: string) => {
      navigated.push(to);
      return Promise.resolve();
    },
  }));
  const self = {
    location: { origin: ORIGIN },
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: () => Promise.resolve(clients),
      openWindow: (to: string) => {
        opened.push(to);
        return Promise.resolve();
      },
    },
    addEventListener: (type: string, handler: (event: Record<string, unknown>) => void) =>
      handlers.set(type, handler),
  };
  runInNewContext(SOURCE, { self, URL });
  const run = async (type: string, event: Record<string, unknown>): Promise<void> => {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  };
  return { run, shown, told, opened, navigated };
}

describe('the push worker', () => {
  it('shows a push as its item, and tells every open page', async () => {
    const w = worker([{ url: `${ORIGIN}/people` }]);
    await w.run('push', {
      data: {
        json: () => ({
          title: 'Approve the offer',
          body: 'Yuki Sato',
          url: '/inbox?item=x',
          tag: 'k',
        }),
      },
    });
    expect(w.shown.map((n) => n.title)).toEqual(['Approve the offer']);
    expect(w.shown[0]?.options).toMatchObject({
      body: 'Yuki Sato',
      tag: 'k',
      data: { url: '/inbox?item=x' },
    });
    expect(w.told).toEqual([{ type: 'kithena:push' }]);
  });

  it('opens the item on this company’s app when pressed, in a tab already open or a new one', async () => {
    const close = vi.fn();
    const pressed = (url: string) => ({ notification: { close, data: { url } } });
    const open = worker([{ url: `${ORIGIN}/people` }]);
    await open.run('notificationclick', pressed('https://elsewhere.example/inbox?item=x'));
    expect(open.navigated).toEqual([`${ORIGIN}/inbox?item=x`]);
    const none = worker();
    await none.run('notificationclick', pressed('/inbox?item=y'));
    expect(none.opened).toEqual([`${ORIGIN}/inbox?item=y`]);
    expect(close).toHaveBeenCalledTimes(2);
  });
});
