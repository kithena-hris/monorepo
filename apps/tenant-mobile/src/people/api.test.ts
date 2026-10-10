import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { ask, read } = await import('./api');
const { queryClient } = await import('../query');

const signed = {
  company: { origin: 'https://acme.example', name: 'Acme' },
  sessionId: 's1',
  person: {},
  signedOut: vi.fn(),
  signOut: vi.fn(),
  viewAs: vi.fn(),
} as unknown as Parameters<typeof read>[0];

const answer = (data: unknown, wrote = false) =>
  new Response(JSON.stringify({ ok: true, data }), {
    headers: wrote ? { 'x-kithena-wrote': '1' } : {},
  });

let fetched: string[];
beforeEach(() => {
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: { body: string }) => {
      const { operation } = JSON.parse(init.body) as { operation: string };
      fetched.push(operation);
      return Promise.resolve(answer({ n: fetched.length }, operation.startsWith('Save')));
    }),
  );
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
});

it('answers a read asked again from what it kept, and asks once for two at once', async () => {
  const [a, b] = await Promise.all([read(signed, 'Home'), read(signed, 'Home')]);
  expect(a).toEqual(b);
  await read(signed, 'Home');
  expect(fetched).toEqual(['Home']);
  // Other variables are another question.
  await read(signed, 'Home', { id: 'p2' });
  expect(fetched).toEqual(['Home', 'Home']);
});

it('asks again after a write went through', async () => {
  await read(signed, 'Home');
  await ask(signed, 'SaveOwnSection', {});
  const again = await read(signed, 'Home');
  expect(fetched).toEqual(['Home', 'SaveOwnSection', 'Home']);
  expect(again).toEqual({ ok: true, data: { n: 3 } });
});

it('never keeps a refusal', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: false, code: 'FORBIDDEN', message: 'No' })),
      ),
    ),
  );
  expect(await read(signed, 'Home')).toEqual({ ok: false, code: 'FORBIDDEN', message: 'No' });
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
  ).toEqual([undefined]);
});
