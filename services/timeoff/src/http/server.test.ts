import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { timeoffListener } from './server.js';

let server: Server;
let base: string;

beforeAll(async () => {
  // A stand-in for Yoga: whatever is not `/healthz` must reach it untouched.
  server = createServer(timeoffListener((_request, response) => response.end('graphql')));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('the time off listener', () => {
  it('answers /healthz itself', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('hands everything else to GraphQL', async () => {
    expect(await (await fetch(`${base}/graphql`)).text()).toBe('graphql');
  });
});
