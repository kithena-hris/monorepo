import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createYoga } from 'graphql-yoga';
import { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { Deps, UnitOfWork } from './application/ports.js';
import { yogaOptions } from './graphql/schema.js';
import { callerFromHeaders, withMember, type RecordedEntitlements } from './http/caller.js';
import { recruitingListener, recruitingServer } from './http/server.js';
import { blobsFrom } from './infrastructure/blobs.js';
import { uuidv7 } from './infrastructure/ids.js';
import { modelFrom } from './infrastructure/model.js';
import { sealerFrom } from './infrastructure/sealer.js';
import {
  fakeAssessments,
  fakeBackgroundChecks,
  fakeConnections,
  fakeDomains,
} from './infrastructure/fake-providers.js';
import { domainsFrom } from './infrastructure/vercel-domains.js';
import { connectionsFrom } from './infrastructure/calendars.js';
import { indeedFrom } from './infrastructure/indeed.js';
import { ownBoards } from './application/boards.js';
import { mailerFrom } from './infrastructure/messaging.js';
import { listingsFrom } from './infrastructure/listings.js';
import { extract } from './infrastructure/text.js';
import { drizzleUnitOfWork, recruitingDatabase } from './infrastructure/unit-of-work.js';

/**
 * Recruiting's composition root (REC-004, REC-060), Documents' shape. With
 * `RECRUITING_DATABASE_URL`: the Drizzle unit of work, the sealed blob store,
 * and the router's caller resolved to the member it signs in as. Without it,
 * `/healthz` and the schema only, every field UNAVAILABLE — what
 * `just supergraph` reads.
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

export function composeRecruiting(env: NodeJS.ProcessEnv = process.env): Promise<Composed> {
  const db = recruitingDatabase(env);
  if (db === null) {
    logger.warn(
      { module: 'recruiting' },
      'RECRUITING_DATABASE_URL is not set; serving the schema only',
    );
    const yoga = createYoga(yogaOptions);
    return Promise.resolve({
      listener: recruitingListener((request, response) => {
        void yoga(request, response);
      }),
      storage: null,
    });
  }
  const uow = drizzleUnitOfWork(db);
  const internalToken = env['RECRUITING_API_TOKEN'] ?? env['INTERNAL_API_TOKEN'] ?? '';
  const recorded: RecordedEntitlements = async (tenantId) => {
    const kept = (await uow.run(TenantId.parse(tenantId), (tx) =>
      tx.settings.get('entitlements'),
    )) as { entitlements: string[] } | null;
    return kept?.entitlements ?? null;
  };
  const mailer = mailerFrom(env);
  const listings = listingsFrom(env);
  const model = modelFrom(env);
  const sealer = sealerFrom(env);
  // Stand-ins until a company chooses a provider; never in production.
  const fakes = env['RECRUITING_FAKE_PROVIDERS'] === '1' && env['NODE_ENV'] !== 'production';
  const domains = domainsFrom(env) ?? (fakes ? fakeDomains() : undefined);
  const jobsOrigin = env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com';
  const indeed = indeedFrom(env);
  const configured = connectionsFrom(env);
  const connections = configured.length === 0 && fakes ? fakeConnections() : configured;
  const inboundDomain = env['INBOUND_DOMAIN'];
  const messagingToken = env['MESSAGING_RECRUITING_TOKEN'];
  const { listener, deps } = recruitingServer(
    {
      uow,
      blobs: blobsFrom(env),
      jobsOrigin,
      extractText: extract,
      callerFrom: withMember(callerFromHeaders(internalToken, recorded), uow),
      ...(mailer === undefined ? {} : { mailer }),
      ...(listings === null ? {} : { listings }),
      ...(model === undefined ? {} : { model }),
      ...(sealer === undefined ? {} : { sealer }),
      ...(domains === undefined ? {} : { domains }),
      ...(connections.length === 0 ? {} : { connections }),
      ...(indeed === undefined ? {} : { boards: [...ownBoards(jobsOrigin), indeed] }),
      ...(fakes
        ? { assessmentProvider: fakeAssessments(), backgroundChecks: fakeBackgroundChecks() }
        : {}),
      ...(inboundDomain && messagingToken
        ? { inbound: { domain: inboundDomain, token: messagingToken } }
        : {}),
    },
    uuidv7,
  );
  return Promise.resolve({ listener, storage: { db, uow, deps } });
}
