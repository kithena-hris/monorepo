import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { egressPolicyFrom, isPublicAddress, pinnedPoster, vet, type Resolver } from './egress.js';

/**
 * The SSRF boundary. Every test injects the resolver, so what DNS "says" is
 * the thing under test, not whatever the machine running it happens to know.
 */

const answering =
  (...addresses: string[]): Resolver =>
  () =>
    Promise.resolve(
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );

const PUBLIC = '93.184.215.14';

describe('a hostname resolving to a non-public address', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['private 10/8', '10.1.2.3'],
    ['cloud metadata', '169.254.169.254'],
    ['CGNAT', '100.64.0.1'],
    ['IPv6 loopback', '::1'],
    ['unique local fd00::/8', 'fd00::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv4-mapped IPv6', '::ffff:10.0.0.1'],
  ])('is refused: %s (%s)', async (_label, address) => {
    const result = await vet('https://hooks.example.com/in', { resolve: answering(address) });
    expect(!result.ok && result.error.code).toBe('BAD_WEBHOOK_URL');
  });

  it('is refused when any one of several answers is private', async () => {
    const result = await vet('https://hooks.example.com/in', {
      resolve: answering(PUBLIC, '10.0.0.7'),
    });
    expect(result.ok).toBe(false);
  });

  it('is refused as a literal, bracketed or not', async () => {
    for (const url of [
      'https://169.254.169.254/latest',
      'https://[::1]/x',
      'https://[::ffff:a00:1]/',
    ]) {
      expect((await vet(url, { resolve: answering(PUBLIC) })).ok).toBe(false);
    }
  });
});

describe('what is accepted', () => {
  it('a public address over https', async () => {
    const result = await vet('https://hooks.example.com/in', { resolve: answering(PUBLIC) });
    expect(result.ok && result.value.address).toBe(PUBLIC);
    expect(isPublicAddress('2606:4700::1111')).toBe(true);
  });

  it('never plain http, credentials or garbage — http only in explicit local-dev mode', async () => {
    const resolve = answering(PUBLIC);
    expect((await vet('http://hooks.example.com/', { resolve })).ok).toBe(false);
    expect((await vet('http://hooks.example.com/', { resolve, allowHttp: true })).ok).toBe(true);
    expect((await vet('https://u:p@hooks.example.com/', { resolve })).ok).toBe(false);
    expect((await vet('not a url', { resolve })).ok).toBe(false);
  });
});

/* A real local receiver, so the pinning and the redirect are observed on a socket. */
let server: Server | undefined;
let hits: string[] = [];

afterEach(async () => {
  const open = server;
  if (open) await new Promise((resolve) => open.close(resolve));
  server = undefined;
  hits = [];
});

async function receiver(respond: (res: ServerResponse) => void): Promise<number> {
  server = createServer((req, res) => {
    hits.push(`${req.headers.host ?? ''}${req.url ?? ''}`);
    respond(res);
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** Loopback is let through only here, so the test has something to connect to. */
const onlyLoopback = (address: string) => address === '127.0.0.1';

describe('delivery', () => {
  it('connects to the vetted address, not a second lookup, keeping the hostname as Host', async () => {
    const port = await receiver((res) => res.writeHead(204).end());
    // `hooks.test` does not exist in real DNS: reaching the receiver proves
    // the socket used the address the resolver gave `vet`.
    const post = pinnedPoster({
      resolve: answering('127.0.0.1'),
      allowHttp: true,
      isAllowed: onlyLoopback,
    });
    const answer = await post(`http://hooks.test:${String(port)}/in`, { headers: {}, body: '{}' });
    expect(answer.status).toBe(204);
    expect(hits).toEqual([`hooks.test:${String(port)}/in`]);
  });

  it('refuses at delivery a name that rebinds to a private address after registration', async () => {
    let calls = 0;
    const rebinding: Resolver = () => {
      calls += 1;
      return Promise.resolve([{ address: calls === 1 ? PUBLIC : '10.0.0.1', family: 4 }]);
    };
    const policy = { resolve: rebinding };

    expect((await vet('https://hooks.example.com/in', policy)).ok).toBe(true); // registration
    await expect(
      pinnedPoster(policy)('https://hooks.example.com/in', { headers: {}, body: '{}' }),
    ).rejects.toThrow(/not on the public internet/);
  });

  it('does not follow a redirect, even to somewhere private', async () => {
    const port = await receiver((res) =>
      res.writeHead(302, { location: 'http://10.0.0.1/steal' }).end(),
    );
    const post = pinnedPoster({
      resolve: answering('127.0.0.1'),
      allowHttp: true,
      isAllowed: onlyLoopback,
    });
    const answer = await post(`http://hooks.test:${String(port)}/in`, { headers: {}, body: '{}' });
    expect(answer.status).toBe(302);
    expect(hits).toHaveLength(1);
  });
});

describe('the policy a process runs with', () => {
  const SWITCHES = { PEOPLE_WEBHOOKS_ALLOW_LOOPBACK: '1', PEOPLE_WEBHOOKS_ALLOW_HTTP: '1' };

  it('in production refuses loopback and plain http, whatever the switches say', async () => {
    const policy = egressPolicyFrom({ NODE_ENV: 'production', ...SWITCHES }, answering('127.0.0.1'));
    for (const url of ['https://127.0.0.1:8443/in', 'https://[::1]/in', 'https://hooks.test/in']) {
      expect((await vet(url, policy)).ok, url).toBe(false);
    }
    expect((await vet(`http://${PUBLIC}/in`, policy)).ok).toBe(false);
  });

  it('off production with no switch set still refuses loopback', async () => {
    const policy = egressPolicyFrom({ NODE_ENV: 'test' });
    expect((await vet('https://127.0.0.1/in', policy)).ok).toBe(false);
  });

  it('off production with the switch accepts loopback, and nothing else private', async () => {
    const policy = egressPolicyFrom({ NODE_ENV: 'test', PEOPLE_WEBHOOKS_ALLOW_LOOPBACK: '1' });
    expect((await vet('https://127.0.0.1:8443/in', policy)).ok).toBe(true);
    expect((await vet('https://[::1]/in', policy)).ok).toBe(true);
    for (const url of [
      'https://10.0.0.1/in',
      'https://169.254.169.254/latest',
      'https://192.168.1.1/in',
      'https://[fd00::1]/in',
      'https://[::ffff:127.0.0.1]/in',
      'http://127.0.0.1/in',
    ]) {
      expect((await vet(url, policy)).ok, url).toBe(false);
    }
  });
});
