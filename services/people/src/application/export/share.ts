import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type PendingEvent, type Result } from '@kithena/domain-kit';
import {
  ExportShareDecided,
  ExportShareRequested,
  ExportShared,
  requiresApproval,
  type AttributeDefinition,
} from '@kithena/contracts';
import * as z from 'zod';

import { visibleTo } from '../../domain/access/field-access.js';
import { effectiveRoles, type Holdings } from '../../domain/access/roles.js';
import { writable } from '../../domain/access/view-as.js';
import { openApproval, stateAt, type ApprovalState } from '../../domain/approval/approval.js';
import {
  aboutSheet,
  approversFor,
  decideShare,
  exportCode,
  gapBetween,
  recipientIn,
  type About,
  type Gap,
  type Readable,
  type Share,
} from '../../domain/export/share.js';
import { mayManage } from '../../domain/report/schedule.js';
import { seenBy } from '../../domain/segment/segment.js';
import type { SegmentStore } from '../../infrastructure/drizzle-segments.js';
import type { ReminderCompany } from '../completeness/reminders.js';
import { relationsToMany, type Asking } from '../person/person-access.js';
import { userActor, type Viewer } from '../person/ports.js';
import type { RoleCandidate, RoleStore } from '../roles/roles.js';
import { exportableColumns } from './export.js';
import {
  isFinancial,
  linksOf,
  runExportJob,
  type ExportJobDeps,
  type ExportJobRequest,
  type ExportNotifier,
} from './job.js';
import { LINK_LIFETIME_MS, SHARED_LIFETIME_MS } from './object-store.js';
import { QUEUE_THRESHOLD } from './queue.js';

/**
 * An export sent to somebody else (design AI13, AI14, MA10).
 *
 * **Same permissions, both ways.** The file is built as the person asking —
 * nothing they could not export themselves — and checked against what the
 * recipient could export themselves: their rows, their readable columns,
 * person by person. When it holds nothing more, it goes now. When it holds
 * more (a field they cannot see on somebody in it, or somebody they cannot
 * list), it waits for a People administrator who is neither asking nor
 * receiving (`domain/export/share.ts`), and is built only once approved.
 * Nobody's standing access changes: an approval covers one file.
 *
 * **Never an attachment.** The file is the export's own (`job.ts`), under
 * `shared/` for seven days. The recipient is emailed a link to the tenant
 * app, signed in; that page — for them and the requester only — signs the
 * file's link for minutes at a time. A forwarded email opens nothing.
 *
 * **Who it is for is People's to read**, from the sentence, among the
 * accounts that sign in here (`recipientIn`). The model is never asked.
 *
 * **Emails go after the commit.** Each use case returns what to send, and
 * the transport sends it once its transaction has committed, so a rolled-back
 * file is never announced.
 */

type Tx = PostgresJsDatabase;

/* ---------------------------------------------------------- the input -- */

const ConditionChoice = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  op: z.enum(['is', 'in', 'contains', 'before', 'after', 'between', 'empty', 'not_empty', 'under']),
  values: z.array(z.string().max(200)).max(50),
});

/** What to build: the builder's choices, never a value. */
export const ShareChoice = z.strictObject({
  format: z.enum(['csv', 'xlsx', 'pdf']),
  fields: z.array(z.string().max(64)).min(1).max(500),
  asOf: z.iso.date().optional(),
  segmentId: z.uuid().optional(),
  conditions: z.array(ConditionChoice).max(20).optional(),
  match: z.enum(['all', 'any']).optional(),
  /** Who, in the builder's words, for the About. */
  filter: z.string().max(500).optional(),
  reason: z.string().trim().min(1).max(500),
});
export type ShareChoice = z.infer<typeof ShareChoice>;

export const SharePreviewAsk = z.strictObject({
  choice: ShareChoice.extend({ reason: z.string().max(500).optional() }),
  /** Somebody picked; absent, People reads the sentence for a name or a role. */
  recipient: z.uuid().optional(),
  sentence: z.string().max(300).optional(),
});
export type SharePreviewAsk = z.infer<typeof SharePreviewAsk>;

export const ShareAsk = z.strictObject({ choice: ShareChoice, recipient: z.uuid() });
export type ShareAsk = z.infer<typeof ShareAsk>;

export const ShareDecisionAsk = z.strictObject({
  approve: z.boolean(),
  note: z.string().max(500).optional(),
});
export type ShareDecisionAsk = z.infer<typeof ShareDecisionAsk>;

/* ------------------------------------------------------------- ports -- */

export interface ShareRequest extends Share {
  readonly tenantId: string;
  readonly choice: ShareChoice;
  readonly gap: Gap;
  /** Set once approved and sent. */
  readonly exportId: string | null;
}

export interface ShareStore {
  insert(tx: Tx, request: ShareRequest): Promise<void>;
  find(tx: Tx, tenantId: string, id: string): Promise<ShareRequest | null>;
  byExport(tx: Tx, tenantId: string, exportId: string): Promise<ShareRequest | null>;
  /** Write `next` only if the row is still as `prior` left it. False when somebody got there first. */
  update(tx: Tx, prior: ShareRequest, next: ShareRequest): Promise<boolean>;
}

/** One email: whom, where its button goes, and which notice. Never what is in the file. */
export interface ShareMail {
  readonly email: string;
  readonly url: string;
  readonly notice: 'export_shared' | 'export_share_requested';
  /** The export or request and the recipient: a retry is the same email. */
  readonly dedupeKey: string;
}

export interface ShareMailer {
  send(tenantId: string, company: ReminderCompany, mail: ShareMail): Promise<void>;
}

export interface ShareDeps extends ExportJobDeps {
  readonly shares: ShareStore;
  readonly accounts: Pick<RoleStore, 'candidates' | 'holdings'>;
  readonly segments: Pick<SegmentStore, 'all'>;
  /** The company and its app's origin, for an email's link; null when not known yet. */
  readonly company?: (tx: Tx, tenantId: string) => Promise<ReminderCompany | null>;
  /** Absent: nothing is emailed, and the screens say so. */
  readonly mailer?: ShareMailer;
}

/** How long a request waits for a decision, and how long a sent file is kept. */
export const SHARE_DECISION_MS = 7 * 24 * 60 * 60 * 1000;

/** The file is announced by the email; the requester's own notice is not needed. */
const SILENT: ExportNotifier = { notify: () => Promise.resolve() };

/* ------------------------------------------------------------ reading -- */

/** The request a choice is, as the export route builds it: a segment is the requester's to see. */
async function requestOf(
  tx: Tx,
  deps: ShareDeps,
  asking: Asking,
  choice: z.infer<typeof SharePreviewAsk>['choice'],
): Promise<Result<ExportJobRequest>> {
  let request: ExportJobRequest = {
    ...asking,
    format: choice.format,
    fields: choice.fields,
    ...(choice.asOf === undefined ? {} : { asOf: choice.asOf }),
    ...(choice.filter === undefined ? {} : { filter: choice.filter }),
    ...(choice.conditions === undefined || choice.conditions.length === 0
      ? {}
      : { refine: { conditions: choice.conditions, match: choice.match ?? 'all' } }),
    ...(choice.reason === undefined ? {} : { reason: choice.reason }),
  };
  if (choice.segmentId !== undefined) {
    const id = choice.segmentId;
    const segment = (await deps.segments.all(tx, asking.tenantId)).find(
      (s) => s.id === id && seenBy(s, asking.viewer.accountId),
    );
    if (segment === undefined) {
      return err(failure('NOT_FOUND', 'There is no such segment', ['segmentId']));
    }
    request = { ...request, where: segment.filter, filter: choice.filter ?? segment.name };
  }
  return ok(request);
}

/**
 * Who in the file `viewer` may list, and which of its fields they may read
 * on each — the export's own reading, without building the file. A list the
 * viewer may not run at all (a filter they may not use) is nobody.
 */
async function readableBy(
  tx: Tx,
  deps: ShareDeps,
  request: ExportJobRequest,
  viewer: Viewer,
): Promise<Result<Readable>> {
  const version = await deps.schemas.current(tx, request.tenantId);
  if (!version) return err(failure('SCHEMA_NOT_PUBLISHED', 'Nothing is published to export'));
  const wanted = new Set(request.fields);
  const columns = exportableColumns(version).filter((d) => wanted.has(d.key));
  const readable = new Map<string, Set<string>>();
  let after: string | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop -- a page needs the cursor the last one ended on
    const page: Awaited<ReturnType<typeof deps.access.list>> = await deps.access.list(tx, {
      ...request,
      viewer,
      after,
      limit: 500,
      ...(request.asOf ? { asOf: request.asOf } : {}),
    });
    if (!page.ok) return viewer === request.viewer ? page : ok(new Map());
    // eslint-disable-next-line no-await-in-loop -- one page's relations, in the page's transaction
    const related = await relationsToMany(
      deps.relations,
      tx,
      request.tenantId,
      viewer,
      page.value.items.map((p) => p.id),
    );
    for (const person of page.value.items) {
      const relations = related.get(person.id);
      if (relations === undefined) continue;
      readable.set(
        person.id,
        new Set(columns.filter((d) => visibleTo(d, relations)).map((d) => d.key)),
      );
    }
    after = page.value.next;
  } while (after !== null && readable.size <= QUEUE_THRESHOLD);
  return ok(readable);
}

interface Accounts {
  readonly holdings: Holdings;
  readonly candidates: readonly RoleCandidate[];
  readonly byId: ReadonlyMap<string, RoleCandidate>;
}

async function accountsOf(tx: Tx, deps: ShareDeps, tenantId: string): Promise<Accounts> {
  const [holdings, candidates] = await Promise.all([
    deps.accounts.holdings(tx, tenantId),
    deps.accounts.candidates(tx, tenantId),
  ]);
  return { holdings, candidates, byId: new Map(candidates.map((c) => [c.accountId, c])) };
}

const viewerOf = (accounts: Accounts, accountId: string): Viewer => ({
  accountId,
  roles: effectiveRoles(accounts.holdings.get(accountId) ?? []),
});

type Person = { readonly accountId: string; readonly name: string | null };

/** An account by the name People holds for it: a colleague's name, as the directory shows it. */
const person = (accounts: Accounts, accountId: string): Person => ({
  accountId,
  name: accounts.byId.get(accountId)?.name ?? null,
});
const named = (accounts: Accounts, accountId: string | null): Person | null =>
  accountId === null ? null : person(accounts, accountId);

async function labelsOf(
  tx: Tx,
  deps: ShareDeps,
  tenantId: string,
): Promise<ReadonlyMap<string, AttributeDefinition>> {
  const version = await deps.schemas.current(tx, tenantId);
  return new Map(version?.document.attributes.map((d) => [d.key, d]));
}

/* ------------------------------------------------------------ preview -- */

export interface SharePreview {
  /** Whom it would go to: picked, or read from the sentence; null when nobody fits. */
  readonly recipient: { readonly accountId: string; readonly name: string | null } | null;
  /** Everybody it could go to: an account with a work email, not the asker. */
  readonly candidates: readonly { readonly accountId: string; readonly name: string }[];
  /** People in the file, as the asker reads it. */
  readonly people: number;
  /** Fields in it that are sensitive (a change to them waits for approval). */
  readonly sensitive: readonly string[];
  /** What the recipient could not read themselves; null when nothing. */
  readonly gap: {
    readonly fields: readonly {
      readonly key: string;
      readonly label: string;
      readonly people: number;
    }[];
    readonly unlisted: number;
  } | null;
  /** Who would be asked to approve it, when it needs approving. */
  readonly approvers: readonly { readonly accountId: string; readonly name: string | null }[];
  /** Over the size a file is sent at; it can still be downloaded. */
  readonly tooLarge: boolean;
  /** Whether the recipient and approvers are emailed here. */
  readonly emailed: boolean;
  /** Whether the asker may turn it into a scheduled report, and their own account for one. */
  readonly canSchedule: boolean;
  readonly self: string;
}

export async function previewShare(
  tx: Tx,
  deps: ShareDeps,
  asking: Asking,
  input: SharePreviewAsk,
): Promise<Result<SharePreview>> {
  const request = await requestOf(tx, deps, asking, input.choice);
  if (!request.ok) return request;
  const mine = await readableBy(tx, deps, request.value, asking.viewer);
  if (!mine.ok) return mine;
  const accounts = await accountsOf(tx, deps, asking.tenantId);
  const labels = await labelsOf(tx, deps, asking.tenantId);

  const reachable = accounts.candidates.filter(
    (c) => c.accountId !== asking.viewer.accountId && c.workEmail !== null && c.name !== null,
  );
  const asked = input.recipient ?? null;
  const read =
    asked === null && input.sentence !== undefined
      ? recipientIn(
          input.sentence,
          reachable.map((c) => ({
            accountId: c.accountId,
            name: c.name,
            roles: accounts.holdings.get(c.accountId) ?? new Set(),
          })),
          asking.viewer.accountId,
        )
      : null;
  const recipient = reachable.find((c) => c.accountId === (asked ?? read)) ?? null;

  let gap: Gap | null = null;
  if (recipient !== null) {
    const theirs = await readableBy(
      tx,
      deps,
      request.value,
      viewerOf(accounts, recipient.accountId),
    );
    if (!theirs.ok) return theirs;
    gap = gapBetween(mine.value, theirs.value, input.choice.fields);
  }
  return ok({
    recipient: recipient === null ? null : named(accounts, recipient.accountId),
    candidates: reachable
      .map((c) => ({ accountId: c.accountId, name: c.name ?? '' }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    people: mine.value.size,
    sensitive: input.choice.fields.filter((k) => {
      const d = labels.get(k);
      return d !== undefined && (requiresApproval(d) || isFinancial(d));
    }),
    gap:
      gap === null
        ? null
        : {
            fields: gap.fields.map((f) => ({
              ...f,
              label: labels.get(f.key)?.label.default ?? f.key,
            })),
            unlisted: gap.unlisted,
          },
    approvers:
      recipient === null || gap === null
        ? []
        : approversFor(accounts.holdings, asking.viewer.accountId, recipient.accountId).map((a) =>
            person(accounts, a),
          ),
    tooLarge: mine.value.size > QUEUE_THRESHOLD,
    emailed: deps.mailer !== undefined && deps.company !== undefined,
    canSchedule: mayManage(asking.viewer.roles),
    self: asking.viewer.accountId,
  });
}

/* --------------------------------------------------------------- send -- */

export type Shared =
  | { readonly status: 'sent'; readonly exportId: string }
  | {
      readonly status: 'waiting';
      readonly requestId: string;
      readonly approvers: readonly { readonly accountId: string; readonly name: string | null }[];
    };

/** What a use case did, and the emails to send once it has committed. */
export interface WithMail<T> {
  readonly value: T;
  readonly mail: readonly ShareMail[];
}

function event(
  deps: ShareDeps,
  tenantId: string,
  aggregate: PendingEvent['aggregate'],
  actor: PendingEvent['actor'],
  correlationId: string,
  name: string,
  payload: unknown,
): PendingEvent {
  return {
    eventId: deps.newId(),
    eventName: name,
    eventVersion: 1,
    tenantId: tenantId as PendingEvent['tenantId'],
    occurredAt: deps.clock.instant(),
    effectiveFrom: null,
    aggregate,
    actor,
    correlationId,
    causationId: null,
    payload,
  };
}

async function linkTo(
  tx: Tx,
  deps: ShareDeps,
  tenantId: string,
  query: Record<string, string>,
): Promise<string | null> {
  const company = deps.company === undefined ? null : await deps.company(tx, tenantId);
  if (company === null || deps.mailer === undefined) return null;
  const url = new URL('/people/export', company.origin);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url.toString();
}

/** Build it as the requester, keep it a week for the recipient, and say so. */
async function send(
  tx: Tx,
  deps: ShareDeps,
  request: ExportJobRequest,
  recipient: RoleCandidate,
  requestId: string | null,
): Promise<Result<WithMail<string>>> {
  const built = await runExportJob(
    tx,
    { ...deps, notifier: SILENT },
    { ...request, sharedWith: recipient.accountId },
  );
  if (!built.ok) return built;
  const exportId = built.value.exportId;
  await deps.audit.publish(tx, [
    event(
      deps,
      request.tenantId,
      { type: 'Export', id: exportId, version: 2 },
      userActor(request.viewer),
      request.correlationId,
      ExportShared.name,
      ExportShared.payload.parse({
        exportId,
        recipientAccountId: recipient.accountId,
        requestId,
        linkExpiresAt: built.value.expiresAt,
      }),
    ),
  ]);
  const url = await linkTo(tx, deps, request.tenantId, { export: exportId });
  return ok({
    value: exportId,
    mail:
      url === null || recipient.workEmail === null
        ? []
        : [
            {
              email: recipient.workEmail,
              url,
              notice: 'export_shared',
              dedupeKey: `export-shared/${exportId}/${recipient.accountId}`,
            },
          ],
  });
}

const NotAReceiver = failure(
  'RECIPIENT_UNKNOWN',
  'Send it to somebody else who signs in here and has a work email',
  ['recipient'],
);

/**
 * Send the export: now, when the recipient could read all of it themselves;
 * otherwise as a request a People administrator approves. Refused with
 * nobody to approve it, or over the size a file is sent at.
 */
export async function shareExport(
  tx: Tx,
  deps: ShareDeps,
  asking: Asking,
  input: ShareAsk,
): Promise<Result<WithMail<Shared>>> {
  const may = writable(asking.viewer);
  if (!may.ok) return may;
  const accounts = await accountsOf(tx, deps, asking.tenantId);
  const recipient = accounts.byId.get(input.recipient);
  if (
    recipient === undefined ||
    recipient.workEmail === null ||
    recipient.accountId === asking.viewer.accountId
  ) {
    return err(NotAReceiver);
  }
  const request = await requestOf(tx, deps, asking, input.choice);
  if (!request.ok) return request;
  const mine = await readableBy(tx, deps, request.value, asking.viewer);
  if (!mine.ok) return mine;
  if (mine.value.size > QUEUE_THRESHOLD) {
    return err(
      failure(
        'EXPORT_TOO_LARGE_TO_SEND',
        `A file is sent for up to ${String(QUEUE_THRESHOLD)} people; download this one instead`,
      ),
    );
  }
  const theirs = await readableBy(tx, deps, request.value, viewerOf(accounts, recipient.accountId));
  if (!theirs.ok) return theirs;
  const gap = gapBetween(mine.value, theirs.value, input.choice.fields);

  if (gap === null) {
    const sent = await send(tx, deps, request.value, recipient, null);
    return sent.ok
      ? ok({ value: { status: 'sent', exportId: sent.value.value }, mail: sent.value.mail })
      : sent;
  }

  const approvers = approversFor(accounts.holdings, asking.viewer.accountId, recipient.accountId);
  if (approvers.length === 0) {
    return err(
      failure(
        'NO_APPROVER',
        'Nobody else here can approve sending this: it needs a People administrator who is neither you nor the recipient',
      ),
    );
  }
  const now = deps.clock.instant();
  const approval = openApproval({
    id: deps.newId(),
    requestedBy: asking.viewer.accountId,
    reason: input.choice.reason,
    at: now,
    expiresAt: new Date(Date.parse(now) + SHARE_DECISION_MS).toISOString(),
  });
  if (!approval.ok) return approval;
  const share: ShareRequest = {
    tenantId: asking.tenantId,
    approval: approval.value,
    recipient: recipient.accountId,
    choice: input.choice,
    gap,
    exportId: null,
  };
  await deps.shares.insert(tx, share);
  await deps.audit.publish(tx, [
    event(
      deps,
      asking.tenantId,
      { type: 'ExportShareRequest', id: approval.value.id, version: 1 },
      userActor(asking.viewer),
      asking.correlationId,
      ExportShareRequested.name,
      ExportShareRequested.payload.parse({
        requestId: approval.value.id,
        recipientAccountId: recipient.accountId,
        attributeKeys: gap.fields.map((f) => f.key),
        reason: approval.value.reason,
        expiresAt: approval.value.expiresAt,
      }),
    ),
  ]);
  const url = await linkTo(tx, deps, asking.tenantId, { share: approval.value.id });
  return ok({
    value: {
      status: 'waiting',
      requestId: approval.value.id,
      approvers: approvers.map((a) => person(accounts, a)),
    },
    mail:
      url === null
        ? []
        : approvers.flatMap((a) => {
            const email = accounts.byId.get(a)?.workEmail ?? null;
            return email === null
              ? []
              : [
                  {
                    email,
                    url,
                    notice: 'export_share_requested' as const,
                    dedupeKey: `export-share/${approval.value.id}/${a}`,
                  },
                ];
          }),
  });
}

/* ------------------------------------------------------------- decide -- */

/**
 * A People administrator, neither asking nor receiving, approves or not.
 * Approved, the file is built then, as the requester reads it then — an
 * approval unmasks nothing and widens nothing of theirs — and sent.
 */
export async function decideExportShare(
  tx: Tx,
  deps: ShareDeps,
  asking: Asking,
  requestId: string,
  input: ShareDecisionAsk,
): Promise<Result<WithMail<ShareView>>> {
  const may = writable(asking.viewer);
  if (!may.ok) return may;
  const prior = await deps.shares.find(tx, asking.tenantId, requestId);
  if (prior === null) return err(failure('NOT_FOUND', 'No such request'));
  const decided = decideShare(
    prior,
    asking.viewer,
    input.approve,
    deps.clock.instant(),
    input.note ?? null,
  );
  if (!decided.ok) return decided;
  if (!(await deps.shares.update(tx, prior, decided.value))) {
    return err(failure('APPROVAL_DECIDED', 'Somebody decided this request first'));
  }
  const next = decided.value;
  await deps.audit.publish(tx, [
    event(
      deps,
      asking.tenantId,
      { type: 'ExportShareRequest', id: requestId, version: 2 },
      userActor(asking.viewer),
      asking.correlationId,
      ExportShareDecided.name,
      ExportShareDecided.payload.parse({
        requestId,
        decision: input.approve ? 'approved' : 'rejected',
        recipientAccountId: next.recipient,
        attributeKeys: next.gap.fields.map((f) => f.key),
        note: next.approval.note,
      }),
    ),
  ]);

  let mail: readonly ShareMail[] = [];
  if (input.approve) {
    const accounts = await accountsOf(tx, deps, asking.tenantId);
    const recipient = accounts.byId.get(next.recipient);
    if (recipient === undefined || recipient.workEmail === null) return err(NotAReceiver);
    const asRequester: Asking = {
      tenantId: asking.tenantId,
      viewer: viewerOf(accounts, next.approval.requestedBy),
      correlationId: asking.correlationId,
    };
    const request = await requestOf(tx, deps, asRequester, next.choice);
    if (!request.ok) return request;
    const sent = await send(tx, deps, request.value, recipient, requestId);
    if (!sent.ok) return sent;
    const issued = { ...next, exportId: sent.value.value };
    if (!(await deps.shares.update(tx, next, issued))) {
      return err(failure('APPROVAL_DECIDED', 'Somebody decided this request first'));
    }
    mail = sent.value.mail;
  }
  const view = await shareView(tx, deps, asking, requestId);
  return view.ok ? ok({ value: view.value, mail }) : view;
}

/* ------------------------------------------------------------- views -- */

/** A request to send, as its requester, its recipient or an administrator sees it. */
export interface ShareView {
  readonly id: string;
  readonly state: ApprovalState;
  readonly requestedBy: Person;
  readonly recipient: Person;
  readonly reason: string;
  readonly requestedAt: string;
  readonly expiresAt: string;
  readonly decidedBy: Person | null;
  readonly decidedAt: string | null;
  readonly note: string | null;
  readonly fields: readonly string[];
  readonly gap: SharePreview['gap'];
  readonly asOf: string | null;
  readonly format: ShareChoice['format'];
  readonly audience: string | null;
  /** The file, once sent. */
  readonly exportId: string | null;
  readonly mine: boolean;
  readonly canDecide: boolean;
  /** Who may decide it, while it waits. */
  readonly approvers: readonly Person[];
}

export async function shareView(
  tx: Tx,
  deps: ShareDeps,
  asking: Asking,
  requestId: string,
): Promise<Result<ShareView>> {
  const share = await deps.shares.find(tx, asking.tenantId, requestId);
  const me = asking.viewer.accountId;
  const admin = asking.viewer.roles.has('people_admin');
  if (share === null || !(share.approval.requestedBy === me || share.recipient === me || admin)) {
    return err(failure('NOT_FOUND', 'No such request'));
  }
  const accounts = await accountsOf(tx, deps, asking.tenantId);
  const labels = await labelsOf(tx, deps, asking.tenantId);
  const state = stateAt(share.approval, deps.clock.instant());
  const a = share.approval;
  return ok({
    id: a.id,
    state,
    requestedBy: person(accounts, a.requestedBy),
    recipient: person(accounts, share.recipient),
    reason: a.reason,
    requestedAt: a.requestedAt,
    expiresAt: a.expiresAt,
    decidedBy: named(accounts, a.decidedBy),
    decidedAt: a.decidedAt,
    note: a.note,
    fields: share.choice.fields.map((k) => labels.get(k)?.label.default ?? k),
    gap: {
      fields: share.gap.fields.map((f) => ({
        ...f,
        label: labels.get(f.key)?.label.default ?? f.key,
      })),
      unlisted: share.gap.unlisted,
    },
    asOf: share.choice.asOf ?? null,
    format: share.choice.format,
    audience: share.choice.filter ?? null,
    exportId: share.exportId,
    mine: a.requestedBy === me,
    canDecide: state === 'pending' && admin && a.requestedBy !== me && share.recipient !== me,
    approvers:
      state === 'pending'
        ? approversFor(accounts.holdings, a.requestedBy, share.recipient).map((id) =>
            person(accounts, id),
          )
        : [],
  });
}

/** A finished export as AI14 shows it: what it holds, where it went, and the About inside it. */
export interface ExportRecordView {
  readonly id: string;
  readonly code: string;
  readonly status: 'queued' | 'completed' | 'expired';
  readonly mine: boolean;
  readonly requestedBy: Person;
  readonly sentTo: Person | null;
  readonly openedAt: string | null;
  readonly approvedBy: (Person & { readonly at: string | null }) | null;
  readonly reason: string | null;
  readonly rowCount: number | null;
  readonly fields: readonly string[];
  readonly sensitive: number;
  readonly asOf: string | null;
  readonly format: string | null;
  readonly expiresAt: string | null;
  readonly about: About | null;
  /** How long the record is kept: no period is decided yet (PEO-129). */
  readonly keptUntil: string | null;
  /** The file's links, for the requester or recipient while it lasts; signed for minutes. */
  readonly links: readonly { readonly name: string; readonly url: string }[];
  /** The time the view was made, for "at 14:31" against "15 Sep". */
  readonly now: string;
}

/** How long a link handed to the page is good for: long enough to click, not to forward. */
export const SHARED_LINK_MS = 15 * 60 * 1000;

/**
 * The export, for its requester or its recipient only. The recipient's first
 * look is recorded as when it was opened.
 */
export async function exportRecord(
  tx: Tx,
  deps: ShareDeps,
  asking: Asking,
  exportId: string,
): Promise<Result<ExportRecordView>> {
  const entry = await deps.ledger.find(tx, asking.tenantId, exportId);
  const me = asking.viewer.accountId;
  const sharedWith = entry?.status === 'completed' ? (entry.sharedWith ?? null) : null;
  if (entry === null || !(entry.requestedBy === me || sharedWith === me)) {
    return err(failure('NOT_FOUND', 'No such export'));
  }
  const accounts = await accountsOf(tx, deps, asking.tenantId);
  if (entry.status === 'queued') {
    return ok(emptyRecord(exportId, me, person(accounts, entry.requestedBy), deps.clock.instant()));
  }
  const now = deps.clock.instant();
  const expired = Date.parse(now) >= Date.parse(entry.expiresAt);
  let openedAt = entry.openedAt ?? null;
  if (sharedWith === me && openedAt === null && !expired) {
    await deps.ledger.opened(tx, asking.tenantId, exportId, now);
    openedAt = now;
  }
  const labels = await labelsOf(tx, deps, asking.tenantId);
  const keys = entry.attributeKeys ?? [];
  const defs = keys.flatMap((k) => labels.get(k) ?? []);
  const share = await deps.shares.byExport(tx, asking.tenantId, exportId);
  const recipient = named(accounts, sharedWith);
  const maker = person(accounts, entry.requestedBy);
  return ok({
    id: exportId,
    code: exportCode(exportId),
    status: expired ? 'expired' : 'completed',
    mine: entry.requestedBy === me,
    requestedBy: maker,
    sentTo: recipient,
    openedAt,
    approvedBy:
      share?.approval.decidedBy == null
        ? null
        : { ...person(accounts, share.approval.decidedBy), at: share.approval.decidedAt },
    reason: entry.reason,
    rowCount: entry.rowCount,
    fields: defs.map((d) => d.label.default),
    sensitive: defs.filter((d) => requiresApproval(d) || isFinancial(d)).length,
    asOf: entry.asOf ?? null,
    format: entry.format,
    expiresAt: entry.expiresAt,
    about:
      entry.asOf == null
        ? null
        : aboutSheet({
            audience: entry.audience ?? 'Everyone you can see',
            count: entry.rowCount,
            fields: defs.map((d) => ({
              label: d.label.default,
              money: d.dataType === 'money',
              masked: d.encrypted,
            })),
            asOf: entry.asOf,
            madeBy: maker.name,
            // Built when its link's lifetime began, where the ledger keeps no time of its own.
            madeOn: (
              entry.completedAt ??
              new Date(
                Date.parse(entry.expiresAt) -
                  (sharedWith === null ? LINK_LIFETIME_MS : SHARED_LIFETIME_MS),
              ).toISOString()
            ).slice(0, 10),
            reason: entry.reason,
            recipient: recipient?.name ?? null,
            expiresOn: entry.expiresAt.slice(0, 10),
            exportId,
          }),
    keptUntil: null,
    links: expired
      ? []
      : await linksOf(
          deps.store,
          entry,
          sharedWith === null
            ? entry.expiresAt
            : new Date(Date.parse(now) + SHARED_LINK_MS).toISOString(),
        ),
    now,
  });
}

function emptyRecord(id: string, me: string, by: Person, now: string): ExportRecordView {
  return {
    id,
    code: exportCode(id),
    status: 'queued',
    mine: by.accountId === me,
    requestedBy: by,
    sentTo: null,
    openedAt: null,
    approvedBy: null,
    reason: null,
    rowCount: null,
    fields: [],
    sensitive: 0,
    asOf: null,
    format: null,
    expiresAt: null,
    about: null,
    keptUntil: null,
    links: [],
    now,
  };
}
