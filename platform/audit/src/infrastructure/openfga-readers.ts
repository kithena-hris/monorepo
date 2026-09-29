import { OpenFgaClient } from '@openfga/sdk';
import { logger } from '@kithena/telemetry';

import type { Readers } from '../application/ports.js';
import { READING_ROLES } from '../domain/reading.js';

/**
 * The tenant relations an account holds, asked of OpenFGA — People's store,
 * read-only.
 *
 * People owns the model and writes the tuples (`services/people/src/
 * infrastructure/openfga.ts`); this finds the store by the same name, or takes
 * `OPENFGA_STORE_ID`, and only ever checks. It never writes a model, so a
 * deployment where People has not booted yet has no store, and every answer is
 * no — the safe way to be early.
 */

const STORE_NAME = 'people';

export function openFgaReaders(apiUrl: string, storeId?: string): Readers {
  // Found once, then kept. Not found, or OpenFGA down, is asked again next time.
  let found: OpenFgaClient | undefined;
  const client = async (): Promise<OpenFgaClient | null> => {
    if (found !== undefined) return found;
    const id = await find(apiUrl, storeId);
    if (id === undefined) return null;
    found = new OpenFgaClient({ apiUrl, storeId: id });
    return found;
  };

  return {
    async roles(tenantId, accountId) {
      const fga = await client();
      if (fga === null) return new Set();
      const { result } = await fga.batchCheck({
        checks: READING_ROLES.map((relation) => ({
          user: `user:${accountId}`,
          relation,
          object: `tenant:${tenantId}`,
          correlationId: relation,
        })),
      });
      for (const r of result) {
        // A check that errored is a no, never a yes.
        if (r.error !== undefined) logger.warn({ check: r.correlationId }, 'openfga check failed');
      }
      return new Set(
        result.filter((r) => r.allowed && r.error === undefined).map((r) => r.correlationId),
      );
    },
  };
}

async function find(apiUrl: string, storeId?: string): Promise<string | undefined> {
  if (storeId !== undefined && storeId !== '') return storeId;
  const bare = new OpenFgaClient({ apiUrl });
  let token: string | undefined;
  do {
    const page = await bare.listStores(token === undefined ? {} : { continuationToken: token });
    const found = page.stores.find((s) => s.name === STORE_NAME)?.id;
    if (found !== undefined) return found;
    token = page.continuation_token === '' ? undefined : page.continuation_token;
  } while (token !== undefined);
  return undefined;
}
