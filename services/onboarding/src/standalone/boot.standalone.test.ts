import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import manifest from '../../module.manifest.js';
import { composeOnboarding } from '../composition.js';

/**
 * Onboarding boots with every sibling module absent (ONB-001): the config
 * resolves People, Time Off, Documents and Recruiting to a file that throws on
 * evaluation, so a sideways import fails here.
 */
describe('Onboarding, alone', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const { listener } = composeOnboarding({});
    server = createServer(listener);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );

  it('declares nothing it cannot run without', () => {
    expect(manifest.dependsOn).toEqual([]);
    expect(manifest.requiresPeopleSource).toBe('either');
  });

  it('answers its health check', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
