import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  ExportCompleted,
  FullValuesDecided,
  FullValuesExpired,
  FullValuesDownloaded,
  FullValuesIssued,
  FullValuesRequested,
} from '@kithena/contracts';

import {
  decide,
  expire,
  openApproval,
  stateAt,
  useOnce,
  type Approval,
  type Grant,
} from '../../domain/approval/approval.js';
import type { Asking } from '../person/person-access.js';
import { buildExport, exportableColumns, type Reveal } from './export.js';
import type { ExportJobDeps } from './job.js';

/**
 * Full values for finance, through somebody else's hands (PEO-088; PRD §15.2).
 *
 * The product decision: **finance never downloads a sensitive value
 * directly.** Finance asks for a named export and says why; HR approves or
 * rejects; an approval issues **one** download, of one file, behind a link
 * that works once and for 24 hours. Every step is an event carrying the
 * actor, the reason and the field keys — never a value, never a link.
 *
 * - **Only finance asks, only HR decides**, and nobody decides their own
 *   request (the domain's rule, whatever roles they hold).
 * - **Seven days to decide.** A request nobody decided expires, and the
 *   expiry is itself an event: an unanswered request is an answer.
 * - **Special-category data is never in it**, approved or not. §15.2 sends it
 *   through the subject access path, and `exportableColumns` refuses it here
 *   exactly as it does for every export.
 * - **Only the fields asked for are revealed.** A sealed field outside the
 *   request stays masked in the approved file; a field finance cannot read
 *   is not a column at all, because the file is built as finance reads.
 * - **A revealed value is read inside the build and nowhere else**: not
 *   cached, not logged, not in an event, not in the ledger.
 *
 * The long wait is a Temporal workflow (`infrastructure/temporal/`), which
 * only wakes `settle` — on the decision, or when the week runs out. The rows
 * here are the truth, so a lost signal or a replayed activity changes
 * nothing that `settle` would not do anyway.
 */

export const DECISION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const DOWNLOAD_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface FullValuesRequest {
  readonly tenantId: string;
  readonly approval: Approval;
  readonly attributeKeys: readonly string[];
  readonly asOf: string | null;
  readonly personIds: readonly string[] | null;
  readonly filter: string | null;
  /** Set when the approved file was issued. */
  readonly exportId: string | null;
  readonly fileName: string | null;
  readonly grant: Grant | null;
}

export interface FullValuesStore {
  insert(tx: PostgresJsDatabase, request: FullValuesRequest): Promise<void>;
  find(tx: PostgresJsDatabase, tenantId: string, id: string): Promise<FullValuesRequest | null>;
  /**
   * Write `next` only if the stored row is still as `prior` left it: the same
   * state, and not yet issued or used. False when somebody got there first.
   */
  update(
    tx: PostgresJsDatabase,
    prior: FullValuesRequest,
    next: FullValuesRequest,
  ): Promise<boolean>;
}

export interface FullValuesDeps extends ExportJobDeps {
  readonly requests: FullValuesStore;
  /** `drizzleSecretStore.reveal`. Called only while building an approved file. */
  readonly reveal: Reveal['value'];
}

/** The object key of an approved file: the request id is in it, so a download can find its grant. */
export const fullValuesKey = (tenantId: string, requestId: string, name: string) =>
  `${tenantId}/full-values/${requestId}/${name}`;

const KEY = /^([0-9a-f-]{36})\/full-values\/([0-9a-f-]{36})\//u;

/** The tenant and request a stored key belongs to, or null for an ordinary export. */
export function fullValuesOf(key: string): { tenantId: string; requestId: string } | null {
  const m = KEY.exec(key);
  return m?.[1] && m[2] ? { tenantId: m[1], requestId: m[2] } : null;
}

function event(
  deps: FullValuesDeps,
  request: FullValuesRequest,
  actor: PendingEvent['actor'],
  correlationId: string,
  eventName: string,
  payload: unknown,
  aggregateVersion: number,
): PendingEvent {
  return {
    eventId: deps.newId(),
    eventName,
    eventVersion: 1,
    tenantId: request.tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate: { type: 'FullValuesRequest', id: request.approval.id, version: aggregateVersion },
    actor,
    correlationId,
    causationId: null,
    payload,
  };
}

const user = (userId: string): PendingEvent['actor'] => ({ kind: 'user', userId });
const SETTLE: PendingEvent['actor'] = { kind: 'system', process: 'people-full-values' };
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

/* ---------------------------------------------------------------- ask -- */

export async function requestFullValues(
  tx: PostgresJsDatabase,
  deps: FullValuesDeps,
  asking: Asking & {
    readonly fields: readonly string[];
    readonly reason: string | null | undefined;
    readonly asOf?: string;
    readonly personIds?: readonly string[];
    readonly filter?: string;
  },
): Promise<Result<FullValuesRequest>> {
  if (!asking.viewer.roles.has('finance')) {
    return err(failure('FORBIDDEN', 'Only finance asks for full values'));
  }
  const version = await deps.schemas.current(tx, asking.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published to export'));

  // Special-category, not exportable, archived or unknown: one refusal, as
  // `buildExport` gives, so a probe cannot tell which.
  const columns = new Map(exportableColumns(version).map((d) => [d.key as string, d]));
  const refused = asking.fields.filter((k) => !columns.has(k));
  if (asking.fields.length === 0 || refused.length > 0) {
    return err(
      failure(
        'EXPORT_FIELD_REFUSED',
        `Not exportable: ${refused.join(', ') || 'no fields'}`,
        refused,
      ),
    );
  }
  if (!asking.fields.some((k) => columns.get(k)?.encrypted)) {
    return err(
      failure('NOTHING_SEALED', 'None of these fields is masked; export them without approval', [
        'fields',
      ]),
    );
  }

  const now = deps.clock.instant();
  const approval = openApproval({
    id: deps.newId(),
    requestedBy: asking.viewer.accountId,
    reason: asking.reason,
    at: now,
    expiresAt: plus(now, DECISION_WINDOW_MS),
  });
  if (!approval.ok) return approval;

  const request: FullValuesRequest = {
    tenantId: asking.tenantId,
    approval: approval.value,
    attributeKeys: [...asking.fields],
    asOf: asking.asOf ?? null,
    personIds: asking.personIds ? [...asking.personIds] : null,
    filter: asking.filter ?? null,
    exportId: null,
    fileName: null,
    grant: null,
  };
  await deps.requests.insert(tx, request);
  await deps.audit.publish(tx, [
    event(
      deps,
      request,
      user(asking.viewer.accountId),
      asking.correlationId,
      FullValuesRequested.name,
      FullValuesRequested.payload.parse({
        requestId: approval.value.id,
        attributeKeys: request.attributeKeys,
        reason: approval.value.reason,
        expiresAt: approval.value.expiresAt,
      }),
      1,
    ),
  ]);
  return ok(request);
}

/* ------------------------------------------------------------- decide -- */

export async function decideFullValues(
  tx: PostgresJsDatabase,
  deps: FullValuesDeps,
  asking: Asking & {
    readonly requestId: string;
    readonly approve: boolean;
    readonly note?: string | null;
  },
): Promise<Result<FullValuesRequest>> {
  if (!asking.viewer.roles.has('hr')) {
    return err(failure('FORBIDDEN', 'Only HR decides a request for full values'));
  }
  const prior = await deps.requests.find(tx, asking.tenantId, asking.requestId);
  if (!prior) return err(failure('NOT_FOUND', 'No such request'));

  const decided = decide(prior.approval, {
    by: asking.viewer.accountId,
    approve: asking.approve,
    at: deps.clock.instant(),
    note: asking.note ?? null,
  });
  if (!decided.ok) return decided;

  const next = { ...prior, approval: decided.value };
  if (!(await deps.requests.update(tx, prior, next))) {
    return err(failure('APPROVAL_DECIDED', 'Somebody decided this request first'));
  }
  await deps.audit.publish(tx, [
    event(
      deps,
      next,
      user(asking.viewer.accountId),
      asking.correlationId,
      FullValuesDecided.name,
      FullValuesDecided.payload.parse({
        requestId: next.approval.id,
        decision: decided.value.state,
        attributeKeys: next.attributeKeys,
        reason: next.approval.reason,
        note: decided.value.note,
      }),
      2,
    ),
  ]);
  return ok(next);
}

/* ------------------------------------------------------------- settle -- */

export type Settled = 'pending' | 'expired' | 'rejected' | 'issued';

/**
 * Whatever the request's state calls for now: record an expiry that is due,
 * issue an approved file that has not been issued, or nothing. Idempotent —
 * the workflow's activity, retried or replayed, lands here every time.
 */
export async function settleFullValues(
  tx: PostgresJsDatabase,
  deps: FullValuesDeps,
  where: { readonly tenantId: string; readonly requestId: string; readonly correlationId: string },
): Promise<Result<Settled>> {
  const prior = await deps.requests.find(tx, where.tenantId, where.requestId);
  if (!prior) return err(failure('NOT_FOUND', 'No such request'));
  const now = deps.clock.instant();

  switch (stateAt(prior.approval, now)) {
    case 'pending':
      return ok('pending');
    case 'rejected':
      return ok('rejected');
    case 'expired': {
      if (prior.approval.state === 'expired') return ok('expired');
      const expired = expire(prior.approval, now);
      if (!expired.ok) return expired;
      const next = { ...prior, approval: expired.value };
      if (await deps.requests.update(tx, prior, next)) {
        await deps.audit.publish(tx, [
          event(
            deps,
            next,
            SETTLE,
            where.correlationId,
            FullValuesExpired.name,
            FullValuesExpired.payload.parse({
              requestId: next.approval.id,
              attributeKeys: next.attributeKeys,
            }),
            3,
          ),
        ]);
      }
      return ok('expired');
    }
    case 'approved':
      return prior.exportId === null ? issue(tx, deps, prior, where.correlationId) : ok('issued');
  }
}

async function issue(
  tx: PostgresJsDatabase,
  deps: FullValuesDeps,
  prior: FullValuesRequest,
  correlationId: string,
): Promise<Result<Settled>> {
  // Built as finance reads, from the requester's own viewpoint: an approval
  // unmasks what they asked for, it does not widen what they may see.
  const asRequester = {
    tenantId: prior.tenantId,
    viewer: { accountId: prior.approval.requestedBy, roles: new Set(['finance']) },
    correlationId,
  };
  const built = await buildExport(
    tx,
    deps,
    {
      ...asRequester,
      format: 'xlsx',
      fields: prior.attributeKeys,
      ...(prior.asOf ? { asOf: prior.asOf } : {}),
      ...(prior.personIds ? { personIds: prior.personIds } : {}),
      ...(prior.filter ? { filter: prior.filter } : {}),
    },
    { keys: new Set(prior.attributeKeys), value: deps.reveal },
  );
  if (!built.ok) return built;
  const file = built.value.files[0];
  if (!file) throw new Error('an XLSX export produced no file');

  const now = deps.clock.instant();
  const exportId = deps.newId();
  const grant: Grant = { issuedAt: now, expiresAt: plus(now, DOWNLOAD_LIFETIME_MS), usedAt: null };
  const next: FullValuesRequest = { ...prior, exportId, fileName: file.name, grant };
  const key = fullValuesKey(prior.tenantId, prior.approval.id, file.name);

  await deps.store.put(key, file.bytes, file.mediaType);
  if (!(await deps.requests.update(tx, prior, next))) return ok('issued');

  await deps.audit.publish(tx, [
    event(
      deps,
      next,
      SETTLE,
      correlationId,
      FullValuesIssued.name,
      FullValuesIssued.payload.parse({
        requestId: prior.approval.id,
        exportId,
        attributeKeys: built.value.attributeKeys,
        rowCount: built.value.rowCount,
        linkExpiresAt: grant.expiresAt,
      }),
      4,
    ),
    // Every export is `people.export.completed` as well, so a consumer
    // counting exports does not have to know this path exists.
    {
      ...event(
        deps,
        next,
        user(prior.approval.requestedBy),
        correlationId,
        ExportCompleted.name,
        ExportCompleted.payload.parse({
          exportId,
          attributeKeys: built.value.attributeKeys,
          rowCount: built.value.rowCount,
          format: 'xlsx',
          reason: prior.approval.reason,
        }),
        1,
      ),
      aggregate: { type: 'Export', id: exportId, version: 1 },
    },
  ]);
  await deps.notifier.notify({
    tenantId: prior.tenantId,
    recipientAccountId: prior.approval.requestedBy,
    exportId,
    links: [{ name: file.name, url: await deps.store.sign(key, grant.expiresAt) }],
    expiresAt: grant.expiresAt,
  });
  return ok('issued');
}

/* ----------------------------------------------------------- download -- */

/**
 * Spend the one download. Called by the file route after the link's signature
 * and expiry have checked out, and before a byte is sent.
 */
export async function claimDownload(
  tx: PostgresJsDatabase,
  deps: FullValuesDeps,
  where: { readonly tenantId: string; readonly requestId: string; readonly correlationId: string },
): Promise<Result<void>> {
  const prior = await deps.requests.find(tx, where.tenantId, where.requestId);
  if (!prior?.grant || prior.exportId === null) {
    return err(failure('LINK_INVALID', 'This link is not valid'));
  }
  const used = useOnce(prior.grant, deps.clock.instant());
  if (!used.ok) return used;
  const next = { ...prior, grant: used.value };
  if (!(await deps.requests.update(tx, prior, next))) {
    return err(failure('GRANT_USED', 'This was already used; ask again'));
  }
  await deps.audit.publish(tx, [
    // The link is a bearer link, so who clicked is not known; it was issued
    // to the requester, and the event says so rather than guessing.
    event(
      deps,
      next,
      SETTLE,
      where.correlationId,
      FullValuesDownloaded.name,
      FullValuesDownloaded.payload.parse({
        requestId: prior.approval.id,
        exportId: prior.exportId,
        issuedTo: prior.approval.requestedBy,
      }),
      5,
    ),
  ]);
  return ok(undefined);
}

/** What the requester or HR sees of a request. The link, only for the requester, only while usable. */
export async function viewFullValues(
  tx: PostgresJsDatabase,
  deps: FullValuesDeps,
  asking: Asking & { readonly requestId: string },
): Promise<Result<{ request: FullValuesRequest; state: string; link: string | null }>> {
  const request = await deps.requests.find(tx, asking.tenantId, asking.requestId);
  const mine = request?.approval.requestedBy === asking.viewer.accountId;
  if (!request || !(mine || asking.viewer.roles.has('hr'))) {
    return err(failure('NOT_FOUND', 'No such request'));
  }
  const now = deps.clock.instant();
  const g = request.grant;
  const usable =
    mine && g !== null && g.usedAt === null && Date.parse(now) < Date.parse(g.expiresAt);
  const state = g?.usedAt ? 'downloaded' : g ? 'issued' : stateAt(request.approval, now);
  return ok({
    request,
    state,
    link:
      usable && request.fileName
        ? await deps.store.sign(
            fullValuesKey(request.tenantId, request.approval.id, request.fileName),
            g.expiresAt,
          )
        : null,
  });
}
