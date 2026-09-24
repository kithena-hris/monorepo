import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startPostgres } from '@kithena/testing';

import { compose, type Config } from '../composition.js';

/**
 * Identity as `main.ts` composes it, over HTTP, against a real Postgres with
 * every platform migration: for integration tests of what the back office,
 * the tenant app and the modules see at the wire (PEO-114, PEO-112, PEO-113).
 *
 * Connects as the database owner, which bypasses row-level security; the
 * tests here are about the routes and the events, and the isolation has its
 * own tests against `svc_identity`-shaped roles.
 */

export const INTERNAL_TOKEN = 'identity-integration-token';

export interface Composed {
  readonly url: string;
  readonly sql: postgres.Sql;
  /** A call with the internal token, answered as JSON. */
  call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  /** The payloads of one event, oldest first, from `platform.outbox`. */
  events(eventName: string): Promise<Record<string, unknown>[]>;
  stop(): Promise<void>;
}

export async function composed(config: Partial<Config> = {}): Promise<Composed> {
  const pg = await startPostgres();
  const sql = postgres(pg.url, { max: 2, onnotice: () => {} });
  let server: Server | undefined;
  const stop = async () => {
    if (server) await new Promise((resolve) => server?.close(resolve));
    await sql.end({ timeout: 5 });
    await pg.stop();
  };
  try {
    // The service roles `tools/scripts/init-db.sql` creates before any migration.
    for (const role of ['svc_identity', 'svc_messaging', 'svc_people']) {
      await sql.unsafe(`CREATE ROLE ${role} NOLOGIN NOBYPASSRLS`);
    }
    const dir = fileURLToPath(new URL('../../../../migrations/', import.meta.url));
    for (const file of (await readdir(dir))
      .filter((f) => f.endsWith('.sql') && (!f.includes('_people_') || f.includes('identity')))
      .sort()) {
      await sql.unsafe(await readFile(`${dir}${file}`, 'utf8'));
    }

    const routes = await compose({
      databaseUrl: pg.url,
      internalToken: INTERNAL_TOKEN,
      rpId: 'app.localhost',
      adminRpId: 'localhost',
      adminOrigin: 'http://localhost:3001',
      authOrigin: 'http://auth.app.localhost:3100',
      signingKey: undefined,
      allowInsecureOrigins: true,
      ...config,
    });
    server = createServer((request, response) => {
      routes(request, response)
        .then((handled) => {
          if (!handled) response.writeHead(404).end();
        })
        .catch((error: unknown) => {
          console.error(error);
          if (!response.headersSent) response.writeHead(500).end();
        });
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;

    return {
      url,
      sql,
      async call(method, path, body) {
        const response = await fetch(`${url}${path}`, {
          method,
          headers: { 'content-type': 'application/json', 'x-internal-token': INTERNAL_TOKEN },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        return {
          status: response.status,
          body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
        };
      },
      async events(eventName) {
        const rows = await sql<{ payload: Record<string, unknown> }[]>`
          SELECT envelope -> 'payload' AS payload FROM platform.outbox WHERE event_name = ${eventName} ORDER BY event_id
        `;
        return rows.map((r) => r.payload);
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** A company as the back office's wizard creates it. */
export function companyRequest(
  slug: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slug,
    displayName: `${slug} Ltd`,
    admins: [`ada@${slug}.example`],
    themeId: 'indigo',
    timeZone: 'Europe/Madrid',
    address: {
      country: 'ES',
      line1: 'Calle de Alcalá 45',
      city: 'Madrid',
      subdivision: '28',
      postcode: '28014',
    },
    ...extra,
  };
}
