import { createHash } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';

import type { ExportJobDeps, ExportJobRequest } from '../application/export/job.js';
import { linksOf } from '../application/export/job.js';
import { requestExport, type ExportQueue, type QueuedExport } from '../application/export/queue.js';
import type { OrgAdmin } from '../application/org/org.js';
import type { TenantRoles } from '../application/roles/roles.js';
import {
  decideFullValues,
  requestFullValues,
  viewFullValues,
  fullValuesScreen,
  type FullValuesDeps,
} from '../application/export/full-values.js';
import type { Asking } from '../application/person/person-access.js';
import { run, type PeopleService } from '../application/person/service.js';
import type { CallerFrom } from './caller.js';
import type { IdempotencyStore } from './idempotency.js';
import { LIFECYCLE_ACTIONS } from './lifecycle.js';
import { RoleChangeBody } from './roles.js';
import { schemaArtifact } from './schema-artifact.js';
import { seenBy } from '../domain/segment/segment.js';
import type { SegmentStore } from '../infrastructure/drizzle-segments.js';

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
  attention: z
    .array(z.string())
    .describe('Keys holding a value HR sent back to be corrected (PEO-125): present, not missing.'),
});

/* ------------------------------------------------- identifier reviews -- */

/** What a country check found (PEO-125). Never the value. */
export const IdentifierFindingBody = z.object({
  level: z.enum(['ok', 'attention', 'mismatch']),
  code: z.string(),
  message: z.string(),
});

export const IdentifierFindingsBody = z.object({
  key: z.string(),
  findings: z.array(IdentifierFindingBody),
  review: z
    .enum(['pending', 'accepted', 'sent_back', 'none'])
    .describe('Where this value stands with HR: the latest review of this very value, or none.'),
});

/** A person after a write, with what the checks found on each national identifier it carried. */
export const PersonWriteBody = PersonBody.extend({
  identifierFindings: z
    .array(IdentifierFindingsBody)
    .describe(
      'One entry per national identifier in the request. A warning, never a refusal: the value was saved.',
    ),
});

/** A correction's new row, with what the checks found if it was a national identifier. */
export const CorrectionWriteBody = HistoryEntryBody.extend({
  identifierFindings: z.array(IdentifierFindingsBody),
});

export const IdentifierReviewBody = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  attributeKey: z.string(),
  label: z.string(),
  state: z.enum(['pending', 'accepted', 'sent_back', 'superseded']),
  findings: z.array(IdentifierFindingBody),
  createdAt: z.string(),
  last4: z.string().nullable().describe('What a screen shows. The value only through /reveal.'),
});

/** A suspected duplicate (PEO-074): two ids and why, never a value. */
export const DuplicateBody = z.object({
  personIds: z.tuple([z.uuid(), z.uuid()]),
  signals: z.array(
    z.object({
      signal: z.enum(['unique_value', 'work_email', 'name_and_birth_date']),
      attributeKey: z
        .string()
        .nullable()
        .describe('The unique attribute whose keyed hash both hold; null for the others.'),
    }),
  ),
});

/** HR says a pair are two people: the queue stops offering it. */
export const DuplicateDismissalBody = z.strictObject({
  personIds: z.tuple([z.uuid(), z.uuid()]),
});

export const IdentifierReviewDecisionBody = z.strictObject({
  attributeKey: z.string().max(64),
  decision: z.enum(['accept', 'send_back']),
  note: z.string().max(500).nullable().optional(),
});

export const IdentifierDecidedBody = z.object({
  reviewId: z.uuid(),
  personId: z.uuid(),
  attributeKey: z.string(),
  state: z.enum(['accepted', 'sent_back']),
});

export const IdentifierRevealBody = z.strictObject({ attributeKey: z.string().max(64) });

export const IdentifierRevealedBody = z.object({ attributeKey: z.string(), value: z.string() });

export const SchemaVersionSummary = z.object({
  version: z.int(),
  checksum: z.string(),
  publishedAt: z.string(),
  rolledBackFrom: z.int().nullable(),
});

export const ErrorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), path: z.array(z.string()).optional() }),
});

const FILTER = /^[a-z][a-z0-9_]*:[^,]+(,[a-z][a-z0-9_]*:[^,]+)*$/;

export const ListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  asOf: z.iso.date().optional(),
  // ponytail: a value containing a comma cannot be filtered on. Take a
  // repeated parameter when a tenant's option list needs one.
  filter: z
    .string()
    .regex(FILTER)
    .optional()
    .describe(
      'Equality on tenant-defined attributes, `key:value` pairs joined by commas, e.g. `cost_centre:ENG-204`. Only keys you can read on everybody; not with asOf.',
    ),
  search: z
    .string()
    .max(200)
    .optional()
    .describe(
      'A case-insensitive substring of a name or work email, matched only against those you can read on everybody; not with asOf.',
    ),
});

/** `cost_centre:ENG-204,location:BCN` as a record. */
export function filterIn(filter: string | undefined): Record<string, string> {
  if (filter === undefined) return {};
  return Object.fromEntries(
    filter.split(',').map((pair) => {
      const at = pair.indexOf(':');
      return [pair.slice(0, at), pair.slice(at + 1)];
    }),
  );
}

export const AsOfQuery = z.object({ asOf: z.iso.date().optional() });

export const CreateExportBody = z.strictObject({
  /** `pdf` is a landscape roster, or with `recordOf` one person's employee record. */
  format: z.enum(['csv', 'xlsx', 'pdf']),
  recordOf: z
    .uuid()
    .optional()
    .describe('With format pdf: this person’s employee record instead of a roster.'),
  fields: z.array(z.string()).max(500).optional(),
  asOf: z.iso.date().optional(),
  includeArchived: z.boolean().optional(),
  personIds: z.array(z.uuid()).max(50_000).optional(),
  filter: z.string().max(500).optional(),
  /** Only the people a saved segment matches, of those you may list (PEO-068). */
  segmentId: z.uuid().optional(),
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

/* Legal entities, locations and settings (PEO-099). Zones are IANA names. */

export const SettingsBody = z.object({
  defaultTimeZone: z.string(),
  cohortMinimum: z.int().describe('Raisable, never lowerable; at least 10.'),
  slug: z
    .string()
    .nullable()
    .describe('Where the company signs in, <slug>.app…; the back office sets it, read-only here.'),
  displayName: z.string().nullable().describe('The company name; the back office sets it.'),
});

export const PatchSettingsBody = z.strictObject({
  defaultTimeZone: z.string().optional(),
  cohortMinimum: z.int().optional(),
});

export const LegalEntityBody = z.object({
  id: z.uuid(),
  name: z.string(),
  country: z.string().length(2),
  timeZone: z.string(),
  archived: z.boolean(),
});

export const CreateLegalEntityBody = z.strictObject({
  name: z.string(),
  country: z.string().length(2),
  timeZone: z.string(),
});

export const PatchLegalEntityBody = z.strictObject({
  name: z.string().optional(),
  timeZone: z.string().optional(),
  archived: z.boolean().optional(),
});

/** An entity's employee numbering (PEO-101): `ES-` and 5 digits write `ES-00042`. */
export const NumberingBody = z.object({
  legalEntityId: z.uuid(),
  prefix: z.string(),
  digits: z.int(),
  nextValue: z.int().describe('The number the next hire in this entity is given.'),
});

export const PutNumberingBody = z.strictObject({
  prefix: z.string().max(10),
  digits: z.int().min(1).max(12),
  start: z.int().min(1).describe('Where the sequence starts; never moves it back.'),
});

export const LocationBody = z.object({
  id: z.uuid(),
  legalEntityId: z.uuid(),
  name: z.string(),
  country: z.string().length(2),
  timeZone: z.string().describe('The zone in force today.'),
  zones: z.array(z.object({ effectiveFrom: z.iso.date(), timeZone: z.string() })),
  archived: z.boolean(),
});

export const CreateLocationBody = z.strictObject({
  legalEntityId: z.uuid(),
  name: z.string(),
  country: z.string().length(2),
  timeZone: z.string(),
  /** From when the zone is in force. Defaults to today in that zone. */
  effectiveFrom: z.iso.date().optional(),
});

export const PatchLocationBody = z.strictObject({
  name: z.string().optional(),
  archived: z.boolean().optional(),
});

export const LocationZoneBody = z.strictObject({
  timeZone: z.string(),
  /** The day the new zone takes effect, in that zone. The same day again is a correction. */
  effectiveFrom: z.iso.date(),
});

/* ------------------------------------------------------------- errors -- */

const STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  NOT_ENTITLED: 403,
  FORBIDDEN: 403,
  FIELD_NOT_WRITABLE: 403,
  FIELD_NOT_FILTERABLE: 403,
  NOT_FOUND: 404,
  SCHEMA_NOT_PUBLISHED: 409,
  UNIQUE_VALUE_TAKEN: 409,
  INVALID_TRANSITION: 409,
  ALREADY_CORRECTED: 409,
  // PEO-074: a merge the records' states refuse.
  MERGE_ABSORBS_EMPLOYMENT: 409,
  MERGE_TOMBSTONE: 409,
  MERGE_TWO_ACCOUNTS: 409,
  MERGE_HAS_REPORTS: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  // PEO-112: a grant to oneself, and the last administrator.
  SELF_GRANT: 403,
  LAST_ADMIN: 409,
  APPROVAL_DECIDED: 409,
  APPROVAL_EXPIRED: 409,
  // Two imports contended past the retries (PEO-106): nothing was written; upload again.
  IMPORT_CONTENDED: 409,
  ALREADY_IMPORTED: 409,
  // An import's upload (§14.2): somebody else's is not found, never forbidden.
  UPLOAD_NOT_FOUND: 404,
  UPLOAD_EXPIRED: 410,
  UPLOAD_NOT_COMPLETED: 409,
  // A request missing what every webhook endpoint must carry. No route
  // creates endpoints yet; this is the answer when one does (PEO-093).
  BAD_WEBHOOK_ALERT_EMAIL: 400,
  UNAVAILABLE: 503,
};

export function refused(error: DomainFailure): RestResponse {
  return {
    status: STATUS[error.code] ?? 422,
    body: {
      error: {
        code: error.code,
        message: error.message,
        ...(error.path ? { path: error.path } : {}),
        ...(error.link ? { link: error.link } : {}),
      },
    },
  };
}

export function parse<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
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

export function json(body: string): Result<unknown> {
  try {
    return ok(body === '' ? {} : (JSON.parse(body) as unknown));
  } catch {
    return err(failure('BAD_REQUEST', 'The body is not JSON'));
  }
}

/** The keys a caller sent, without the ones Zod left `undefined` (`exactOptionalPropertyTypes`). */
function present<T extends object>(value: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: Exclude<T[K], undefined>;
  };
}

/** Opaque to the caller; today it is the last id, base64url. */
const cursorOut = (id: string | null) =>
  id === null ? null : Buffer.from(id).toString('base64url');
const cursorIn = (cursor: string | undefined) =>
  cursor === undefined ? null : Buffer.from(cursor, 'base64url').toString('utf8');

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
 * record in a table with no reason to keep one. `replay` is told whether it
 * answers the write this request made or one an earlier request made.
 */
export async function idempotent(
  deps: Pick<RestDeps, 'service' | 'idempotency'>,
  asking: Asking,
  request: RestRequest,
  status: number,
  write: (tx: PostgresJsDatabase) => Promise<Result<string>>,
  replay: (resourceId: string, replayed: boolean) => Promise<RestResponse>,
): Promise<RestResponse> {
  const { service } = deps;
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

  let replayed = false;
  const outcome = await run<string>(service, asking.tenantId, async (tx) => {
    const prior = await deps.idempotency.find(tx, asking.tenantId, key);
    if (prior) {
      replayed = true;
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
    return withStatus(await replay(prior.resourceId, true), prior.status);
  }
  if (!outcome.ok) return refused(outcome.error);

  return withStatus(await replay(outcome.value, replayed), status);
}

const withStatus = (response: RestResponse, status: number): RestResponse =>
  response.status < 300 ? { ...response, status } : response;

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
  /** The routes the tenant app's screens read and act through (PEO-098, `screens.ts`). */
  readonly screens?: readonly Route[];
  /** Saved segments, for an export of one (PEO-068). */
  readonly segments?: SegmentStore;
}

export type Handler = (
  asking: Asking,
  request: RestRequest,
  params: Record<string, string>,
  query: URLSearchParams,
) => Promise<RestResponse>;

export interface Route {
  readonly method: string;
  readonly pattern: RegExp;
  readonly handle: Handler;
  /** A POST that changes nothing — a preview, a dry run, advice — and so takes no Idempotency-Key. */
  readonly safe?: true;
}

export const UUID = '([0-9a-fA-F-]{36})';

/** Every route, for the dispatcher and for the contract test that checks each write (PEO-116). */
export function restRoutes(deps: RestDeps): Route[] {
  const { service } = deps;

  const respond = <T>(
    result: Result<T>,
    status: number,
    shape: (value: T) => unknown,
  ): RestResponse => (result.ok ? { status, body: shape(result.value) } : refused(result.error));

  const readPerson = async (asking: Asking, personId: string, asOf?: string) =>
    respond(
      await run(service, asking.tenantId, (tx) =>
        service.access.read(tx, { ...asking, personId, ...(asOf ? { asOf } : {}) }),
      ),
      200,
      (view) => view,
    );

  /**
   * The person after a write, with what the country checks found on each
   * national identifier the request carried (PEO-125). Read again rather than
   * kept, so a retried request is answered the same way: the checks are pure,
   * and whether HR still has a value to review is asked now.
   */
  const writtenPerson = async (
    asking: Asking,
    personId: string,
    attributes: Readonly<Record<string, unknown>>,
  ): Promise<RestResponse> => {
    const person = await readPerson(asking, personId);
    if (person.status >= 300) return person;
    const found = await run(service, asking.tenantId, (tx) =>
      service.access.checkIdentifiers(tx, { ...asking, personId, values: attributes }),
    );
    return {
      ...person,
      body: {
        ...(person.body as Record<string, unknown>),
        identifierFindings: found.ok ? found.value : [],
      },
    };
  };

  /** A legal entity, location or settings use case, in its own transaction. */
  const inOrg = <T>(
    asking: Asking,
    fn: (org: OrgAdmin, tx: PostgresJsDatabase) => Promise<Result<T>>,
  ) => {
    const { org } = service;
    return org
      ? run(service, asking.tenantId, (tx) => fn(org, tx))
      : Promise.resolve(
          err(failure('UNAVAILABLE', 'Legal entities and settings are not configured')),
        );
  };

  /** A tenant-role use case in its own transaction (PEO-112). */
  const inRoles = <T>(
    asking: Asking,
    fn: (roles: TenantRoles, tx: PostgresJsDatabase) => Promise<Result<T>>,
  ) => {
    const { roles } = service;
    return roles
      ? run(service, asking.tenantId, (tx) => fn(roles, tx))
      : Promise.resolve(err(failure('UNAVAILABLE', 'Roles are not configured')));
  };

  /** Reads one back by id for a write's answer, and for its idempotent replay. */
  const readOrg = async <T extends { id: string }>(
    asking: Asking,
    list: (org: OrgAdmin, tx: PostgresJsDatabase) => Promise<Result<readonly T[]>>,
    id: string,
  ) =>
    respond(
      await inOrg(asking, async (org, tx) => {
        const all = await list(org, tx);
        if (!all.ok) return all;
        const found = all.value.find((x) => x.id === id);
        return found ? ok(found) : err(failure('NOT_FOUND', 'Not found'));
      }),
      200,
      (x) => x,
    );

  const readNumbering = async (asking: Asking, legalEntityId: string) =>
    respond(
      await inOrg(asking, async (org, tx) => {
        const all = await org.numberings(tx, asking);
        if (!all.ok) return all;
        const found = all.value.find((n) => n.legalEntityId === legalEntityId);
        return found
          ? ok(found)
          : err(failure('NOT_FOUND', 'This legal entity does not number its people'));
      }),
      200,
      (n) => n,
    );

  const readEntity = (asking: Asking, id: string) =>
    readOrg(asking, (org, tx) => org.legalEntities(tx, asking), id);
  const readLocation = (asking: Asking, id: string) =>
    readOrg(asking, (org, tx) => org.locations(tx, asking), id);

  /** Parse a JSON body against a schema, or the refusal to answer with. */
  const bodyAs = <T>(schema: z.ZodType<T>, request: RestRequest): Result<T> => {
    const body = json(request.body);
    return body.ok ? parse(schema, body.value) : body;
  };

  /**
   * One history entry, and — a correction of a national identifier being a
   * write like any other (PEO-125) — what the checks found on its value,
   * recomputed so a retry answers as the first request did.
   */
  const readEntry = async (asking: Asking, personId: string, entryId: string) =>
    respond(
      await run(service, asking.tenantId, async (tx) => {
        const entries = await service.access.history(tx, { ...asking, personId });
        if (!entries.ok) return entries;
        const entry = entries.value.find((e) => e.id === entryId);
        if (!entry) return err(failure('NOT_FOUND', 'No such history entry'));
        const found = await service.access.checkIdentifiers(tx, {
          ...asking,
          personId,
          values: { [entry.attributeKey]: entry.value },
        });
        return ok({ ...entry, identifierFindings: found.ok ? found.value : [] });
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

  return [
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
          deps,
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
      pattern: /^\/v1\/exports\/full-values$/,
      handle: async (asking) => {
        const full = deps.fullValues;
        if (!full)
          return refused(failure('UNAVAILABLE', 'Full-values requests are not configured'));
        return respond(
          await run(service, asking.tenantId, (tx) => fullValuesScreen(tx, full.deps, asking)),
          200,
          (screen) => screen,
        );
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
        // Idempotent like every other write (PEO-107): a retried decision is
        // answered with the request as it now stands, not a 409 for deciding
        // twice. The wake-up is sent on a replay too; settling is idempotent,
        // and it covers a first attempt whose wake-up was lost.
        const answer = await idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            const decided = await decideFullValues(tx, full.deps, {
              ...asking,
              requestId,
              approve: input.value.approve,
              note: input.value.note ?? null,
            });
            return decided.ok ? ok(requestId) : decided;
          },
          (id) => readFullValues(asking, id),
        );
        if (answer.status < 300)
          await full.decided(asking.tenantId, requestId, asking.correlationId);
        return answer;
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
          ...(v.recordOf ? { recordOf: v.recordOf } : {}),
          ...(v.fields ? { fields: v.fields } : {}),
          ...(v.asOf ? { asOf: v.asOf } : {}),
          ...(v.includeArchived !== undefined ? { includeArchived: v.includeArchived } : {}),
          ...(v.personIds ? { personIds: v.personIds } : {}),
          ...(v.filter !== undefined ? { filter: v.filter } : {}),
          ...(v.reason !== undefined ? { reason: v.reason } : {}),
        };
        const answer = await idempotent(
          deps,
          asking,
          request,
          201,
          async (tx) => {
            let request = asked;
            if (v.segmentId !== undefined) {
              const all = (await deps.segments?.all(tx, asking.tenantId)) ?? [];
              const segment = all.find(
                (s) => s.id === v.segmentId && seenBy(s, asking.viewer.accountId),
              );
              if (segment === undefined) {
                return err(failure('NOT_FOUND', 'There is no such segment', ['segmentId']));
              }
              request = { ...asked, where: segment.filter, filter: v.filter ?? segment.name };
            }
            const requested = await requestExport(tx, exports.deps, request);
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
              where: filterIn(q.value.filter),
              ...(q.value.search === undefined ? {} : { search: q.value.search }),
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
          deps,
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
          (id) => writtenPerson(asking, id, input.value.attributes),
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
          deps,
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
          (id) => writtenPerson(asking, id, input.value.attributes),
        );
      },
    },
    // Suspected duplicates, for HR (PEO-074). A ranking; the merge is its own write.
    {
      method: 'GET',
      pattern: /^\/v1\/duplicates$/,
      handle: async (asking) =>
        respond(
          await run(service, asking.tenantId, (tx) => service.access.duplicates(tx, asking)),
          200,
          (items) => ({ items }),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/duplicates\/dismissals$/,
      handle: async (asking, request) => {
        const input = bodyAs(DuplicateDismissalBody, request);
        if (!input.ok) return refused(input.error);
        const { personIds } = input.value;
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            const dismissed = await service.access.dismissDuplicate(tx, { ...asking, personIds });
            return dismissed.ok ? ok(personIds[0]) : dismissed;
          },
          () => Promise.resolve({ status: 200, body: { personIds, decision: 'not_duplicate' } }),
        );
      },
    },
    // Doubted national identifiers, for HR (PEO-125).
    {
      method: 'GET',
      pattern: /^\/v1\/identifier-reviews$/,
      handle: async (asking) =>
        respond(
          await run(service, asking.tenantId, (tx) => service.access.identifierReviews(tx, asking)),
          200,
          (items) => ({
            items: items.map((r) => ({
              id: r.id,
              personId: r.personId,
              attributeKey: r.attributeKey,
              label: r.label,
              state: r.state,
              findings: r.findings,
              createdAt: r.createdAt,
              last4: r.last4,
            })),
          }),
        ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/people/${UUID}/identifier-reviews$`),
      handle: async (asking, request, params) => {
        const input = bodyAs(IdentifierReviewDecisionBody, request);
        if (!input.ok) return refused(input.error);
        const personId = params['id'] ?? '';
        const { attributeKey, decision } = input.value;
        const decided = (reviewId: string): Promise<RestResponse> =>
          Promise.resolve({
            status: 200,
            body: {
              reviewId,
              personId,
              attributeKey,
              state: decision === 'accept' ? 'accepted' : 'sent_back',
            },
          });
        // Keyed like every write; a retry is answered with the decision as made.
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            const reviewed = await service.access.reviewIdentifier(tx, {
              ...asking,
              personId,
              attributeKey,
              decision,
              note: input.value.note ?? null,
            });
            return reviewed.ok ? ok(reviewed.value.id) : reviewed;
          },
          decided,
        );
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/people/${UUID}/identifier-reviews/reveal$`),
      // An audited read: it changes nothing a retry could repeat, so it takes no key.
      safe: true,
      handle: async (asking, request, params) => {
        const input = bodyAs(IdentifierRevealBody, request);
        if (!input.ok) return refused(input.error);
        const { attributeKey } = input.value;
        return respond(
          await run(service, asking.tenantId, (tx) =>
            service.access.revealIdentifier(tx, {
              ...asking,
              personId: params['id'] ?? '',
              attributeKey,
            }),
          ),
          200,
          (value) => ({ attributeKey, value }),
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
          deps,
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
          (verdict) => ({
            state: verdict.state,
            missing: verdict.missing,
            attention: verdict.attention ?? [],
          }),
        ),
    },
    // Every employment on a person (PEO-110), HR only.
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/people/${UUID}/employment-periods$`),
      handle: async (asking, _request, params) =>
        respond(
          await run(service, asking.tenantId, (tx) =>
            service.access.employmentPeriods(tx, { ...asking, personId: params['id'] ?? '' }),
          ),
          200,
          (items) => ({ items }),
        ),
    },
    // Notice, termination, leave and discarding (PEO-108): one route each.
    ...LIFECYCLE_ACTIONS.map((a): Route => ({
      method: 'POST',
      pattern: new RegExp(`^/v1/people/${UUID}/${a.path}$`),
      handle: async (asking, request, params) => {
        const input = bodyAs(a.body, request);
        if (!input.ok) return refused(input.error);
        const personId = params['id'] ?? '';
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            const moved = await a.run(service.access, tx, { ...asking, personId }, input.value);
            return moved.ok ? ok(personId) : moved;
          },
          (id) => readPerson(asking, id),
        );
      },
    })),
    {
      method: 'GET',
      pattern: /^\/v1\/settings$/,
      handle: async (asking) =>
        respond(await inOrg(asking, (org, tx) => org.settings(tx, asking)), 200, (s) => s),
    },
    {
      method: 'PATCH',
      pattern: /^\/v1\/settings$/,
      handle: async (asking, request) => {
        const input = bodyAs(PatchSettingsBody, request);
        if (!input.ok) return refused(input.error);
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            if (!service.org) return err(failure('UNAVAILABLE', 'Settings are not configured'));
            const saved = await service.org.updateSettings(tx, {
              ...asking,
              ...present(input.value),
            });
            return saved.ok ? ok(asking.tenantId) : saved;
          },
          async () =>
            respond(await inOrg(asking, (org, tx) => org.settings(tx, asking)), 200, (s) => s),
        );
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/legal-entities$/,
      handle: async (asking) =>
        respond(await inOrg(asking, (org, tx) => org.legalEntities(tx, asking)), 200, (items) => ({
          items,
        })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/legal-entities$/,
      handle: async (asking, request) => {
        const input = bodyAs(CreateLegalEntityBody, request);
        if (!input.ok) return refused(input.error);
        return idempotent(
          deps,
          asking,
          request,
          201,
          async (tx) => {
            if (!service.org)
              return err(failure('UNAVAILABLE', 'Legal entities are not configured'));
            const created = await service.org.createLegalEntity(tx, { ...asking, ...input.value });
            return created.ok ? ok(created.value.id) : created;
          },
          (id) => readEntity(asking, id),
        );
      },
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/v1/legal-entities/${UUID}$`),
      handle: async (asking, request, params) => {
        const input = bodyAs(PatchLegalEntityBody, request);
        if (!input.ok) return refused(input.error);
        const id = params['id'] ?? '';
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            if (!service.org)
              return err(failure('UNAVAILABLE', 'Legal entities are not configured'));
            const updated = await service.org.updateLegalEntity(tx, {
              ...asking,
              id,
              ...present(input.value),
            });
            return updated.ok ? ok(id) : updated;
          },
          (resource) => readEntity(asking, resource),
        );
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/legal-entities/${UUID}/numbering$`),
      handle: (asking, _request, params) => readNumbering(asking, params['id'] ?? ''),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/legal-entities/${UUID}/numbering$`),
      handle: async (asking, request, params) => {
        const input = bodyAs(PutNumberingBody, request);
        if (!input.ok) return refused(input.error);
        const legalEntityId = params['id'] ?? '';
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            if (!service.org)
              return err(failure('UNAVAILABLE', 'Legal entities are not configured'));
            const saved = await service.org.setNumbering(tx, {
              ...asking,
              legalEntityId,
              ...input.value,
            });
            return saved.ok ? ok(legalEntityId) : saved;
          },
          (id) => readNumbering(asking, id),
        );
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/locations$/,
      handle: async (asking) =>
        respond(await inOrg(asking, (org, tx) => org.locations(tx, asking)), 200, (items) => ({
          items,
        })),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/locations$/,
      handle: async (asking, request) => {
        const input = bodyAs(CreateLocationBody, request);
        if (!input.ok) return refused(input.error);
        return idempotent(
          deps,
          asking,
          request,
          201,
          async (tx) => {
            if (!service.org) return err(failure('UNAVAILABLE', 'Locations are not configured'));
            const { effectiveFrom, ...place } = input.value;
            const created = await service.org.createLocation(tx, {
              ...asking,
              ...place,
              ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
            });
            return created.ok ? ok(created.value.id) : created;
          },
          (id) => readLocation(asking, id),
        );
      },
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/v1/locations/${UUID}$`),
      handle: async (asking, request, params) => {
        const input = bodyAs(PatchLocationBody, request);
        if (!input.ok) return refused(input.error);
        const id = params['id'] ?? '';
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            if (!service.org) return err(failure('UNAVAILABLE', 'Locations are not configured'));
            const updated = await service.org.updateLocation(tx, {
              ...asking,
              id,
              ...present(input.value),
            });
            return updated.ok ? ok(id) : updated;
          },
          (resource) => readLocation(asking, resource),
        );
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/locations/${UUID}/zones$`),
      handle: async (asking, request, params) => {
        const input = bodyAs(LocationZoneBody, request);
        if (!input.ok) return refused(input.error);
        const id = params['id'] ?? '';
        return idempotent(
          deps,
          asking,
          request,
          201,
          async (tx) => {
            if (!service.org) return err(failure('UNAVAILABLE', 'Locations are not configured'));
            const changed = await service.org.changeLocationZone(tx, {
              ...asking,
              id,
              ...input.value,
            });
            return changed.ok ? ok(id) : changed;
          },
          (resource) => readLocation(asking, resource),
        );
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/roles$/,
      handle: async (asking) =>
        respond(
          await inRoles(asking, (roles, tx) => roles.list(tx, asking)),
          200,
          (listed) => ({ items: listed.holders }),
        ),
    },
    ...(['grants', 'revocations'] as const).map((path) => ({
      method: 'POST',
      pattern: new RegExp(`^/v1/roles/${path}$`),
      handle: async (asking: Asking, request: RestRequest) => {
        const input = bodyAs(RoleChangeBody, request);
        if (!input.ok) return refused(input.error);
        return idempotent(
          deps,
          asking,
          request,
          200,
          async (tx) => {
            if (!service.roles) return err(failure('UNAVAILABLE', 'Roles are not configured'));
            const change = { ...asking, ...input.value };
            const done =
              path === 'grants'
                ? await service.roles.grant(tx, change)
                : await service.roles.revoke(tx, change);
            return done.ok ? ok(input.value.accountId) : done;
          },
          async (accountId) =>
            respond(
              await inRoles(asking, (roles, tx) =>
                roles.of(tx, asking.tenantId, accountId).then((holder) => ok(holder)),
              ),
              200,
              (holder) => holder,
            ),
        );
      },
    })),
    ...(deps.screens ?? []),
  ];
}

export function restHandler(
  deps: RestDeps,
): (request: RestRequest) => Promise<RestResponse | null> {
  const routes = restRoutes(deps);
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

    const asking = await deps.callerFrom(request);
    if (!asking.ok) return refused(asking.error);
    // Every write is keyed (PEO-116), checked here so that no route can
    // forget it; `idempotent` is what makes the key mean something.
    const key = request.headers['idempotency-key'];
    if (
      request.method !== 'GET' &&
      route.safe !== true &&
      (typeof key !== 'string' || key.length === 0 || key.length > 255)
    ) {
      return refused(
        failure('IDEMPOTENCY_KEY_REQUIRED', 'Every write carries an Idempotency-Key header'),
      );
    }

    const [, id] = route.pattern.exec(url.pathname) ?? [];
    return route.handle(asking.value, request, id === undefined ? {} : { id }, url.searchParams);
  };
}
