import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { systemClock, type DomainFailure } from '@kithena/domain-kit';
import {
  aiGateway,
  drain,
  logger,
  onShutdown,
  tenantPolicies,
  type Prompt,
} from '@kithena/telemetry';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { presentsInternalToken } from '@kithena/auth-kit';
import { sql } from 'drizzle-orm';
import * as z from 'zod';

import { recomputePerson } from '../application/completeness/recompute.js';
import { sweepReminders } from '../application/completeness/reminders.js';
import { outboxExportAudit, type ExportJobDeps } from '../application/export/job.js';
import {
  claimDownload,
  fullValuesOf,
  type FullValuesDeps,
} from '../application/export/full-values.js';
import { drizzleFullValuesStore } from '../application/export/full-values-store.js';
import { drizzleExportLedger } from '../application/export/ledger.js';
import { keyOf, type ObjectStore } from '../application/export/object-store.js';
import type { ExportQueue } from '../application/export/queue.js';
import { orgAdmin } from '../application/org/org.js';
import { payBands } from '../application/analytics/pay.js';
import { upcomingErasures } from '../application/retention/sweep.js';
import { drizzleRetentionStore } from '../infrastructure/drizzle-retention-store.js';
import { publish } from '@kithena/db-kit';
import { outbox } from '../infrastructure/tables.js';
import { tenantRoles } from '../application/roles/roles.js';
import { drizzleRoleStore } from '../infrastructure/drizzle-role-store.js';
import { uuidv7 } from '../application/person/ids.js';
import { inTenantResult } from '../application/person/person-access.js';
import { personAccess } from '../application/person/person-access.js';
import type { RelationsResolver } from '../application/person/ports.js';
import { withSources, withSubjects, withSupport } from '../application/person/subject.js';
import { scimConnections } from '../application/scim/connections.js';
import { scimProvisioning } from '../application/scim/provisioning.js';
import { drizzleScimStore } from '../infrastructure/drizzle-scim-store.js';
import type { PeopleService } from '../application/person/service.js';
import { configureGraphQL } from '../graphql/schema.js';
import { chatAct, parseChatAction } from './chat.js';
import { chatAppsFrom } from '../infrastructure/chat-apps.js';
import { sealExisting } from '../infrastructure/seal-existing.js';
import { drizzleChatNotices } from '../infrastructure/drizzle-chat-notices.js';
import { drizzleEmployeeNumbers, drizzleOrgStore } from '../infrastructure/drizzle-org-store.js';
import { drizzleCompletenessStore } from '../infrastructure/drizzle-completeness-store.js';
import { drizzlePersonRepository } from '../infrastructure/drizzle-person-repository.js';
import {
  drizzleGapFigures,
  drizzleGapTotals,
  drizzlePersonReader,
  drizzleRelations,
  drizzleSchemaVersions,
} from '../infrastructure/drizzle-person-reader.js';
import { keysFrom, open, seal, staticKeyRing } from '../infrastructure/envelope.js';
import type { Holding } from '../application/person/pending-changes.js';
import {
  drizzlePendingChangeStore,
  outboxPendingChanges,
} from '../application/person/pending-store.js';
import { exportStoreFrom, startExportRunner } from '../infrastructure/export-queue.js';
import { startFullValues } from '../infrastructure/temporal/full-values.js';
import { drizzleSecretStore } from '../infrastructure/secret-store.js';
import { drizzleIdentifierReviews } from '../infrastructure/drizzle-identifier-reviews.js';
import { drizzleDuplicates } from '../infrastructure/drizzle-duplicates.js';
import { drizzleUniqueClaims } from '../infrastructure/unique.js';
import { knownTenants } from '../infrastructure/tenants.js';
import { openFgaFrom } from '../infrastructure/openfga.js';
import {
  insideSharedUnit,
  isViewOnlyRefusal,
  readOnly,
  tenantTransaction,
} from '../infrastructure/unit-of-work.js';
import { ViewOnly } from '../domain/access/view-as.js';
import type { ViewAsDeps } from '../application/person/view-as.js';
import {
  drizzleAccountOf,
  drizzleViewedAs,
  viewAsIdentityFrom,
} from '../infrastructure/view-as.js';
import { webhookAlertMailerFrom } from '../infrastructure/webhooks/alert-mailer.js';
import {
  NO_TENANT_APP_BASE,
  tenantAppBase,
  tenantCompanies,
} from '../infrastructure/tenant-origin.js';
import { egressPolicyFrom, pinnedPoster } from '../infrastructure/webhooks/egress.js';
import { webhooks, type WebhookService } from '../infrastructure/webhooks/webhooks.js';
import { listDeliveries, listEndpoints } from '../infrastructure/webhooks/list.js';
import {
  drizzleImportLedger,
  drizzleReportIndex,
  drizzleRowScope,
  drizzleUploadIntents,
} from '../application/import/ledger.js';
import type { UploadStore } from '../application/import/upload.js';
import { UPLOAD_LIFETIME_MS } from '../domain/import/upload.js';
import { uploadStoreFrom } from '../infrastructure/s3-uploads.js';
import { drizzlePhotos } from '../infrastructure/drizzle-photos.js';
import { drizzleDetailRequests } from '../infrastructure/drizzle-detail-requests.js';
import { drizzleFiles } from '../infrastructure/drizzle-files.js';
import { drizzleActivity } from '../infrastructure/drizzle-activity.js';
import { drizzleTransfers } from '../infrastructure/drizzle-transfers.js';
import { askFromChat, type ChatDeps } from '../application/assistant/from-chat.js';
import { chatModel, modelConfigFrom } from '../infrastructure/assistant/model.js';
import { PlanBudget } from '../domain/import/new-fields.js';
import { loadTenantPolicies } from '../infrastructure/policy-registry.js';
import { reminderMailerFrom } from '../infrastructure/reminder-mailer.js';
import { publishSchema } from '../application/schema/publish-schema.js';
import {
  drizzleDraftWriter,
  drizzlePeopleFacts,
  drizzleSchemaRepository,
} from '../infrastructure/drizzle-schema-repository.js';
import { typesafeAttributeAdvisorFromEnv } from '../infrastructure/typesafe-attribute-advisor.js';
import { drizzleSegments } from '../infrastructure/drizzle-segments.js';
import { drizzleReportSchedules } from '../infrastructure/drizzle-report-schedules.js';
import { reportMailerFrom, summaryMailerFrom } from '../infrastructure/report-mailer.js';
import { drizzleSharedSummaries } from '../infrastructure/drizzle-shared-summaries.js';
import { sendDueReports, type ScheduleAdminDeps } from '../application/reports/scheduled.js';
import { BODY_LIMIT, screenRoutes, type ScreenRouteDeps } from './screens.js';
import { callerWithEntitlements, viewingRequest, withTenantRoles } from './caller.js';
import { recordedEntitlements } from '../infrastructure/entitlements.js';
import { drizzleIdempotency } from './idempotency.js';
import { openApiDocument } from './openapi.js';
import { refused, restHandler, type RestDeps, type RestResponse } from './rest.js';
import { SCIM_PREFIX, scimHandler } from './scim.js';

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

/**
 * OpenFGA when `OPENFGA_URL` is set; otherwise the org chart the rows
 * describe and the roles the principal carries — the standalone answer, and
 * what `just standalone people` runs.
 */
export function relationsFrom(env: NodeJS.ProcessEnv): RelationsResolver {
  // Each answer about one person carries that person's facts, for custom
  // visibility rules (PEO-066), and the attributes an upstream system owns
  // on them (PEO-073), on every path that reads through it.
  return withSources(
    withSubjects(
      withSupport(openFgaFrom(env)?.relations ?? drizzleRelations()),
      drizzlePersonReader(),
    ),
    drizzleScimStore(),
  );
}

export function peopleService(
  databaseUrl: string,
  secretKeys: string | undefined,
): PeopleService & {
  readonly webhooks: WebhookService;
  /** Sealed values: where publishing a newly encrypted field moves the plain ones. */
  readonly secrets: ReturnType<typeof drizzleSecretStore>;
  tenants(): Promise<string[]>;
  close(): Promise<void>;
} {
  const client = postgres(databaseUrl);
  const db = drizzle(client);
  const ring = staticKeyRing(keysFrom(secretKeys));
  const raw = tenantTransaction(db);
  const schemas = drizzleSchemaVersions();

  // Plain http or a loopback receiver only when a developer or a test says so;
  // production ignores both switches (`egressPolicyFrom`).
  const egress = egressPolicyFrom(process.env);
  // No base (production without a safe `TENANT_APP_BASE`): no alert email,
  // the event alone — never a link to localhost.
  const base = tenantAppBase(process.env);
  if (base === null) logger.error({ variable: 'TENANT_APP_BASE' }, NO_TENANT_APP_BASE);
  const alerts = base === null ? undefined : webhookAlertMailerFrom(process.env);
  const companyOf = tenantCompanies(base ?? '', drizzleOrgStore());
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
      // From the company, to its own origin — or not at all: the event stands.
      const company = await raw(tenantId, ({ tx }) => companyOf(tx, tenantId));
      if (company === null) {
        logger.info({ tenantId }, 'company not known yet; webhook alert not emailed');
        return;
      }
      await alerts.send(tenantId, company, disabled).catch((cause: unknown) => {
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
  const passes = new Set<Promise<void>>();
  const kick = (tenantId: string): void => {
    if (closed) return;
    const p = pass(tenantId);
    passes.add(p);
    void p.finally(() => passes.delete(p));
  };

  // One tenant at a time, each pass bounded by `deliverDue`'s own limits.
  let closed = false;
  const poll = async (): Promise<void> => {
    try {
      for (const tenantId of await knownTenants(db)) {
        if (closed) return;
        await pass(tenantId);
      }
    } catch (cause) {
      logger.error({ err: cause }, 'webhook poll failed');
    }
  };
  let polling = poll();
  const poller = setInterval(() => {
    polling = poll();
  }, POLL_MS).unref();

  const org = drizzleOrgStore();
  const numbers = drizzleEmployeeNumbers();
  const secrets = drizzleSecretStore(ring, logger);
  // Changes held for approval (PEO-077), a sealed one under the secrets' ring.
  const holding: Holding = {
    store: drizzlePendingChangeStore({
      seal: (plaintext) => seal(plaintext, ring),
      open: (sealed) => open(sealed, ring),
    }),
    publish: outboxPendingChanges,
    clock: systemClock,
    newId: uuidv7,
  };
  const reader = drizzlePersonReader();
  const relations = relationsFrom(process.env);
  // Doubted national identifiers, queued for HR (PEO-125).
  const reviews = drizzleIdentifierReviews(ring, secrets);
  const access = personAccess({
    people: drizzlePersonRepository(),
    reader,
    schemas,
    relations,
    approvals: holding,
    secrets,
    reviews,
    duplicates: drizzleDuplicates(),
    uniques: drizzleUniqueClaims(ring),
    clock: systemClock,
    newId: uuidv7,
    calendars: org,
    numbering: numbers,
    // A leaver's tenant roles go when their access does (PEO-113's lane).
    roles: tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 }),
    completeness: recomputePerson({
      schema: drizzleSchemaRepository(),
      people: drizzlePeopleFacts(),
      store: drizzleCompletenessStore(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars: org,
    }),
  });
  return {
    access,
    // Who holds `hr` decides whether a requester approves alone (PEO-077); a
    // doubted identifier waits on its review (PEO-125).
    pending: { ...holding, access, schemas, reader, relations, roles: drizzleRoleStore(), reviews },
    schemas,
    org: orgAdmin({ store: org, numbers, clock: systemClock, newId: uuidv7 }),
    roles: tenantRoles({ store: drizzleRoleStore(), clock: systemClock, newId: uuidv7 }),
    upcomingErasures: upcomingErasures({ store: drizzleRetentionStore(), clock: systemClock }),
    payBands: payBands({
      clock: systemClock,
      newId: uuidv7,
      publish: (tx, events) => publish(tx, outbox, events),
    }),
    inTenant: async (tenantId, fn) => {
      const result = await raw(tenantId, fn);
      // Not from inside `sharing` (a screen's keyed write): nothing has
      // committed yet, and a pass started there inherits the request's
      // transaction through AsyncLocalStorage, runs its queries as savepoints
      // on it, and hangs once it commits — holding `running` for the tenant,
      // so no delivery went out again until a restart. The outermost unit,
      // which is outside, kicks after its commit (found in PEO-060).
      if (!insideSharedUnit()) kick(tenantId);
      return result;
    },
    webhooks: hooks,
    secrets,
    tenants: () => knownTenants(db),
    /** The poller and the retry timers stop, the passes in hand finish, then the pool (PEO-118). */
    async close() {
      closed = true;
      clearInterval(poller);
      for (const timer of timers.values()) clearTimeout(timer);
      await Promise.all([polling, ...passes]);
      await client.end();
    },
  };
}

/** The export pipeline: the store, the ledger and the queue, from the environment. */
function wireExports(service: PeopleService): {
  deps: ExportJobDeps;
  queue: ExportQueue;
  close(): Promise<void>;
  fullValues: NonNullable<RestDeps['fullValues']>;
} {
  const secrets = drizzleSecretStore(
    staticKeyRing(keysFrom(process.env['PEOPLE_SECRET_KEYS'])),
    logger,
  );
  const deps: ExportJobDeps = {
    // The export's day is the tenant's (PRD §6.8).
    calendars: drizzleOrgStore(),
    access: service.access,
    schemas: service.schemas,
    relations: relationsFrom(process.env),
    clock: systemClock,
    records: {
      people: drizzlePersonRepository(),
      reader: drizzlePersonReader(),
      secrets,
    },
    // Photos for an export that asks for them, and for a record PDF.
    photos: drizzlePhotos(),
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
    // A worker that never started has nothing to close.
    close: async () => {
      await Promise.all([
        runner.then(
          (r) => r.close(),
          () => undefined,
        ),
        workflows.then(
          (w) => w.close(),
          () => undefined,
        ),
      ]);
    },
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

async function bodyOf(request: IncomingMessage, limit: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(response: ServerResponse, answer: RestResponse): void {
  // A file (a CSV) goes out as its bytes, typed by the route; anything else is JSON.
  if (answer.body instanceof Uint8Array) {
    response.writeHead(answer.status, answer.headers);
    response.end(answer.body);
    return;
  }
  response.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
  response.end(JSON.stringify(answer.body));
}

/** Asking for a detail: recorded always, emailed where the reminder's mailer is configured. */
function detailRequests(
  calendars: ReturnType<typeof drizzleOrgStore>,
  service: ReturnType<typeof peopleService>,
) {
  const mailer = reminderMailerFrom(process.env, service.inTenant, 'details_requested');
  const base = tenantAppBase(process.env);
  return {
    store: drizzleDetailRequests(),
    ...(mailer === undefined || base === null
      ? {}
      : { mailer, company: tenantCompanies(base, calendars) }),
  };
}

/**
 * "Remind N people": the hourly sweep's own function, run for one tenant on
 * HR's press, where the reminder can be sent at all. Its claim is what keeps
 * the weekly cap, so this process and the background one never both send.
 */
function remindNow(
  calendars: ReturnType<typeof drizzleOrgStore>,
  service: ReturnType<typeof peopleService>,
) {
  const mailer = reminderMailerFrom(process.env, service.inTenant);
  const base = tenantAppBase(process.env);
  return mailer === undefined || base === null
    ? {}
    : {
        remindNow: sweepReminders({
          inTenant: (tenantId, fn) => service.inTenant(tenantId, ({ tx }) => fn({ tx, tenantId })),
          store: drizzleCompletenessStore(),
          mailer,
          clock: systemClock,
          calendars,
          company: tenantCompanies(base, calendars),
        }),
      };
}

/** The chat apps this deployment has, and People's notices to them. */
function chatFrom(env: NodeJS.ProcessEnv) {
  const apps = chatAppsFrom(env);
  return apps.length === 0 ? {} : { chat: { apps, notices: drizzleChatNotices() } };
}

/** A question from Slack: which company, whose verified email, and the words. */
const ChatQuestion = z.strictObject({
  tenantId: z.uuid(),
  email: z.email().max(320),
  question: z.string().trim().min(1).max(500),
});

/** The assistant, where a model is configured (`ASSISTANT_*`); nothing otherwise. */
function assistantFrom(env: NodeJS.ProcessEnv) {
  const config = modelConfigFrom(env);
  if (config === null) return {};
  const gateway = aiGateway({ registry: tenantPolicies, send: chatModel(config) });
  return {
    assistant: {
      complete: (tenantId: string, prompt: Prompt) => gateway.complete(tenantId, prompt),
      loadPolicies: (tx: PostgresJsDatabase, tenantId: string) =>
        loadTenantPolicies(tx, tenantId, tenantPolicies),
    },
  };
}

/** What the screens' transports need beyond the person use cases (PEO-098). */
/** Viewing as an employee: People decides, identity signs in (`application/person/view-as.ts`). */
function viewAsDeps(service: ReturnType<typeof peopleService>): ViewAsDeps {
  const identity = viewAsIdentityFrom(process.env);
  return {
    service,
    relations: relationsFrom(process.env),
    accountOf: drizzleAccountOf,
    ...(identity === undefined ? {} : { identity }),
  };
}

/**
 * New fields from an import (docs/ai-settings.md): the assistant's own model
 * (`ASSISTANT_*`), behind the AI gateway, with room for a chunk of columns'
 * proposals and well inside the shell's two-minute write; twenty proposals an
 * hour per company. With no model configured, People's own proposal.
 */
function newFieldsFrom(env: NodeJS.ProcessEnv): NonNullable<ScreenRouteDeps['newFields']> {
  const config = modelConfigFrom(env);
  const budget = new PlanBudget(Number(env['IMPORT_FIELDS_PLANS_PER_HOUR'] ?? 20), 3_600_000);
  if (config === null) return { budget };
  const gateway = aiGateway({
    registry: tenantPolicies,
    send: chatModel({ ...config, maxTokens: 6_000, timeoutMs: 60_000 }),
  });
  return {
    budget,
    planner: {
      complete: (tenantId: string, prompt: Prompt) => gateway.complete(tenantId, prompt),
      loadPolicies: (tx: PostgresJsDatabase, tenantId: string) =>
        loadTenantPolicies(tx, tenantId, tenantPolicies),
    },
  };
}

/**
 * Insights' "what changed", reworded by the assistant's own model
 * (`ASSISTANT_*`) behind the AI gateway in its `aggregates` mode: a short,
 * interactive call, eight seconds at most, sixty an hour per company
 * (`INSIGHTS_PHRASES_PER_HOUR`). With no model configured, People's own words.
 */
function insightsPhraserFrom(env: NodeJS.ProcessEnv): Pick<ScreenRouteDeps, 'insightsPhraser'> {
  const config = modelConfigFrom(env);
  if (config === null) return {};
  const gateway = aiGateway({
    registry: tenantPolicies,
    send: chatModel({ ...config, timeoutMs: 8_000 }),
  });
  return {
    insightsPhraser: {
      budget: new PlanBudget(Number(env['INSIGHTS_PHRASES_PER_HOUR'] ?? 60), 3_600_000),
      assistant: {
        complete: (tenantId: string, prompt: Prompt) => gateway.complete(tenantId, prompt),
        loadPolicies: (tx: PostgresJsDatabase, tenantId: string) =>
          loadTenantPolicies(tx, tenantId, tenantPolicies),
      },
    },
  };
}

/**
 * Sending an Insights summary (design AI6, MA5): stored for the recipient,
 * announced by messaging as a link to the tenant app. Without a mailer or a
 * safe tenant app base, Send is not offered; the summary still downloads.
 */
function insightsSharesFrom(env: NodeJS.ProcessEnv): Pick<ScreenRouteDeps, 'insightsShares'> {
  const base = tenantAppBase(env);
  const mailer = base === null ? undefined : summaryMailerFrom(env);
  return {
    insightsShares: {
      store: drizzleSharedSummaries(),
      ...(mailer === undefined ? {} : { mailer }),
      company:
        base === null ? () => Promise.resolve(null) : tenantCompanies(base, drizzleOrgStore()),
      accounts: scheduleAdmin().accounts,
      newId: uuidv7,
    },
  };
}

/**
 * Search and export in words (docs/ai-settings.md): the assistant's own model
 * (`ASSISTANT_*`), behind the AI gateway, with eight seconds to answer because
 * somebody is waiting at the search box. Budgets per company per hour; with no
 * model configured, People's own rules read the sentence.
 */
function selectionFrom(env: NodeJS.ProcessEnv): NonNullable<ScreenRouteDeps['selection']> {
  const config = modelConfigFrom(env);
  const search = new PlanBudget(Number(env['SEARCH_PLANS_PER_HOUR'] ?? 120), 3_600_000);
  const exports = new PlanBudget(Number(env['EXPORT_PLANS_PER_HOUR'] ?? 30), 3_600_000);
  if (config === null) return { search, export: exports };
  const gateway = aiGateway({
    registry: tenantPolicies,
    send: chatModel({ ...config, maxTokens: 2_048, timeoutMs: 8_000 }),
  });
  return {
    search,
    export: exports,
    planner: {
      complete: (tenantId: string, prompt: Prompt) => gateway.complete(tenantId, prompt),
      loadPolicies: (tx: PostgresJsDatabase, tenantId: string) =>
        loadTenantPolicies(tx, tenantId, tenantPolicies),
    },
  };
}

function screenDeps(
  service: ReturnType<typeof peopleService>,
  reports: ObjectStore,
  uploads: UploadStore | null,
): ScreenRouteDeps {
  const schema = drizzleSchemaRepository();
  const reader = drizzlePersonReader();
  const base = (process.env['PEOPLE_PUBLIC_URL'] ?? 'http://localhost:4001').replace(/\/$/, '');
  const calendars = drizzleOrgStore();
  return {
    service,
    viewAs: viewAsDeps(service),
    viewedAs: drizzleViewedAs,
    scim: scimConnections({
      service,
      relations: relationsFrom(process.env),
      store: drizzleScimStore(),
      clock: systemClock,
      newId: uuidv7,
    }),
    scimUrl: scimUrl(),
    relations: relationsFrom(process.env),
    clock: systemClock,
    calendars,
    personOf: (tx, tenantId, accountId) => reader.personOf(tx, tenantId, accountId),
    gapTotals: drizzleGapTotals(),
    gapFigures: drizzleGapFigures(),
    ...remindNow(calendars, service),
    segments: { store: drizzleSegments(), newId: uuidv7 },
    photos: drizzlePhotos(),
    files: drizzleFiles(),
    transfers: drizzleTransfers(),
    ...assistantFrom(process.env),
    newFields: newFieldsFrom(process.env),
    ...insightsPhraserFrom(process.env),
    ...insightsSharesFrom(process.env),
    selection: selectionFrom(process.env),
    photoAtSignup: async (tx, tenantId) => (await calendars.settings(tx, tenantId)).photoAtSignup,
    requests: detailRequests(calendars, service),
    ...chatFrom(process.env),
    schedules: scheduleAdmin(),
    schema,
    draft: drizzleDraftWriter(),
    publisher: publishSchema({
      schema,
      people: drizzlePeopleFacts(),
      clock: systemClock,
      newEventId: uuidv7,
      calendars,
      sealExisting: sealExisting(service.secrets),
    }),
    artifactUrl: (version) => `${base}/v1/schema/versions/${String(version)}`,
    webhooks: service.webhooks,
    listEndpoints,
    listDeliveries,
    advisor: typesafeAttributeAdvisorFromEnv(process.env),
    commit: {
      ledger: drizzleImportLedger(),
      rowScope: drizzleRowScope,
      newId: uuidv7,
      // The export's store: its key seals the report, and its download route
      // is the one that opens the link. The index names who each contains.
      reports: { store: reports, index: drizzleReportIndex() },
      calendars,
    },
    // The bucket the browser uploads an import to (§14.2), and who may.
    uploads: { store: uploads, intents: drizzleUploadIntents() },
  };
}

/** Where SCIM is served publicly (§13.5): what an administrator pastes into Okta or Entra. */
function scimUrl(): string {
  const explicit = process.env['PEOPLE_SCIM_URL'];
  const base = (process.env['PEOPLE_PUBLIC_URL'] ?? 'http://localhost:4001').replace(/\/$/, '');
  return (explicit ?? `${base}${SCIM_PREFIX}`).replace(/\/$/, '');
}

/** The deployment's module list, for a company whose own is not recorded; none when unset. */
function deploymentEntitlements(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(process.env['KITHENA_ENTITLEMENTS'] ?? '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Scheduled reports as HR's screens manage them (PEO-069). */
function scheduleAdmin(): ScheduleAdminDeps {
  return {
    schedules: drizzleReportSchedules(),
    segments: drizzleSegments(),
    accounts: drizzleRoleStore(),
    calendars: drizzleOrgStore(),
    clock: systemClock,
    newId: uuidv7,
  };
}

const REPORTS_EVERY_MS = 60 * 60 * 1000;

/**
 * Scheduled reports (PEO-069): every known tenant's due runs, on boot and
 * hourly. In this process rather than `background.ts` because a report is an
 * export, and an export's file has to land in the store this process's
 * download route opens — in development that store is memory.
 *
 * On boot is the point: the VM sleeps when idle and nothing wakes it at 07:00
 * on a Monday, so the first tick after a wake sends whatever came due while
 * it slept, once (`duePeriod`). Only with a mailer and a safe tenant app
 * base, as reminders: a run without them would claim a period and send
 * nothing.
 */
function startReports(
  service: ReturnType<typeof peopleService>,
  exports: ExportJobDeps,
): () => Promise<void> {
  const mailer = reportMailerFrom(process.env);
  const base = tenantAppBase(process.env);
  if (mailer === undefined || base === null) {
    logger.info('no report mailer or no tenant app base; scheduled reports not sent');
    return () => Promise.resolve();
  }
  const sweep = sendDueReports({
    ...scheduleAdmin(),
    inTenant: service.inTenant,
    exports,
    company: tenantCompanies(base, drizzleOrgStore()),
    mailer,
  });
  let running: Promise<void> | null = null;
  const tick = (): void => {
    running ??= (async () => {
      for (const tenantId of await service.tenants()) {
        try {
          const { runs, waiting } = await sweep(tenantId);
          if (runs > 0) logger.info({ tenantId, runs }, 'scheduled reports run');
          if (waiting) logger.info({ tenantId }, 'company not known yet; reports wait');
        } catch (cause) {
          logger.error({ err: cause, tenantId }, 'scheduled reports failed for a tenant');
        }
      }
    })()
      .catch((cause: unknown) => {
        logger.error({ err: cause }, 'scheduled report sweep failed');
      })
      .finally(() => {
        running = null;
      });
  };
  tick();
  const timer = setInterval(tick, REPORTS_EVERY_MS).unref();
  return async () => {
    clearInterval(timer);
    await running;
  };
}

const SWEEP_UPLOADS_EVERY_MS = 60 * 60 * 1000;
const SWEEP_UPLOADS_LIMIT = 1000;

/**
 * Uploads nobody committed, deleted once they are a day old: the rows go
 * when anybody in the tenant next starts an upload, the objects here. Every
 * replica sweeps; a delete is idempotent. The bucket's lifecycle rule is the
 * backstop (docs/environments.md).
 */
function sweepUploads(store: UploadStore | null): () => void {
  if (store === null) return () => undefined;
  const timer = setInterval(() => {
    store
      .purge(systemClock.instant(), UPLOAD_LIFETIME_MS, SWEEP_UPLOADS_LIMIT)
      .then((deleted) => {
        if (deleted > 0)
          logger.info({ module: 'people', deleted }, 'expired import uploads deleted');
      })
      .catch((cause: unknown) => {
        logger.error({ module: 'people', err: cause }, 'import upload sweep failed');
      });
  }, SWEEP_UPLOADS_EVERY_MS).unref();
  return () => {
    clearInterval(timer);
  };
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
  const headers = callerWithEntitlements(
    process.env['PEOPLE_API_TOKEN'] ?? process.env['INTERNAL_API_TOKEN'] ?? '',
    (tenantId) => service.inTenant(tenantId, ({ tx }) => recordedEntitlements(tx, tenantId)),
  );
  const fga = openFgaFrom(process.env);
  const callerFrom =
    fga === null
      ? headers
      : withTenantRoles(headers, (tenantId, accountId) => fga.roles(tenantId, accountId));
  const exports = wireExports(service);
  const stopReports = startReports(service, exports.deps);
  const uploads = uploadStoreFrom(process.env);
  const stopSweep = sweepUploads(uploads);
  const idempotency = drizzleIdempotency();
  const activitySchema = drizzleSchemaRepository();
  const activityOrg = drizzleOrgStore();
  const rest = restHandler({
    service,
    callerFrom,
    idempotency,
    exports,
    fullValues: exports.fullValues,
    segments: drizzleSegments(),
    screens: screenRoutes(screenDeps(service, exports.deps.store, uploads), idempotency),
    activity: {
      store: drizzleActivity(),
      newId: uuidv7,
      now: () => systemClock.instant(),
      // What a field or the company settings were, and are: the log's "from → to".
      reads: (tx, tenantId) => ({
        field: async (key) =>
          (await activitySchema.loadDraft(tx, tenantId)).attributes.find((a) => a.key === key) ??
          null,
        // A section's or field's name, for a log entry the path named by key.
        label: async (key) => {
          const draft = await activitySchema.loadDraft(tx, tenantId);
          return (
            [...draft.sections, ...draft.attributes].find((x) => x.key === key)?.label.default ??
            null
          );
        },
        settings: async () => {
          const s = await activityOrg.settings(tx, tenantId);
          return {
            defaultTimeZone: s.defaultTimeZone,
            cohortMinimum: s.cohortMinimum,
            photoAtSignup: s.photoAtSignup,
          };
        },
      }),
    },
  });
  // The subgraph's writes are these routes' writes, keyed the same (PEO-113).
  configureGraphQL({ service, callerFrom, rest, viewAs: viewAsDeps(service) });
  // Requests first, then what they use (PEO-118).
  onShutdown('requests, exports and the service pool', async () => {
    await drain(server);
    stopSweep();
    await stopReports();
    await exports.close();
    await service.close();
  });
  const document = JSON.stringify(openApiDocument());
  // SCIM (PEO-072): its own bearer tokens, not the router's principal.
  const scim = scimHandler(
    scimProvisioning({
      service,
      store: drizzleScimStore(),
      clock: systemClock,
      newId: uuidv7,
      baseUrl: scimUrl(),
      entitlements: (tenantId) =>
        service.inTenant(tenantId, ({ tx }) => recordedEntitlements(tx, tenantId)),
      fallbackEntitlements: deploymentEntitlements(),
    }),
    scimUrl(),
  );
  const [graphql] = server.listeners('request') as ((
    request: IncomingMessage,
    response: ServerResponse,
  ) => void)[];
  server.removeAllListeners('request');

  const chatToken = process.env['SLACK_PEOPLE_TOKEN'] ?? '';
  const chatDeps: ChatDeps = {
    ...screenDeps(service, exports.deps.store, uploads),
    accountByEmail: async (tx, tenantId, email) => {
      const rows = await tx.execute<{ account: string }>(sql`
        SELECT identity_account_id AS account FROM people.person
         WHERE tenant_id = ${tenantId}::uuid AND lower(work_email) = ${email}
           AND identity_account_id IS NOT NULL AND access_ended_at IS NULL
           AND status NOT IN ('terminated', 'discarded', 'merged')
         LIMIT 2`);
      const found = [...rows];
      // Two current people with one email is a record to fix, not a guess to make.
      return found.length === 1 ? (found[0]?.account ?? null) : null;
    },
  };
  const answerChat = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (chatToken === '' || !presentsInternalToken({ headers: request.headers }, chatToken)) {
        send(response, {
          status: 401,
          body: { error: { code: 'UNAUTHENTICATED', message: 'Not the Slack service' } },
        });
        return;
      }
      const raw = await bodyOf(request, BODY_LIMIT);
      let parsed: unknown = null;
      try {
        parsed = raw === null ? null : JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const input = ChatQuestion.safeParse(parsed);
      if (!input.success) {
        send(response, {
          status: 400,
          body: { error: { code: 'INVALID_INPUT', message: 'tenantId, email and question' } },
        });
        return;
      }
      const answered = await askFromChat(chatDeps, { ...input.data, correlationId: uuidv7() });
      send(
        response,
        answered.ok
          ? { status: 200, body: answered.value }
          : {
              status: 200,
              body: {
                text: answered.error.message,
                people: [],
                understood: answered.error.code,
                answered: false,
              },
            },
      );
    } catch (cause) {
      logger.error({ err: cause }, 'a chat question failed');
      if (!response.headersSent)
        send(response, {
          status: 500,
          body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
        });
    }
  };

  // What a Slack button does, as whoever pressed it: the app's own routes.
  const actChat = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (chatToken === '' || !presentsInternalToken({ headers: request.headers }, chatToken)) {
        send(response, {
          status: 401,
          body: { error: { code: 'UNAUTHENTICATED', message: 'Not the Slack service' } },
        });
        return;
      }
      const raw = await bodyOf(request, BODY_LIMIT);
      let parsed: unknown = null;
      try {
        parsed = raw === null ? null : JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const input = parseChatAction(parsed);
      if (!input.success) {
        send(response, {
          status: 400,
          body: { error: { code: 'INVALID_INPUT', message: 'Not a chat action' } },
        });
        return;
      }
      const done = await chatAct(
        {
          apiToken: process.env['PEOPLE_API_TOKEN'] ?? process.env['INTERNAL_API_TOKEN'] ?? '',
          accountOf: (tenantId, email) =>
            service.inTenant(tenantId, ({ tx }) => chatDeps.accountByEmail(tx, tenantId, email)),
          rest: async (r) => rest(r),
          shown: (tenantId) =>
            service.inTenant(tenantId, async ({ tx }) => {
              const version = await service.schemas.current(tx, tenantId);
              return new Set(
                (version?.document.attributes ?? [])
                  .filter((d) => d.classification.aiEligible)
                  .map((d) => d.key as string),
              );
            }),
        },
        input.data,
      );
      send(response, { status: 200, body: done });
    } catch (cause) {
      logger.error({ err: cause }, 'a chat action failed');
      if (!response.headersSent)
        send(response, {
          status: 500,
          body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
        });
    }
  };

  /*
   * An administrator viewing as somebody reads and never writes: every unit of
   * work this request opens is a read-only transaction (`readOnly`), whatever
   * route it reaches. The routes refuse a write first, and say why.
   */
  const apiToken = process.env['PEOPLE_API_TOKEN'] ?? process.env['INTERNAL_API_TOKEN'] ?? '';
  server.on('request', (request: IncomingMessage, response: ServerResponse) => {
    if (viewingRequest({ headers: request.headers }, apiToken)) {
      readOnly(() => {
        handle(request, response);
      });
      return;
    }
    handle(request, response);
  });

  function handle(request: IncomingMessage, response: ServerResponse): void {
    const path = request.url ?? '/';
    if (path === SCIM_PREFIX || path.startsWith(`${SCIM_PREFIX}/`)) {
      void (async () => {
        try {
          const body = await bodyOf(request, BODY_LIMIT);
          if (body === null) {
            send(response, {
              status: 413,
              body: { error: { code: 'TOO_LARGE', message: 'Body too large' } },
            });
            return;
          }
          const answer = await scim({
            method: request.method ?? 'GET',
            url: path,
            headers: request.headers,
            body,
          });
          response.writeHead(answer.status, answer.headers);
          response.end(answer.body === null ? undefined : JSON.stringify(answer.body));
        } catch (cause) {
          logger.error({ err: cause }, 'people SCIM request failed');
          if (!response.headersSent) {
            response.writeHead(500, { 'content-type': 'application/scim+json' });
            response.end(
              JSON.stringify({
                schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
                status: '500',
                detail: 'Something went wrong',
              }),
            );
          }
        }
      })();
      return;
    }
    // A question from Slack, asked as whoever's verified email it carries.
    // Only the Slack service may: it presents a token of its own.
    if (path === '/internal/assistant/ask' && request.method === 'POST') {
      void answerChat(request, response);
      return;
    }
    if (path === '/internal/chat/act' && request.method === 'POST') {
      void actChat(request, response);
      return;
    }
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
        const body = await bodyOf(request, BODY_LIMIT);
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
        if (isViewOnlyRefusal(cause)) {
          if (!response.headersSent) send(response, refused(ViewOnly));
          return;
        }
        logger.error({ err: cause, path }, 'people REST request failed');
        if (!response.headersSent) {
          send(response, {
            status: 500,
            body: { error: { code: 'INTERNAL', message: 'Something went wrong' } },
          });
        }
      }
    })();
  }
}
