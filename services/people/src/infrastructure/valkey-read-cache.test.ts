import { describe, expect, it } from 'vitest';

import { readKey } from '../application/read-cache.js';
import { TTL_SECONDS, valkeyReadCache, type ValkeyClient } from './valkey-read-cache.js';

/** Valkey's four commands over a Map, with what each key was set to expire in. */
function fakeValkey(): ValkeyClient & { readonly ttl: Map<string, number> } {
  const values = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    ttl,
    mget: (...keys) => Promise.resolve(keys.map((k) => values.get(k) ?? null)),
    set: (key, value, _mode, seconds) => {
      values.set(key, value);
      ttl.set(key, seconds);
      return Promise.resolve('OK');
    },
    incr: (key) => {
      const next = Number(values.get(key) ?? '0') + 1;
      values.set(key, String(next));
      return Promise.resolve(next);
    },
    expire: (key, seconds) => {
      ttl.set(key, seconds);
      return Promise.resolve(1);
    },
  };
}

const ACME = '00000000-0000-4000-8000-00000000ac00';
const GLOBEX = '00000000-0000-4000-8000-00000000ac01';
const hr = { accountId: 'a-1', roles: new Set(['hr', 'people_admin']) };
const overview = readKey(hr, '/v1/views/overview');

async function kept(cache: ReturnType<typeof valkeyReadCache>, tenant: string, key: string) {
  const miss = await cache.read(tenant, key);
  if (miss.hit || miss.generation === null) throw new Error('expected a miss');
  await cache.write(tenant, key, miss.generation, { headcount: 12 });
}

describe('valkeyReadCache', () => {
  it('answers a read it kept, for a minute at most', async () => {
    const valkey = fakeValkey();
    const cache = valkeyReadCache(valkey);
    await kept(cache, ACME, overview);
    expect(await cache.read(ACME, overview)).toEqual({ hit: true, value: { headcount: 12 } });
    expect([...valkey.ttl.values()]).toEqual([TTL_SECONDS]);
  });

  it('answers nothing it kept once the tenant changes', async () => {
    const cache = valkeyReadCache(fakeValkey());
    await kept(cache, ACME, overview);
    await cache.changed(ACME);
    expect(await cache.read(ACME, overview)).toEqual({ hit: false, generation: '1' });
  });

  it('never keeps an answer read before a change under the generation after it', async () => {
    const cache = valkeyReadCache(fakeValkey());
    const before = await cache.read(ACME, overview);
    // A write commits while the read is being computed.
    await cache.changed(ACME);
    if (before.hit || before.generation === null) throw new Error('expected a miss');
    await cache.write(ACME, overview, before.generation, { headcount: 11 });
    expect((await cache.read(ACME, overview)).hit).toBe(false);
  });

  it('keeps one tenant’s change and answers to itself', async () => {
    const cache = valkeyReadCache(fakeValkey());
    await kept(cache, ACME, overview);
    await kept(cache, GLOBEX, overview);
    await cache.changed(GLOBEX);
    expect((await cache.read(ACME, overview)).hit).toBe(true);
    expect((await cache.read(GLOBEX, overview)).hit).toBe(false);
  });

  it('answers another viewer, or the same one with other roles, from nothing kept for the first', async () => {
    const cache = valkeyReadCache(fakeValkey());
    await kept(cache, ACME, overview);
    const others = [
      readKey({ accountId: 'a-2', roles: new Set(['hr', 'people_admin']) }, '/v1/views/overview'),
      readKey({ accountId: 'a-1', roles: new Set(['people_admin']) }, '/v1/views/overview'),
      readKey({ ...hr, viewing: { by: 'a-9' } }, '/v1/views/overview'),
      readKey({ ...hr, support: { operatorId: 'op-1', reason: null } }, '/v1/views/overview'),
      readKey(hr, '/v1/views/overview?segment=s-1'),
    ];
    for (const key of others) expect((await cache.read(ACME, key)).hit).toBe(false);
    // The same roles in another order are the same viewer.
    const same = readKey({ accountId: 'a-1', roles: new Set(['people_admin', 'hr']) }, '/v1/views/overview');
    expect((await cache.read(ACME, same)).hit).toBe(true);
  });

  it('reads as a miss it cannot keep when Valkey cannot be reached, and never throws', async () => {
    const down: ValkeyClient = {
      mget: () => Promise.reject(new Error('ECONNREFUSED')),
      set: () => Promise.reject(new Error('ECONNREFUSED')),
      incr: () => Promise.reject(new Error('ECONNREFUSED')),
      expire: () => Promise.reject(new Error('ECONNREFUSED')),
    };
    const cache = valkeyReadCache(down);
    expect(await cache.read(ACME, overview)).toEqual({ hit: false, generation: null });
    await expect(cache.write(ACME, overview, '0', {})).resolves.toBeUndefined();
    await expect(cache.changed(ACME)).resolves.toBeUndefined();
  });
});
