import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import type { ExportJobDeps, ExportJobRequest } from '../application/export/job.js';
import { linksOf } from '../application/export/job.js';
import { requestExport, type ExportQueue, type QueuedExport } from '../application/export/queue.js';
import {
  decideFullValues,
  requestFullValues,
  viewFullValues,
  type FullValuesDeps,
} from '../application/export/full-values.js';
import type { Asking } from '../application/person/person-access.js';
import { run, type PeopleService } from '../application/person/service.js';
import type { CallerFrom } from './caller.js';
import type { IdempotencyStore } from './idempotency.js';
import { schemaArtifact } from './schema-artifact.js';

/**
 * REST v1, per §13.2. The same application layer as GraphQL, so the same
 * field-level authorization: this file decides nothing about who may see
 * what, it parses a request and maps a `DomainFailure` to a status.
 *
 * Framework-free on purpose. A request is a method, a URL, headers and a
 * body; a response is a status and a JSON value. That makes the handler a
 * function a contract test can call beside the GraphQL schema, and the Node
 * adapter in `server.ts` is ten lines.
 *
 * The Zod schemas here are the request and response contract, and `openapi.ts`
 * generates the document from them — nothing about the wire shape is written
 * twice.
 */

export interface RestRequest {
  readonly method: string;
  /** Path and query, e.g. `/v1/people?limit=10`. */
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export interface RestResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

/* ----------------------------------------------------------- contract -- */

const Attributes = z
  .record(z.string(), z.unknown())
  .describe(
    'Attribute values by key. The shape of each is the published schema artifact at /v1/schema/versions/{version}. A key the caller may not read is absent.',
  );

export const PersonBody = z.object({
  id: z.uuid(),
  status: z.string(),
  schemaVersion: z.int().nullable(),
  attributes: Attributes,
});

export const PersonPageBody = z.object({
  items: z.array(PersonBody),
  nextCursor: z.string().nullable(),
});

export const CreatePersonBody = z.strictObject({ attributes: Attributes });

export const PatchPersonBody = z.strictObject({
  attributes: Attributes,
  /** When a dated change takes effect. Defaults to today. */
  effectiveFrom: z.iso.date().optional(),
});

export const CorrectionBody = z.strictObject({
  supersedes: z.uuid(),
  value: z.unknown(),
  reason: z.string().max(500).nullable().optional(),
});

export const HistoryEntryBody = z.object({
  id: z.uuid(),
  attributeKey: z.string(),
  value: z.unknown(),
  effectiveFrom: z.iso.date(),
  recordedAt: z.string(),
  supersedes: z.uuid().nullable(),
});

export const CompletenessBody = z.object({
  state: z.enum(['complete', 'incomplete', 'not_applicable']),
  missing: z.array(
    z.object({ key: z.string(), sectionKey: z.string(), owners: z.array(z.string()) }),
  ),
});

export const SchemaVersionSummary = z.object({
  version: z.int(),
  checksum: z.string(),
  publishedAt: z.string(),
  rolledBackFrom: z.int().nullable(),
});

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), path: z.array(z.string()).optional() }),
});

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  asOf: z.iso.date().optional(),
});

export const AsOfQuery = z.object({ asOf: z.iso.date().optional() });

export const CreateExportBody = z.strictObject({
  format: z.enum(['csv', 'xlsx']),
  fields: z.array(z.string()).max(500).optional(),
  asOf: z.iso.date().optional(),
  includeArchived: z.boolean().optional(),
  personIds: z.array(z.uuid()).max(50_000).optional(),
  filter: z.string().max(500).optional(),
  /** Required when a financial field is in the file; recorded with the export. */
  reason: z.string().max(500).optional(),
});

export const CreateFullValuesBody = z.strictObject({
  /** Must include at least one sealed field; never a special-category one. */
  fields: z.array(z.string()).min(1).max(500),
  reason: z.string().max(500),
  asOf: z.iso.date().optional(),
  personIds: z.array(z.uuid()).max(50_000).optional(),
  filter: z.string().max(500).optional(),
});

export const FullValuesDecisionBody = z.strictObject({
  approve: z.boolean(),
  note: z.string().max(500).optional(),
});

export const FullValuesBody = z.object({
  id: z.uuid(),
  state: z.enum(['pending', 'approved', 'rejected', 'expired', 'issued', 'downloaded']),
  requestedBy: z.uuid(),
  reason: z.string(),
  attributeKeys: z.array(z.string()),
  expiresAt: z.string(),
  decidedBy: z.uuid().nullable(),
  /** The one download: for the requester only, until used or 24 hours pass. */
  link: z.url().nullable(),
});

export const ExportBody = z.object({
  id: z.uuid(),
  /** Queued exports (over 2,000 rows) complete later; ask again for the links. */
  status: z.enum(['queued', 'completed', 'expired']),
  rowCount: z.int().nullable(),
  expiresAt: z.string().nullable(),
  links: z.array(z.object({ name: z.string(), url: z.url() })),
});

/* ------------------------------------------------------------- errors -- */

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  NOT_ENTITLED: 403,
  FORBIDDEN: 403,
  FIELD_NOT_WRITABLE: 403,
  NOT_FOUND: 404,
  SCHEMA_NOT_PUBLISHED: 409,
  UNIQUE_VALUE_TAKEN: 409,
  INVALID_TRANSITION: 409,
  ALREADY_CORRECTED: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  APPROVAL_DECIDED: 409,
  APPROVAL_EXPIRED: 409,
  UNAVAILABLE: 503,
};

function refused(error: DomainFailure): RestResponse {
  return {
    status: STATUS[error.code] ?? 422,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
      },
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  return err(
    failure(
      'BAD_REQUEST',
      issue?.message ?? 'invalid request',
      issue?.path.map((p) => String(p)),
    ),
  );
}

function json(body: string): Result<unknown> {
  try {
    return ok(body === '' ? {} : (JSON.parse(body) as unknown));
  } catch {
    return err(failure('BAD_REQUEST', 'The body is not JSON'));
  }
}

/** Opaque to the caller; today it is the last id, base64url. */
const cursorOut = (id: string | null) =>
  id === null ? null : Buffer.from(id).toString('base64url');
const cursorIn = (cursor: string | undefined) =>
  cursor === undefined ? null : Buffer.from(cursor, 'base64url').toString('utf8');

/* ------------------------------------------------------------ handler -- */

export interface RestDeps {
  readonly service: PeopleService;
  readonly callerFrom: CallerFrom;
  readonly idempotency: IdempotencyStore;
  /** Absent where nothing is wired to store a file; the routes then answer UNAVAILABLE. */
  readonly exports?: { readonly deps: ExportJobDeps; readonly queue: ExportQueue };
  /** Finance's full-values requests; the hooks wake the workflow after each commit. */
  readonly fullValues?: {
    readonly deps: FullValuesDeps;
    started(tenantId: string, requestId: string, correlationId: string): Promise<void>;
    decided(tenantId: string, requestId: string, correlationId: string): Promise<void>;
  };
}

type Handler = (
  asking: Asking,
  request: RestRequest,
  params: Record<string, string>,
  query: URLSearchParams,
) => Promise<RestResponse>;

interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly handle: Handler;
}

const UUID = '([0-9a-fA-F-]{36})';

export function restHandler(
  deps: RestDeps,
): (request: RestRequest) => Promise<RestResponse | null> {
  const { service } = deps;

  const respond = <T>(
    result: Result<T>,
    status: number,
    shape: (value: T) => unknown,
  ): RestResponse => (result.ok ? { status, body: shape(result.value) } : refused(result.error));

  /**
   * A write, made safe to retry.
   *
   * The key, the request's hash and the resource it produced are stored in
   * the same transaction as the write, so the write and the record of it
   * commit together or not at all. A retry with the same key and body answers
   * with the resource as it is now, read again through the same
   * authorization; the same key with a different body is refused.
   *
   * The body of the first response is not stored: it is a copy of somebody's
   * record in a table with no reason to keep one.
   */
  async function idempotent(
    asking: Asking,
    request: RestRequest,
    status: number,
    write: (tx: PostgresJsDatabase) => Promise<Result<string>>,
    replay: (resourceId: string) => Promise<RestResponse>,
  ): Promise<RestResponse> {
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0 || key.length > 255) {
      return refused(
        failure('IDEMPOTENCY_KEY_REQUIRED', 'Every write carries an Idempotency-Key header'),
      );
    }
    const hash = createHash('sha256')
      // The caller is part of the request: one key reused by two people is
      // two requests, and the second is refused rather than answered.
      .update(`${asking.viewer.accountId}\n${request.method} ${request.url}\n${request.body}`)
      .digest('hex');

    const outcome = await run<string>(service, asking.tenantId, async (tx) => {
      const prior = await deps.idempotency.find(tx, asking.tenantId, key);
      if (prior) {
        return prior.requestHash === hash
          ? ok(prior.resourceId)
          : err(failure('IDEMPOTENCY_KEY_REUSED', 'This key was used for a different request'));
      }
      const written = await write(tx);
      if (!written.ok) return written;
      const saved = await deps.idempotency.save(tx, asking.tenantId, key, {
        requestHash: hash,
        status,
        resourceId: written.value,
      });
      // Somebody else committed this key first; roll ours back and answer as they did.
      return saved ? ok(written.value) : err(failure('IDEMPOTENCY_RACE', 'raced'));
    });

    if (!outcome.ok && outcome.error.code === 'IDEMPOTENCY_RACE') {
      const prior = await service.inTenant(asking.tenantId, ({ tx }) =>
        deps.idempotency.find(tx, asking.tenantId, key),
      );
      if (prior?.requestHash !== hash) {
        return refused(
          failure('IDEMPOTENCY_KEY_REUSED', 'This key was used for a different request'),
        );
      }
      return withStatus(await replay(prior.resourceId), prior.status);
    }
    if (!outcome.ok) return refused(outcome.error);

    return withStatus(await replay(outcome.value), status);
  }

  const withStatus = (response: RestResponse, status: number): RestResponse =>
    response.status < 300 ? { ...response, status } : response;

  const readPerson = async (asking: Asking, personId: string, asOf?: string) =>
    respond(
      await run(service, asking.tenantId, (tx) =>
        service.access.read(tx, { ...asking, personId, ...(asOf ? { asOf } : {}) }),
      ),
      200,
      (view) => view,
    );

  const readEntry = async (asking: Asking, personId: string, entryId: string) =>
    respond(
      await run(service, asking.tenantId, async (tx) => {
        const entries = await service.access.history(tx, { ...asking, personId });
        if (!entries.ok) return entries;
        const entry = entries.value.find((e) => e.id === entryId);
        return entry ? ok(entry) : err(failure('NOT_FOUND', 'No such history entry'));
      }),
      200,
      (entry) => entry,
    );

  /** The requester's own export, with its links signed again. Anyone else gets NOT_FOUND. */
  const readExport = async (asking: Asking, exportId: string): Promise<RestResponse> => {
    const exports = deps.exports;
    if (!exports) return refused(failure('UNAVAILABLE', 'Exports are not configured'));
    const entry = await run(service, asking.tenantId, async (tx) => {
      const found = await exports.deps.ledger.find(tx, asking.tenantId, exportId);
      return found?.requestedBy === asking.viewer.accountId
        ? ok(found)
        : err(failure('NOT_FOUND', 'No such export'));
    });
    if (!entry.ok) return refused(entry.error);
    const e = entry.value;
    if (e.status === 'queued') {
      return {
        status: 200,
        body: { id: exportId, status: 'queued', rowCount: null, expiresAt: null, links: [] },
      };
    }
    const expired = Date.parse(exports.deps.clock.instant()) >= Date.parse(e.expiresAt);
    return {
      status: 200,
      body: {
        id: exportId,
        status: expired ? 'expired' : 'completed',
        rowCount: e.rowCount,
        expiresAt: e.expiresAt,
        links: expired ? [] : await linksOf(exports.deps.store, e),
      },
    };
  };

  const readFullValues = async (asking: Asking, requestId: string): Promise<RestResponse> => {
    const full = deps.fullValues;
    if (!full) return refused(failure('UNAVAILABLE', 'Full-values requests are not configured'));
    return respond(
      await run(service, asking.tenantId, (tx) =>
        viewFullValues(tx, full.deps, { ...asking, requestId }),
      ),
      200,
      ({ request, state, link }) => ({
        id: request.approval.id,
        state,
        requestedBy: request.approval.requestedBy,
        reason: request.approval.reason,
        attributeKeys: request.attributeKeys,
        expiresAt: request.approval.expiresAt,
        decidedBy: request.approval.decidedBy,
        link,
      }),
    );
  };

  const routes: Route[] = [
    {
      method: 'POST',
      pattern: /^\/v1\/exports\/full-values$/,
      handle: async (asking, request) => {
        const full = deps.fullValues;
        if (!full)
          return refused(failure('UNAVAILABLE', 'Full-values requests are not configured'));
        const body = json(request.body);
        const input = body.ok ? parse(CreateFullValuesBody, body.value) : body;
        if (!input.ok) return refused(input.error);
        const v = input.value;
        const created: { id: string | null } = { id: null };
        const answer = await idempotent(
          asking,
          request,
          201,
          async (tx) => {
            const made = await requestFullValues(tx, full.deps, {
              ...asking,
              fields: v.fields,
              reason: v.reason,
              ...(v.asOf ? { asOf: v.asOf } : {}),
              ...(v.personIds ? { personIds: v.personIds } : {}),
              ...(v.filter !== undefined ? { filter: v.filter } : {}),
            });
            if (!made.ok) return made;
            created.id = made.value.approval.id;
            return ok(made.value.approval.id);
          },
          (id) => readFullValues(asking, id),
        );
        const id = created.id;
        if (id !== null && (answer.body as { id?: string } | null)?.id === id) {
          await full.started(asking.tenantId, id, asking.correlationId);
        }
        return answer;
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/exports/full-values/${UUID}$`),
      handle: (asking, _request, params) => readFullValues(asking, params['id'] ?? ''),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/exports/full-values/${UUID}/decision$`),
      handle: async (asking, request, params) => {
        const full = deps.fullValues;
        if (!full)
          return refused(failure('UNAVAILABLE', 'Full-values requests are not configured'));
        const body = json(request.body);
        const input = body.ok ? parse(FullValuesDecisionBody, body.value) : body;
        if (!input.ok) return refused(input.error);
        const requestId = params['id'] ?? '';
        const decided = await run(service, asking.tenantId, (tx) =>
          decideFullValues(tx, full.deps, {
            ...asking,
            requestId,
            approve: input.value.approve,
            note: input.value.note ?? null,
          }),
        );
        if (!decided.ok) return refused(decided.error);
        await full.decided(asking.tenantId, requestId, asking.correlationId);
        return readFullValues(asking, requestId);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/exports$/,
      handle: async (asking, request) => {
        const exports = deps.exports;
        if (!exports) return refused(failure('UNAVAILABLE', 'Exports are not configured'));
        const body = json(request.body);
        const input = body.ok ? parse(CreateExportBody, body.value) : body;
        if (!input.ok) return refused(input.error);
        // Handed to the queue only after the request's transaction commits, and
        // only if this request's write is the one that won.
        const pending: { job: QueuedExport | null } = { job: null };
        const v = input.value;
        const asked: ExportJobRequest = {
          ...asking,
          format: v.format,
          ...(v.fields ? { fields: v.fields } : {}),
          ...(v.asOf ? { asOf: v.asOf } : {}),
          ...(v.includeArchived !== undefined ? { includeArchived: v.includeArchived } : {}),
          ...(v.personIds ? { personIds: v.personIds } : {}),
          ...(v.filter !== undefined ? { filter: v.filter } : {}),
          ...(v.reason !== undefined ? { reason: v.reason } : {}),
        };
        const answer = await idempotent(
          asking,
          request,
          201,
          async (tx) => {
            const requested = await requestExport(tx, exports.deps, asked);
            if (!requested.ok) return requested;
            if (requested.value.status === 'queued') pending.job = requested.value.job;
            return ok(requested.value.exportId);
          },
          (exportId) => readExport(asking, exportId),
        );
        const job = pending.job;
        if (job !== null && (answer.body as { id?: string } | null)?.id === job.exportId) {
          await exports.queue.enqueue(job);
          return { ...answer, status: 202 };
        }
        return answer;
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/exports/${UUID}$`),
      handle: (asking, _request, params) => readExport(asking, params['id'] ?? ''),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/schema$/,
      handle: async (asking) =>
        respond(
          await run(service, asking.tenantId, async (tx) => {
            const version = await service.schemas.current(tx, asking.tenantId);
            return version
              ? ok(version)
              : err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published yet'));
          }),
          200,
          (v) => ({
            version: v.version,
            checksum: v.checksum,
            publishedAt: v.publishedAt,
            ...v.document,
          }),
        ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/schema\/versions$/,
      handle: async (asking) =>
        respond(
          await run(service, asking.tenantId, async (tx) =>
            ok(await service.schemas.list(tx, asking.tenantId)),
          ),
          200,
          (versions) => ({
            items: versions.map((v) => ({
              version: v.version,
              checksum: v.checksum,
              publishedAt: v.publishedAt,
              rolledBackFrom: v.rolledBackFrom,
            })),
          }),
        ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/schema\/versions\/(\d{1,9})$/,
      handle: async (asking, _request, params) => {
        const number = Number(params['id']);
        const version = await run(service, asking.tenantId, async (tx) => {
          const found = await service.schemas.byNumber(tx, asking.tenantId, number);
          return found ? ok(found) : err(failure('NOT_FOUND', `No version ${String(number)}`));
        });
        if (!version.ok) return refused(version.error);
        // A published version never changes, so a cache may keep it forever.
        return {
          status: 200,
          body: schemaArtifact(version.value),
          headers: {
            'content-type': 'application/schema+json',
            'cache-control': 'private, max-age=31536000, immutable',
            etag: `"${version.value.checksum}"`,
          },
        };
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/people$/,
      handle: async (asking, _request, _params, query) => {
        const q = parse(ListQuery, Object.fromEntries(query));
        if (!q.ok) return refused(q.error);
        return respond(
          await run(service, asking.tenantId, (tx) =>
            service.access.list(tx, {
              ...asking,
              limit: q.value.limit,
              after: cursorIn(q.value.cursor),
              ...(q.value.asOf ? { asOf: q.value.asOf } : {}),
            }),
          ),
          200,
          (page) => ({ items: page.items, nextCursor: cursorOut(page.next) }),
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/people$/,
      handle: async (asking, request) => {
        const body = json(request.body);
        const input = body.ok ? parse(CreatePersonBody, body.value) : body;
        if (!input.ok) return refused(input.error);
        return idempotent(
          asking,
          request,
          201,
          async (tx) => {
            const created = await service.access.create(tx, {
              ...asking,
              attributes: input.value.attributes,
            });
            return created.ok ? ok(created.value.id) : created;
          },
          (id) => readPerson(asking, id),
        );
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/people/${UUID}$`),
      handle: async (asking, _request, params, query) => {
        const q = parse(AsOfQuery, Object.fromEntries(query));
        if (!q.ok) return refused(q.error);
        return readPerson(asking, params['id'] ?? '', q.value.asOf);
      },
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/v1/people/${UUID}$`),
      handle: async (asking, request, params) => {
        const body = json(request.body);
        const input = body.ok ? parse(PatchPersonBody, body.value) : body;
        if (!input.ok) return refused(input.error);
        const personId = params['id'] ?? '';
        return idempotent(
          asking,
          request,
          200,
          async (tx) => {
            const updated = await service.access.update(tx, {
              ...asking,
              personId,
              changes: input.value.attributes,
              ...(input.value.effectiveFrom ? { effectiveFrom: input.value.effectiveFrom } : {}),
            });
            return updated.ok ? ok(personId) : updated;
          },
          (id) => readPerson(asking, id),
        );
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/people/${UUID}/history$`),
      handle: async (asking, _request, params, query) => {
        const attributeKey = query.get('attribute') ?? undefined;
        return respond(
          await run(service, asking.tenantId, (tx) =>
            service.access.history(tx, {
              ...asking,
              personId: params['id'] ?? '',
              ...(attributeKey ? { attributeKey } : {}),
            }),
          ),
          200,
          (entries) => ({ items: entries }),
        );
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/people/${UUID}/corrections$`),
      handle: async (asking, request, params) => {
        const body = json(request.body);
        const input = body.ok ? parse(CorrectionBody, body.value) : body;
        if (!input.ok) return refused(input.error);
        const personId = params['id'] ?? '';
        return idempotent(
          asking,
          request,
          201,
          async (tx) => {
            const entry = await service.access.correct(tx, {
              ...asking,
              personId,
              supersedes: input.value.supersedes,
              value: input.value.value,
              reason: input.value.reason ?? null,
            });
            return entry.ok ? ok(entry.value.id) : entry;
          },
          (id) => readEntry(asking, personId, id),
        );
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/people/${UUID}/completeness$`),
      handle: async (asking, _request, params) =>
        respond(
          await run(service, asking.tenantId, (tx) =>
            service.access.completeness(tx, { ...asking, personId: params['id'] ?? '' }),
          ),
          200,
          (verdict) => ({ state: verdict.state, missing: verdict.missing }),
        ),
    },
  ];

  return async (request) => {
    const url = new URL(request.url, 'http://people.internal');
    if (!url.pathname.startsWith('/v1/')) return null;

    const matching = routes.filter((r) => r.pattern.test(url.pathname));
    if (matching.length === 0) return refused(failure('NOT_FOUND', 'No such route'));
    const route = matching.find((r) => r.method === request.method);
    if (!route)
      return {
        status: 405,
        body: { error: { code: 'METHOD_NOT_ALLOWED', message: request.method } },
      };

    const asking = deps.callerFrom(request);
    if (!asking.ok) return refused(asking.error);

    const [, id] = route.pattern.exec(url.pathname) ?? [];
    return route.handle(asking.value, request, id === undefined ? {} : { id }, url.searchParams);
  };
}
