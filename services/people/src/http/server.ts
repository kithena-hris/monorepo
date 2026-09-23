import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { systemClock, type DomainFailure } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';

import { outboxExportAudit, type ExportJobDeps } from '../application/export/job.js';
import {
  claimDownload,
  fullValuesOf,
  type FullValuesDeps,
} from '../application/export/full-values.js';
import { drizzleFullValuesStore } from '../application/export/full-values-store.js';
import { drizzleExportLedger } from '../application/export/ledger.js';
import { keyOf } from '../application/export/object-store.js';
import type { ExportQueue } from '../application/export/queue.js';
import { orgAdmin } from '../application/org/org.js';
import { uuidv7 } from '../application/person/ids.js';
import { inTenantResult } from '../application/person/person-access.js';
import { personAccess } from '../application/person/person-access.js';
import type { PeopleService } from '../application/person/service.js';
import { configureGraphQL } from '../graphql/schema.js';
import { drizzleOrgStore } from '../infrastructure/drizzle-org-store.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import {
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../infrastructure/drizzle-person-reader.js';
import { keysFrom, staticKeyRing } from '../infrastructure/envelope.js';
import { exportStoreFrom, startExportRunner } from '../infrastructure/export-queue.js';
import { startFullValues } from '../infrastructure/temporal/full-values.js';
import { drizzleSecretStore } from '../infrastructure/secret-store.js';
import { drizzleUniqueClaims } from '../infrastructure/unique.js';
import { knownTenants } from '../infrastructure/tenants.js';
import { tenantTransaction } from '../infrastructure/unit-of-work.js';
import { webhookAlertMailerFrom } from '../infrastructure/webhooks/alert-mailer.js';
import { pinnedPoster, systemResolver } from '../infrastructure/webhooks/egress.js';
import { webhooks } from '../infrastructure/webhooks/webhooks.js';
import { callerFromHeaders } from './caller.js';
import { drizzleIdempotency } from './idempotency.js';
import { openApiDocument } from './openapi.js';
import { restHandler, type RestDeps, type RestResponse } from './rest.js';

/**
 * The composition root for People's transports, called once from `main.ts`.
 *
 * With no `PEOPLE_DATABASE_URL` nothing is wired and the subgraph still
 * serves its schema, so `just supergraph` can introspect a module that has no
 * database behind it. Every operation then answers UNAVAILABLE rather than
 * pretending.
 */

/** How often every known tenant's due deliveries are looked for. */
const POLL_MS = 60_000;

export function peopleService(databaseUrl: string, secretKeys: string | undefined): PeopleService {
  const db = drizzle(postgres(databaseUrl));
  const ring = staticKeyRing(keysFrom(secretKeys));
  const raw = tenantTransaction(db);
  const schemas = drizzleSchemaVersions();

  // Plain http only when a developer says so; production has no such switch set.
  const egress = {
    resolve: systemResolver,
    allowHttp:
      process.env['NODE_ENV'] !== 'production' && process.env['PEOPLE_WEBHOOKS_ALLOW_HTTP'] === '1',
  };
  const alerts = webhookAlertMailerFrom(process.env);
  const hooks = webhooks({
    inTenant: raw,
    ring,
    egress,
    post: pinnedPoster(egress),
    clock: systemClock,
    newId: uuidv7,
    // The event is already in the outbox; this is the email beside it.
    notify: async (tenantId, disabled) => {
      logger.warn(
        { tenantId, endpointId: disabled.endpointId, lastResponse: disabled.lastResponse },
        'webhook endpoint disabled',
      );
      if (alerts === undefined || disabled.alertEmail === null) return;
      await alerts.send(tenantId, disabled).catch((cause: unknown) => {
        logger.warn({ err: cause, tenantId, endpointId: disabled.endpointId }, 'alert not sent');
      });
    },
    schemas,
  });

  /*
   * Deliveries are sent after any transaction for their tenant commits, again
   * when the earliest retry falls due, and by a poller over every known tenant
   * on boot and every minute (PEO-093).
   *
   * The timer is in-process and a restart forgets it; the poller is what makes
   * that harmless. The schedule is `next_attempt_at` on each row, so a fresh
   * process's first poll resumes every retry that fell due while it was down,
   * and the claim in `deliverDue` keeps two replicas from sending one twice.
   */
  const running = new Set<string>();
  const timers = new Map<string, NodeJS.Timeout>();
  const pass = async (tenantId: string): Promise<void> => {
    if (running.has(tenantId)) return;
    running.add(tenantId);
    try {
      await hooks.deliverDue(tenantId);
      const due = await hooks.nextDue(tenantId);
      clearTimeout(timers.get(tenantId));
      if (due !== null) {
        const wait = Math.max(due.getTime() - Date.now(), 1000);
        timers.set(
          tenantId,
          setTimeout(() => {
            kick(tenantId);
          }, wait).unref(),
        );
      }
    } catch (cause) {
      logger.error({ err: cause, tenantId }, 'webhook delivery pass failed');
    } finally {
      running.delete(tenantId);
    }
  };
  const kick = (tenantId: string): void => {
    void pass(tenantId);
  };

  // One tenant at a time, each pass bounded by `deliverDue`'s own limits.
  const poll = async (): Promise<void> => {
    try {
      for (const tenantId of await knownTenants(db)) await pass(tenantId);
    } catch (cause) {
      logger.error({ err: cause }, 'webhook poll failed');
    }
  };
  void poll();
  setInterval(() => void poll(), POLL_MS).unref();

  return {
    access: personAccess({
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      schemas,
      relations: drizzleRelations(),
      secrets: drizzleSecretStore(ring, logger),
      uniques: drizzleUniqueClaims(ring),
      clock: systemClock,
      newId: uuidv7,
    }),
    schemas,
    org: orgAdmin({ store: drizzleOrgStore(), clock: systemClock, newId: uuidv7 }),
    inTenant: async (tenantId, fn) => {
      const result = await raw(tenantId, fn);
      kick(tenantId);
      return result;
    },
  };
}

/** The export pipeline: the store, the ledger and the queue, from the environment. */
function wireExports(service: PeopleService): {
  deps: ExportJobDeps;
  queue: ExportQueue;
  fullValues: NonNullable<RestDeps['fullValues']>;
} {
  const secrets = drizzleSecretStore(
    staticKeyRing(keysFrom(process.env['PEOPLE_SECRET_KEYS'])),
    logger,
  );
  const deps: ExportJobDeps = {
    access: service.access,
    schemas: service.schemas,
    relations: drizzleRelations(),
    clock: systemClock,
    records: {
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      secrets,
    },
    store: exportStoreFrom(process.env),
    // ponytail: the requester learns the export is ready from
    // `people.export.completed` and fetches the links from `GET
    // /v1/exports/{id}`. An email through platform/messaging is the upgrade,
    // once it has an export-ready message (as PEO-084 needs for reminders).
    notifier: {
      notify: ({ tenantId, exportId, recipientAccountId }) => {
        logger.info({ tenantId, exportId, recipientAccountId }, 'export ready');
        return Promise.resolve();
      },
    },
    audit: outboxExportAudit,
    ledger: drizzleExportLedger(),
    newId: uuidv7,
  };
  const runner = startExportRunner(process.env, service.inTenant, deps);
  runner.catch((cause: unknown) => {
    logger.error({ err: cause }, 'export queue did not start');
  });

  // Full values (PEO-088): `reveal` is the audited read, called only while an
  // approved file is being built.
  const full: FullValuesDeps = {
    ...deps,
    requests: drizzleFullValuesStore(),
    reveal: (tx, where) => secrets.reveal(tx, where),
  };
  const workflows = startFullValues(process.env, service.inTenant, full);
  workflows.catch((cause: unknown) => {
    logger.error({ err: cause }, 'full-values workflows did not start');
  });

  return {
    deps,
    queue: { enqueue: async (job) => (await runner).enqueue(job) },
    fullValues: {
      deps: full,
      started: async (...args) => (await workflows).started(...args),
      decided: async (...args) => (await workflows).decided(...args),
    },
  };
}

async function download(
  service: PeopleService,
  deps: FullValuesDeps,
  path: string,
  response: ServerResponse,
): Promise<void> {
  const refuse = (error: DomainFailure) => {
    send(response, {
      status: error.code === 'LINK_INVALID' ? 404 : 410,
      body: { error: { code: error.code, message: error.message } },
    });
  };
  try {
    const link = `http://people.internal${path}`;
    const opened = await deps.store.open(link);
    if (!opened.ok) {
      refuse(opened.error);
      return;
    }
    // A full-values file is one download: spent here, after the signature
    // checked out and before a byte leaves.
    const owner = fullValuesOf(keyOf(link) ?? '');
    if (owner) {
      const claimed = await inTenantResult(service.inTenant, owner.tenantId, (tx) =>
        claimDownload(tx, deps, { ...owner, correlationId: uuidv7() }),
      );
      if (!claimed.ok) {
        refuse(claimed.error);
        return;
      }
    }
    const name =
      decodeURIComponent(new URL(path, 'http://x').pathname).split('/').at(-1) ?? 'export';
    response.writeHead(200, {
      'content-type': opened.value.mediaType,
      'content-disposition': `attachment; filename="${name.replaceAll('"', '')}"`,
      'cache-control': 'no-store',
    });
    response.end(Buffer.from(opened.value.bytes));
  } catch (cause) {
    logger.error({ err: cause }, 'export download failed');
    if (!response.headersSent) {
      send(response, {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
      });
    }
  }
}

const MAX_BODY = 256 * 1024;

async function bodyOf(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, answer: RestResponse): void {
  response.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
  response.end(JSON.stringify(answer.body));
}

/**
 * Put REST in front of the subgraph on the same port.
 *
 * `/v1/*` is REST and `/v1/openapi.json` its document; everything else goes
 * to whichever listener `main.ts` installed, which is Yoga.
 */
export function wirePeople(server: Server): void {
  const url = process.env['PEOPLE_DATABASE_URL'];
  if (!url) {
    logger.warn({ module: 'people' }, 'PEOPLE_DATABASE_URL is not set; serving the schema only');
    return;
  }

  const service = peopleService(url, process.env['PEOPLE_SECRET_KEYS']);
  const callerFrom = callerFromHeaders(
    process.env['PEOPLE_API_TOKEN'] ?? process.env['INTERNAL_API_TOKEN'] ?? '',
  );
  configureGraphQL({ service, callerFrom });

  const exports = wireExports(service);
  const rest = restHandler({
    service,
    callerFrom,
    idempotency: drizzleIdempotency(),
    exports,
    fullValues: exports.fullValues,
  });
  const document = JSON.stringify(openApiDocument());
  const [graphql] = server.listeners('request') as ((
    request: IncomingMessage,
    response: ServerResponse,
  ) => void)[];
  server.removeAllListeners('request');

  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ?? '/';
    if (!path.startsWith('/v1/')) {
      graphql?.(request, response);
      return;
    }
    // A signed link carries its own authority and no caller headers: it is
    // opened from a browser, and its signature and expiry are the whole check.
    if (request.method === 'GET' && path.startsWith('/v1/exports/files/')) {
      void download(service, exports.fullValues.deps, path, response);
      return;
    }
    if (path === '/v1/openapi.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(document);
      return;
    }
    void (async () => {
      try {
        const body = await bodyOf(request);
        if (body === null) {
          send(response, {
            status: 413,
            body: { error: { code: 'TOO_LARGE', message: 'Body too large' } },
          });
          return;
        }
        const answer = await rest({
          method: request.method ?? 'GET',
          url: path,
          headers: request.headers,
          body,
        });
        send(
          response,
          answer ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: path } } },
        );
      } catch (cause) {
        logger.error({ err: cause, path }, 'people REST request failed');
        if (!response.headersSent) {
          send(response, {
            status: 500,
            body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
          });
        }
      }
    })();
  });
}
