import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createYoga } from 'graphql-yoga';
import { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { Deps, UnitOfWork } from './application/ports.js';
import { yogaOptions } from './graphql/schema.js';
import { callerFromHeaders, withMember, type RecordedEntitlements } from './http/caller.js';
import { documentsListener, documentsServer } from './http/server.js';
import { blobsFrom } from './infrastructure/blobs.js';
import { drizzleUnitOfWork, documentsDatabase } from './infrastructure/unit-of-work.js';

/**
 * Documents' composition root (DOC-026), Time Off's shape. With
 * `DOCUMENTS_DATABASE_URL`: the Drizzle unit of work, the sealed blob store,
 * and the router's caller resolved to the member it signs in as. Without it,
 * the schema only, every field UNAVAILABLE — what `just supergraph` reads.
 */

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

export interface Composed {
  readonly listener: Listener;
  readonly storage: {
    readonly db: PostgresJsDatabase;
    readonly uow: UnitOfWork;
    readonly deps: Deps;
  } | null;
}

export async function composeDocuments(env: NodeJS.ProcessEnv = process.env): Promise<Composed> {
  const db = documentsDatabase(env);
  if (db === null) {
    logger.warn(
      { module: 'documents' },
      'DOCUMENTS_DATABASE_URL is not set; serving the schema only',
    );
    const yoga = createYoga(yogaOptions);
    return {
      listener: documentsListener((request, response) => {
        void yoga(request, response);
      }),
      storage: null,
    };
  }
  const uow = drizzleUnitOfWork(db);
  // The router's secret for this pair, as Time Off's; empty refuses everybody.
  const internalToken = env['DOCUMENTS_API_TOKEN'] ?? env['INTERNAL_API_TOKEN'] ?? '';
  const recorded: RecordedEntitlements = async (tenantId) => {
    const kept = (await uow.run(TenantId.parse(tenantId), (tx) =>
      tx.settings.get('entitlements'),
    )) as {
      entitlements: string[];
    } | null;
    return kept?.entitlements ?? null;
  };
  const { listener, deps } = documentsServer({
    uow,
    blobs: blobsFrom(env),
    callerFrom: withMember(callerFromHeaders(internalToken, recorded), uow),
  });
  return { listener, storage: { db, uow, deps } };
}
