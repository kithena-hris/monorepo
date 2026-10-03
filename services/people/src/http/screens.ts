import { randomUUID } from 'node:crypto';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as z from 'zod';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { logger } from '@kithena/telemetry';
import { RequirednessPredicate, VisibilityRule } from '@kithena/contracts';

import {
  analyticsExport,
  analyticsView,
  INSIGHTS_TABS,
  type InsightsTab,
} from '../application/screens/analytics.js';
import { writeCsv } from '../application/import/csv.js';
import { transferHistoryView, type TransferHistory } from '../application/screens/transfers.js';
import {
  commitImportView,
  completeImportUpload,
  createEndpoint,
  deliveriesView,
  dryRunImport,
  newFieldsFile,
  importTemplateFile,
  integrationsView,
  startImportUpload,
  replayDelivery,
  rotateEndpoint,
  updateEndpoint,
  createScimConnection,
  revokeScimConnection,
  rotateScimToken,
  setScimMapping,
  type ImportDeps,
  type IntegrationDeps,
} from '../application/screens/operations.js';
import {
  checkGrid,
  checkSection,
  completenessView,
  directoryView,
  peopleHeadcount,
  remindWaiting,
  historyView,
  identifierReviewsView,
  approvalsView,
  duplicatesView,
  onboardingView,
  orgChartView,
  pickerView,
  profileView,
  saveGrid,
  saveSection,
} from '../application/screens/people.js';
import {
  BULK_PAGE,
  bulkEdit,
  bulkEditView,
  bulkHire,
  keptRows,
  replayed,
  type KeptRow,
} from '../application/screens/bulk-edit.js';
import { personOfViewer } from '../application/screens/record.js';
import { rolesView } from '../application/screens/roles.js';
import { overviewView } from '../application/screens/overview.js';
import {
  avatarsOf,
  completePhotoUpload,
  photoView,
  removePhoto,
  startPhotoUpload,
  type PhotoDeps,
} from '../application/screens/photo.js';
import { deleteSegment, saveSegment, segmentsView } from '../application/screens/segments.js';
import { requestDetails } from '../application/screens/requests.js';
import { namesView } from '../application/screens/names.js';
import {
  chatView,
  completeChat,
  connectChat,
  disconnectChat,
  setChatNotice,
} from '../application/settings/chat.js';
import { ask } from '../application/assistant/ask.js';
import type { AssistantPort } from '../application/assistant/assistant-port.js';
import {
  ImportStepInput,
  PlaceChoices,
  placeChoices,
  PlanInput as ImportPlanInput,
  planImport,
  proposeNewFields,
  RunInput as ImportRunInput,
  type NewFieldsDeps,
} from '../application/assistant/import-fields.js';
import {
  activeImportRunView,
  approveImport,
  importRunView,
  type RunStore,
  type WorkDeps,
} from '../application/import/run.js';
import type { ActivityStore } from '../application/settings/activity-store.js';
import { writeSameValue } from '../application/screens/bulk-edit.js';
import { PlanBudget } from '../domain/import/new-fields.js';
import {
  PlanAsk,
  exportViewWith,
  planDirectory,
  planExport,
  type SelectionDeps,
} from '../application/assistant/selection.js';
// Smart search (docs/ai-settings.md): its own block, beside search and export in words.
import {
  DirectoryAsk,
  DirectoryRemind,
  remindDirectory,
} from '../application/assistant/selection.js';
import {
  completeFileUpload,
  fileView,
  startFileUpload,
  type FileDeps,
} from '../application/screens/files.js';
import type { PayBandView } from '../application/analytics/pay.js';
import {
  announceSummary,
  FollowUpAsk,
  followUp,
  PeriodAsk,
  ShareAsk,
  sharedSummary,
  sharedSummaryFile,
  storeSummary,
  SummaryAsk,
  summaryDraft,
  summaryFile,
  whatChangedView,
  wordedPoints,
  type Phraser,
  type SummaryDeps,
  type SummaryFile,
  type SummaryShares,
} from '../application/screens/what-changed.js';
import {
  createSchedule,
  deleteSchedule,
  listSchedules,
  scheduleRuns,
  setPaused,
  updateSchedule,
  type ScheduleAdminDeps,
} from '../application/reports/scheduled.js';
import { reportRunsView, reportSchedulesView } from '../application/screens/reports.js';
import {
  addSection,
  adviseClassification,
  confirmEntity,
  previewPublish,
  publishDraft,
  publishSetup,
  registryView,
  reorderFields,
  reorderSections,
  saveField,
  setFieldSignup,
  setFieldAssistant,
  setupView,
  type SchemaScreenDeps,
} from '../application/screens/schema.js';
import { run } from '../application/person/service.js';
import {
  answerAboutChange,
  askAboutChange,
  markNotUnusual,
  setCheck,
} from '../application/person/approval-flags.js';
import { sharing } from '../infrastructure/unit-of-work.js';
import type { IdempotencyStore } from './idempotency.js';
import { NoBody } from './lifecycle.js';
import {
  AsOfQuery,
  filterIn,
  idempotent,
  json,
  parse,
  refused,
  UUID,
  type Route,
  type RestResponse,
} from './rest.js';

/**
 * What the tenant app's screens read and act through (PEO-098).
 *
 * `/v1/views/*` answers with a screen's view model; the rest are the writes
 * only the application layer had until now — the draft, publishing, the setup
 * pack, import, webhook endpoints. Every one goes through the same caller
 * check as the rest of REST (`callerFrom`), and every decision about who may
 * do or see what is made in `application/screens/*`, not here.
 *
 * Every write carries an Idempotency-Key, as the rest of REST does (PEO-116).
 * The use cases open their own transactions, so each runs inside `sharing`:
 * they join the one that stores the key, and the write and its key commit
 * together. A retry is answered from what now exists — never from a stored
 * body — so a secret an endpoint was created or rotated with is not in a
 * replay, and a replayed import says it was imported (its report is not kept;
 * PEO-090). The four POSTs that change nothing are `safe` and take no key.
 */

export type ScreenRouteDeps = SchemaScreenDeps &
  IntegrationDeps &
  ImportDeps & {
    /** Scheduled reports (PEO-069). Absent, their routes answer UNAVAILABLE. */
    readonly schedules?: ScheduleAdminDeps;
    /** Import & export's one history, over both ledgers. Absent, it answers UNAVAILABLE. */
    readonly transfers?: TransferHistory;
    /**
     * New fields from an import's unmatched columns (docs/ai-settings.md):
     * the model behind the AI gateway (absent, People's own proposal) and
     * the company's hourly budget for it.
     */
    readonly newFields?: { readonly planner?: AssistantPort; readonly budget: PlanBudget };
    /** Insights' "what changed", reworded by the assistant; absent, People's own words. */
    readonly insightsPhraser?: Phraser;
    /** Sending an Insights summary to somebody. Absent, it is not offered. */
    readonly insightsShares?: SummaryShares;
    /**
     * Search and export in words: the model behind the AI gateway with a
     * short timeout (absent, People's own rules), and each one's hourly
     * budget per company.
     */
    readonly selection?: {
      readonly planner?: AssistantPort;
      readonly search: PlanBudget;
      readonly export: PlanBudget;
    };
    /** Approved imports, run in the background (`import/run.ts`). Absent, "Approve and run" is UNAVAILABLE. */
    readonly importRuns?: {
      readonly store: RunStore;
      /** Start the run's worker, after the approval commits. */
      readonly kick: (tenantId: string, runId: string) => Promise<void>;
    };
    /** The settings log, for the fields an import adds. */
    readonly activity?: ActivityStore;
  };

/** New fields from an import: its file, and one value for many, in this process. */
export function newFieldsDeps(deps: ScreenRouteDeps): NewFieldsDeps {
  return {
    ...deps,
    ...(deps.newFields?.planner === undefined ? {} : { fieldPlanner: deps.newFields.planner }),
    // No model configured means no budget to spend either.
    planBudget: deps.newFields?.budget ?? new PlanBudget(0, 3_600_000),
    importFile: (asking, step) => newFieldsFile(deps, asking, importStep(step)),
    writeSame: (tx, asking, ids, values, from) =>
      writeSameValue(deps, tx, asking, ids, values, from),
    importReview: async (asking, step, version) => {
      const review = await dryRunImport(deps, asking, importStep(step), version);
      if (!review.ok) return review;
      return review.value.step === 'review'
        ? ok(review.value)
        : err(failure('UNAVAILABLE', 'The dry run did not answer with a review'));
    },
    importCommit: async (asking, step) => {
      const done = await commitImportView(deps, asking, importStep(step));
      if (!done.ok) return done;
      return done.value.step === 'done'
        ? ok(done.value)
        : err(failure('UNAVAILABLE', 'The import did not answer with its outcome'));
    },
  };
}

/** What an approved import's chunks run with (`importWork`). */
export const importWorkDeps = (deps: ScreenRouteDeps): WorkDeps => ({
  ...deps,
  ...newFieldsDeps(deps),
  sealed: deps.commit.reports.store,
  ...(deps.activity === undefined ? {} : { activity: deps.activity }),
});

export const ChatConnect = z.strictObject({ origin: z.url().max(300) });
export const ChatComplete = z.strictObject({
  code: z.string().min(1).max(500),
  state: z.string().min(1).max(2000),
});
export const ChatNotice = z.strictObject({ on: z.boolean() });
/** Flagged approvals (design AI7, AI8): a check switched, a question, its answer. */
export const ApprovalCheckBody = z.strictObject({ on: z.boolean() });
export const ApprovalQuestionBody = z.strictObject({ question: z.string().min(1).max(500) });
export const ApprovalAnswerBody = z.strictObject({ answer: z.string().min(1).max(500) });
export const Sections = z.strictObject({ changed: z.record(z.string(), z.unknown()) });
export const Entity = z.strictObject({ name: z.string().max(200), country: z.string().max(2) });
export const SetupChoice = z.strictObject({
  country: z.string().max(2),
  sections: z.array(z.string().max(64)).max(100),
});
export const Order = z.strictObject({ order: z.array(z.string().max(64)).max(500) });
export const Label = z.strictObject({ label: z.string().trim().min(1).max(120) });
export const Field = z.strictObject({
  input: z.object({
    key: z.string().max(64),
    sectionKey: z.string().max(64),
    label: z.string().trim().min(1).max(200),
    description: z.string().max(2000).nullable(),
    dataType: z.string().max(40),
    options: z.array(z.string().max(200)).max(200),
    requiredness: z.enum(['never', 'always', 'conditional']),
    // The contract's own schemas (PEO-065, PEO-066): the closed grammar is
    // refused here, at the boundary, and again by the draft.
    requiredWhen: RequirednessPredicate.nullable().default(null),
    ownership: z.array(z.string()).max(10),
    collectAt: z.string().max(20),
    visibility: z.array(z.string()).max(10),
    visibilityRules: z.array(VisibilityRule).max(5).default([]),
    classification: z.string().max(20),
    piiKind: z.string().max(20),
    classificationSource: z.enum(['suggested', 'human', 'section_default']),
    // Null keeps the default from the policy (PEO-077).
    requiresApproval: z.boolean().nullable().default(null),
    encrypted: z.boolean().nullable().default(null),
    // A bank account's or national identifier's country, and an identifier's scheme.
    country: z
      .string()
      .regex(/^[A-Z]{2}$/u)
      .nullable()
      .default(null),
    scheme: z.string().max(32).nullable().default(null),
    // Null keeps the default: shared where it could be.
    aiEligible: z.boolean().nullable().default(null),
  }),
  editing: z.string().max(64).nullable(),
});
export const Advice = z.strictObject({
  label: z.string().max(200),
  description: z.string().max(2000).nullable(),
  dataType: z.string().max(40),
  sectionKey: z.string().max(64),
  options: z.array(z.string().max(200)).max(200),
});
export const RequiredFrom = z.strictObject({ requiredFrom: z.iso.date() });
export const Grid = z.strictObject({
  changes: z
    .array(z.object({ personId: z.uuid(), values: z.record(z.string(), z.string()) }))
    .max(500),
});
/** A page of a bulk edit (PEO-071): the same values for these people, from one date. */
export const BulkEditBody = z.strictObject({
  personIds: z.array(z.uuid()).min(1).max(BULK_PAGE),
  values: z.record(z.string().max(64), z.unknown()),
  effectiveFrom: z.iso.date(),
  /** HR writes values that require approval without it (PEO-077). */
  applySensitiveWithoutApproval: z.boolean().optional(),
});
/** A page of a bulk hire: provisional people, each from a start date on their own calendar. */
export const BulkHireBody = z.strictObject({
  hires: z
    .array(
      z.strictObject({
        personId: z.uuid(),
        hireDate: z.iso.date(),
        /** For somebody placed nowhere on their start date; somebody placed keeps theirs. */
        legalEntityId: z.uuid().optional(),
        locationId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(BULK_PAGE),
});
export const EndpointBody = z.strictObject({
  url: z.string().max(2000),
  events: z.array(z.string().max(100)).max(50),
  allowlist: z.array(z.string().max(64)).max(500),
  alertEmail: z.string().max(320),
});
export const EndpointPatch = EndpointBody.partial().extend({ enabled: z.boolean().optional() });
/** A SCIM connection (PEO-072): what the tenant calls the upstream system. */
export const ScimConnectionBody = z.strictObject({ system: z.string().max(80) });
/** The approved mapping, whole (PEO-073): each SCIM path and the attribute it owns. */
export const ScimMappingBody = z.strictObject({
  mapping: z.array(z.strictObject({ path: z.string().max(200), key: z.string().max(64) })).max(200),
});
/** What the browser is about to upload: its name and exact size, never its bytes (§14.2). */
/** Whose photo: a person, or null for the viewer's own. */
export const PhotoOf = z.strictObject({ personId: z.uuid().nullable() });
export const FileStart = z.strictObject({
  personId: z.uuid().nullable(),
  key: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  size: z.int().positive(),
});
export const FileOf = z.strictObject({
  personId: z.uuid().nullable(),
  key: z.string().min(1).max(64),
});
export const AssistantShareBody = z.strictObject({ share: z.boolean() });
export const SignupAskBody = z.strictObject({ ask: z.enum(['off', 'optional', 'required']) });
export const AskBody = z.strictObject({
  question: z.string().trim().min(1).max(500),
  earlier: z.array(z.string().max(500)).max(10).default([]),
});
export const DetailAsk = z.strictObject({ keys: z.array(z.string().max(64)).min(1).max(50) });
export const PhotoStart = z.strictObject({
  personId: z.uuid().nullable(),
  size: z.int().min(1),
});
export const UploadStart = z.strictObject({
  name: z.string().max(255),
  size: z.int().min(1),
});
/** A step after the upload: which upload, and the mapping once there is one. */
export const ImportStepBody = z.strictObject({
  uploadId: z.uuid(),
  mapping: z.record(z.string(), z.string().nullable()).optional(),
  /** On commit only: HR writes values that require approval without it (PEO-077). */
  applySensitiveWithoutApproval: z.boolean().optional(),
  /** HR's choice for each work location value the file names. */
  places: PlaceChoices.optional(),
});

/** A pay band from a day (PEO-078): whole minor units, as digits. */
export const PayBandBody = z.strictObject({
  grade: z.string().max(64),
  currency: z.string().length(3),
  minimumMinor: z.string().max(15),
  midpointMinor: z.string().max(15),
  maximumMinor: z.string().max(15),
  effectiveFrom: z.string().max(10),
});

/** A saved segment (PEO-068): a name and the directory's filter, never a list of people. */
export const SegmentBody = z.strictObject({
  name: z.string().max(80),
  filter: z.record(z.string().max(64), z.string().max(200)),
  /** The directory's conditions, for a view saved from a search ("Save as view"). */
  conditions: z
    .array(
      z.strictObject({
        key: z.string().max(64),
        op: z.enum([
          'is',
          'in',
          'contains',
          'before',
          'after',
          'between',
          'empty',
          'not_empty',
          'under',
        ]),
        values: z.array(z.string().max(200)).max(50),
      }),
    )
    .max(10)
    .optional(),
  match: z.enum(['all', 'any']).optional(),
  shared: z.boolean(),
});

const hour = z.int().min(0).max(23);
/** A scheduled report (PEO-069): who it is about, what, when, and to whom. */
export const ScheduleBody = z.strictObject({
  name: z.string().max(80),
  audience: z.union([
    z.strictObject({ segmentId: z.uuid() }),
    z.strictObject({
      filter: z
        .record(z.string().max(64), z.string().max(200))
        .describe('Attribute key → value; {} is everybody each recipient may list.'),
    }),
  ]),
  report: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('export'),
      format: z.enum(['xlsx', 'pdf']),
      fields: z.array(z.string().max(64)).max(500).nullable().default(null),
      reason: z.string().max(500).nullable().default(null),
    }),
    z.strictObject({ kind: z.literal('summary') }),
  ]),
  cadence: z.discriminatedUnion('every', [
    z.strictObject({ every: z.literal('day'), hour }),
    z.strictObject({ every: z.literal('week'), weekday: z.int().min(1).max(7), hour }),
    z.strictObject({ every: z.literal('month'), day: z.int().min(1).max(28), hour }),
  ]),
  legalEntityId: z.uuid().nullable().default(null),
  recipients: z.array(z.uuid()).min(1).max(25),
});

const answer = <T>(result: Result<T>, status = 200): RestResponse =>
  result.ok ? { status, body: result.value ?? { ok: true } } : refused(result.error);

/** A CSV file to download, or the refusal. The body is the bytes, sent as they are. */
const csvFile = (result: Result<Uint8Array>, name: string): RestResponse =>
  result.ok
    ? {
        status: 200,
        body: result.value,
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${name}"`,
          'cache-control': 'private, no-store',
        },
      }
    : refused(result.error);

const pdfFile = (result: Result<SummaryFile>): RestResponse =>
  result.ok
    ? {
        status: 200,
        body: result.value.bytes,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${result.value.filename}"`,
          'cache-control': 'private, no-store',
        },
      }
    : refused(result.error);

/** The period and segment in a what-changed address. */
const periodAsk = (query: URLSearchParams): Result<PeriodAsk> =>
  parse(
    PeriodAsk,
    Object.fromEntries(
      ['period', 'from', 'to', 'segment'].flatMap((k) => {
        const v = query.get(k);
        return v === null || v === '' ? [] : [[k, v]];
      }),
    ),
  );

function body<T>(schema: z.ZodType<T>, raw: string): Result<T> {
  const value = json(raw);
  return value.ok ? parse(schema, value.value) : value;
}

const importStep = (input: z.infer<typeof ImportStepBody>) => ({
  uploadId: input.uploadId,
  ...(input.places === undefined ? {} : { places: placeChoices(input.places) }),
  ...(input.applySensitiveWithoutApproval === true ? { applySensitiveWithoutApproval: true } : {}),
  ...(input.mapping === undefined
    ? {}
    : {
        mapping: Object.fromEntries(
          Object.entries(input.mapping).map(([index, key]) => [Number(index), key]),
        ),
      }),
});

const KEY = '([a-z][a-z0-9_]{0,63})';
const NoSchedule = failure('NOT_FOUND', 'There is no such scheduled report');

export function screenRoutes(deps: ScreenRouteDeps, idempotency: IdempotencyStore): Route[] {
  const keys = { service: deps.service, idempotency };
  type Asking = Parameters<Route['handle']>[0];
  const done = (): Promise<RestResponse> => Promise.resolve({ status: 200, body: { ok: true } });
  /** A flagged-approvals use case (AI7, AI8), in the request's transaction. */
  const flagged = <T>(
    fn: (
      tx: Parameters<Parameters<typeof run>[2]>[0],
      pending: NonNullable<ScreenRouteDeps['service']['pending']>,
    ) => Promise<Result<T>>,
    asking: Asking,
  ): Promise<Result<T>> => {
    const { pending } = deps.service;
    if (!pending) {
      return Promise.resolve(err(failure('UNAVAILABLE', 'Approvals are not configured')));
    }
    return run(deps.service, asking.tenantId, (tx) => fn(tx, pending));
  };
  const bands = <T>(
    asking: Asking,
    fn: (
      b: NonNullable<ScreenRouteDeps['service']['payBands']>,
      tx: Parameters<Parameters<typeof run>[2]>[0],
    ) => Promise<Result<T>>,
  ): Promise<Result<T>> => {
    const { payBands } = deps.service;
    if (!payBands)
      return Promise.resolve(err(failure('UNAVAILABLE', 'Pay bands are not configured')));
    return run(deps.service, asking.tenantId, (tx) => fn(payBands, tx));
  };
  /**
   * A retried section save, answered as the first was (PEO-125): the same
   * findings, from the same function the save and the form's check answer
   * with — recomputed, not stored, so there is one code path.
   */
  const saved = async (
    asking: Asking,
    personId: string,
    changed: Readonly<Record<string, unknown>>,
  ): Promise<RestResponse> => {
    const found = await checkSection(deps, asking, personId, changed);
    return found.ok
      ? { status: 200, body: { ok: true, findings: found.value.findings } }
      : refused(found.error);
  };

  /**
   * A keyed write. `resource` names what it produced (the tenant when it is
   * nothing more particular); `again` answers a retry from what exists now.
   */
  const write =
    <T, R>(
      schema: z.ZodType<T>,
      act: (asking: Asking, input: T, id: string) => Promise<Result<R>>,
      options: {
        readonly status?: number;
        readonly resource?: (asking: Asking, id: string, value: R) => string;
        readonly again?: (asking: Asking, resourceId: string, input: T) => Promise<RestResponse>;
      } = {},
    ): Route['handle'] =>
    async (asking, request, params) => {
      const input = body(schema, request.body);
      if (!input.ok) return refused(input.error);
      const id = params['id'] ?? '';
      const status = options.status ?? 200;
      let first: RestResponse | undefined;
      return idempotent(
        keys,
        asking,
        request,
        status,
        async (tx) => {
          const result = await sharing({ tx, tenantId: asking.tenantId }, () =>
            act(asking, input.value, id),
          );
          if (!result.ok) return result;
          first = answer(result, status);
          return ok(options.resource?.(asking, id, result.value) ?? asking.tenantId);
        },
        (resourceId, replayed) =>
          !replayed && first !== undefined
            ? Promise.resolve(first)
            : (options.again ?? done)(asking, resourceId, input.value),
      );
    };

  /** A POST that only computes: no key, nothing to replay. */
  const compute =
    <T, R>(
      schema: z.ZodType<T>,
      act: (asking: Asking, input: T) => Promise<Result<R>>,
    ): Route['handle'] =>
    async (asking, request) => {
      const input = body(schema, request.body);
      if (!input.ok) return refused(input.error);
      return answer(await act(asking, input.value));
    };

  /** What changed: the screens' deps, with the model and the sending where they are configured. */
  const summaries: SummaryDeps = {
    ...deps,
    ...(deps.insightsPhraser === undefined ? {} : { phraser: deps.insightsPhraser }),
    ...(deps.insightsShares === undefined ? {} : { shares: deps.insightsShares }),
  };

  const version = async (asking: Asking): Promise<RestResponse> => {
    const current = await run(deps.service, asking.tenantId, async (tx) =>
      ok(await deps.service.schemas.current(tx, asking.tenantId)),
    );
    return answer(current.ok ? ok({ version: current.value?.version ?? null }) : current);
  };
  /** A scheduled-report use case in a tenant transaction, or UNAVAILABLE. */
  const scheduled = <R>(
    asking: Asking,
    act: (d: ScheduleAdminDeps, tx: PostgresJsDatabase) => Promise<Result<R>>,
  ): Promise<Result<R>> => {
    const d = deps.schedules;
    if (d === undefined) {
      return Promise.resolve(err(failure('UNAVAILABLE', 'Scheduled reports are not configured')));
    }
    return run(deps.service, asking.tenantId, (tx) => act(d, tx));
  };
  // A photo's upload needs the bucket and the upload ledger, and nothing else of import's.
  const photoDeps: PhotoDeps = { ...deps, newId: () => deps.commit.newId() };
  const fileDeps: FileDeps = { ...deps, newId: () => deps.commit.newId() };
  const newFields = newFieldsDeps(deps);
  const runs = deps.importRuns;
  const noRuns = () => err(failure('UNAVAILABLE', 'Imports cannot run here'));
  const runDeps = (store: RunStore) => ({
    ...deps,
    runs: store,
    sealed: deps.commit.reports.store,
    newId: deps.commit.newId,
  });
  const approve = write(
    ImportRunInput,
    (asking, input) =>
      runs === undefined ? Promise.resolve(noRuns()) : approveImport(runDeps(runs.store), asking, input),
    {
      status: 202,
      resource: (_asking, _id, approved) => approved.runId,
      // A retry of the same approval is that run, not a second one.
      again: (_asking, runId) =>
        Promise.resolve({ status: 202, body: { runId, status: 'queued' } }),
    },
  );
  // Search and export in words: no model configured means no budget to spend.
  const selection: SelectionDeps = {
    ...deps,
    ...(deps.selection?.planner === undefined ? {} : { selectionPlanner: deps.selection.planner }),
    searchBudget: deps.selection?.search ?? new PlanBudget(0, 3_600_000),
    exportBudget: deps.selection?.export ?? new PlanBudget(0, 3_600_000),
  };
  const endpoint = (_asking: Asking, resourceId: string) =>
    Promise.resolve<RestResponse>({ status: 200, body: { id: resourceId } });

  return [
    /* people */
    // Where People starts: the signed-in person, their line, what waits (overview).
    {
      method: 'GET',
      pattern: /^\/v1\/views\/overview$/,
      handle: async (asking) => answer(await overviewView(deps, asking)),
    },
    // A person's photo, to somebody who may read the person; base64 in JSON.
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/photos/${UUID}$`),
      handle: async (asking, _r, params) =>
        answer(await photoView(deps, asking, params['id'] ?? '')),
    },
    {
      // Where to put a photo: a presigned PUT, as an import's file (§14.2).
      // Unkeyed: a retry is a fresh upload, and the earlier one is let go.
      method: 'POST',
      pattern: /^\/v1\/views\/photos\/uploads$/,
      safe: true,
      handle: compute(PhotoStart, (asking, input) =>
        startPhotoUpload(photoDeps, asking, input.personId, input.size),
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/photos/uploads/${UUID}/complete$`),
      handle: write(
        PhotoOf,
        (asking, input, uploadId) =>
          completePhotoUpload(photoDeps, asking, input.personId, uploadId),
        {
          // A retry finds the upload let go; it is answered with the photo kept.
          again: async (asking, _resource, input) => {
            const answered = await run(deps.service, asking.tenantId, async (tx) => {
              const id =
                input.personId ??
                (await deps.personOf(tx, asking.tenantId, asking.viewer.accountId));
              const urls = await avatarsOf(deps, tx, asking.tenantId, id === null ? [] : [id]);
              return ok({ avatarUrl: id === null ? null : (urls.get(id) ?? null) });
            });
            return answer(answered);
          },
        },
      ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/photos\/remove$/,
      handle: write(PhotoOf, (asking, input) => removePhoto(photoDeps, asking, input.personId)),
    },
    // A question in words, answered as the asker (Slack, and anywhere else). A read.
    {
      method: 'POST',
      pattern: /^\/v1\/assistant\/ask$/,
      safe: true,
      handle: compute(AskBody, (asking, input) => ask(deps, asking, input.question, input.earlier)),
    },
    // Names and faces for the central activity log's ids (`?accounts=a,b&people=c`).
    {
      method: 'GET',
      pattern: /^\/v1\/views\/names$/,
      handle: async (asking, _r, _p, query) => {
        const ids = (key: string) =>
          (query.get(key) ?? '').split(',').filter((id) => new RegExp(`^${UUID}$`).test(id));
        return answer(
          await namesView(deps, asking, { accountIds: ids('accounts'), personIds: ids('people') }),
        );
      },
    },
    // A file for an image or document field, to somebody who may read that field.
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/files/${UUID}$`),
      handle: async (asking, _r, params) =>
        answer(await fileView(deps, asking, params['id'] ?? '')),
    },
    {
      // Where to put a field's file: a presigned PUT, as a photo's.
      method: 'POST',
      pattern: /^\/v1\/views\/files\/uploads$/,
      safe: true,
      handle: compute(FileStart, (asking, input) => startFileUpload(fileDeps, asking, input)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/files/uploads/${UUID}/complete$`),
      handle: write(FileOf, (asking, input, uploadId) =>
        completeFileUpload(fileDeps, asking, input, uploadId),
      ),
    },
    // Ask somebody for empty details of theirs: recorded, and they are emailed.
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/profile/${UUID}/requests$`),
      handle: write(DetailAsk, (asking, input, id) => requestDetails(deps, asking, id, input.keys)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/onboarding$/,
      handle: async (asking) => answer(await onboardingView(deps, asking)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/profile$/,
      handle: async (asking) => answer(await profileView(deps, asking, null)),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/profile/${UUID}$`),
      handle: async (asking, _r, params) =>
        answer(await profileView(deps, asking, params['id'] ?? '')),
    },
    // A record as of a date, and every change behind it (PEO-064).
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/history(?:/${UUID})?$`),
      handle: async (asking, _r, params, query) => {
        const q = parse(AsOfQuery, Object.fromEntries(query));
        if (!q.ok) return refused(q.error);
        return answer(await historyView(deps, asking, params['id'] ?? null, q.value.asOf ?? null));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/me\/sections$/,
      handle: write(
        Sections,
        async (asking, input) => {
          const own = await run(deps.service, asking.tenantId, (tx) =>
            personOfViewer(deps, tx, asking),
          );
          return own.ok ? saveSection(deps, asking, own.value, input.changed) : own;
        },
        {
          again: async (asking, _resource, input) => {
            const own = await run(deps.service, asking.tenantId, (tx) =>
              personOfViewer(deps, tx, asking),
            );
            return own.ok ? saved(asking, own.value, input.changed) : refused(own.error);
          },
        },
      ),
    },
    // What saving would be warned about, saving nothing (PEO-125).
    {
      method: 'POST',
      pattern: /^\/v1\/views\/me\/identifier-check$/,
      safe: true,
      handle: compute(Sections, async (asking, input) => {
        const own = await run(deps.service, asking.tenantId, (tx) =>
          personOfViewer(deps, tx, asking),
        );
        return own.ok ? checkSection(deps, asking, own.value, input.changed) : own;
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/people/${UUID}/identifier-check$`),
      safe: true,
      handle: async (asking, request, params) => {
        const input = body(Sections, request.body);
        if (!input.ok) return refused(input.error);
        return answer(await checkSection(deps, asking, params['id'] ?? '', input.value.changed));
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/identifier-reviews$/,
      handle: async (asking) => answer(await identifierReviewsView(deps, asking)),
    },
    // The approvals inbox (PEO-077).
    {
      method: 'GET',
      pattern: /^\/v1\/views\/approvals$/,
      handle: async (asking) => answer(await approvalsView(deps, asking)),
    },
    // Flagged approvals (design AI7, AI8): "Not unusual", a question and its
    // answer, and an administrator's switch per check. None decides anything.
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/pending-changes/${UUID}/not-unusual$`),
      handle: write(NoBody, (asking, _input, id) =>
        flagged((tx, pending) => markNotUnusual(tx, pending, { ...asking, changeId: id }), asking),
      { resource: (_asking, id) => id },
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/pending-changes/${UUID}/questions$`),
      handle: write(
        ApprovalQuestionBody,
        (asking, input, id) =>
          flagged(
            (tx, pending) =>
              askAboutChange(tx, pending, { ...asking, changeId: id, question: input.question }),
            asking,
          ),
        { status: 201, resource: (_asking, _id, question) => question.id },
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/approval-questions/${UUID}/answer$`),
      handle: write(
        ApprovalAnswerBody,
        (asking, input, id) =>
          flagged(
            (tx, pending) =>
              answerAboutChange(tx, pending, { ...asking, questionId: id, answer: input.answer }),
            asking,
          ),
        { resource: (_asking, id) => id },
      ),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/approval-checks/${KEY}$`),
      handle: write(
        ApprovalCheckBody,
        (asking, input, id) =>
          flagged((tx, pending) => setCheck(tx, pending, { ...asking, code: id, on: input.on }), asking),
        { resource: (_asking, id) => id },
      ),
    },
    // Suspected duplicates, and one pair side by side when `a` and `b` name it (PEO-074).
    {
      method: 'GET',
      pattern: /^\/v1\/views\/duplicates$/,
      handle: async (asking, _r, _p, query) => {
        const a = query.get('a');
        const b = query.get('b');
        const id = new RegExp(`^${UUID}$`);
        if ((a === null) !== (b === null) || (a !== null && (!id.test(a) || !id.test(b ?? '')))) {
          return refused(
            failure('BAD_REQUEST', 'a and b are two person ids, or neither', ['a', 'b']),
          );
        }
        return answer(await duplicatesView(deps, asking, a === null || b === null ? null : [a, b]));
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/views/people/${UUID}/sections$`),
      handle: write(Sections, (asking, input, id) => saveSection(deps, asking, id, input.changed), {
        resource: (_asking, id) => id,
        again: (asking, id, input) => saved(asking, id, input.changed),
      }),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/directory$/,
      handle: async (asking, _r, _p, query) => {
        const filter = query.get('filter') ?? undefined;
        if (
          filter !== undefined &&
          !/^[a-z][a-z0-9_]*:[^,]+(,[a-z][a-z0-9_]*:[^,]+)*$/.test(filter)
        ) {
          return refused(failure('BAD_REQUEST', 'filter is key:value pairs', ['filter']));
        }
        const after = query.get('after') ?? undefined;
        if (after !== undefined && !new RegExp(`^(${UUID}|@\\d{1,6})$`).test(after)) {
          return refused(failure('BAD_REQUEST', 'after is a person id or @offset', ['after']));
        }
        const segment = query.get('segment') ?? undefined;
        if (segment !== undefined && !new RegExp(`^${UUID}$`).test(segment)) {
          return refused(failure('BAD_REQUEST', 'segment is a segment id', ['segment']));
        }
        const refine = DirectoryRefine.safeParse({
          conditions: parseJson(query.get('conditions')),
          match: query.get('match') ?? undefined,
          sort: query.get('sort') ?? undefined,
        });
        if (!refine.success) {
          return refused(
            failure('BAD_REQUEST', 'conditions, match or sort is malformed', ['conditions']),
          );
        }
        return answer(
          await directoryView(deps, asking, {
            search: (query.get('search') ?? '').slice(0, 200),
            filters: filterIn(filter),
            // Sorted, the cursor is an offset (`@150`); otherwise a person id.
            after: after ?? query.get('offset') ?? null,
            ...refine.data,
            ...(segment === undefined ? {} : { segmentId: segment }),
            ...(query.get('incomplete') === 'true' ? { incomplete: true } : {}),
          }),
        );
      },
    },
    // The directory as a tree: everybody, with their manager, in one read.
    {
      method: 'GET',
      pattern: /^\/v1\/views\/org-chart$/,
      handle: async (asking) => answer(await orgChartView(deps, asking)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/completeness$/,
      handle: async (asking, _r, _p, query) => {
        const after = query.get('after') ?? undefined;
        if (after !== undefined && !new RegExp(`^${UUID}$`).test(after)) {
          return refused(failure('BAD_REQUEST', 'after is a person id', ['after']));
        }
        return answer(await completenessView(deps, asking, { after: after ?? null }));
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/people-picker$/,
      handle: async (asking, _r, _p, query) => {
        const after = query.get('after') ?? undefined;
        if (after !== undefined && !new RegExp(`^${UUID}$`).test(after)) {
          return refused(failure('BAD_REQUEST', 'after is a person id', ['after']));
        }
        return answer(
          await pickerView(deps, asking, {
            search: (query.get('search') ?? '').slice(0, 200),
            after: after ?? null,
          }),
        );
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/completeness$/,
      handle: write(Grid, (asking, input) => saveGrid(deps, asking, input.changes), {
        // A retry answers with the same cell warnings, from the grid's own check.
        again: async (asking, _resource, input) => {
          const found = await checkGrid(deps, asking, input.changes);
          return found.ok
            ? { status: 200, body: { ok: true, findings: found.value.findings } }
            : refused(found.error);
        },
      }),
    },
    // "Remind N people": the weekly sweep, now, for this tenant (V4).
    {
      method: 'POST',
      pattern: /^\/v1\/views\/completeness\/remind$/,
      handle: write(NoBody, (asking) => remindWaiting(deps, asking)),
    },
    // How many people this viewer could search (MV1): a count only.
    {
      method: 'GET',
      pattern: /^\/v1\/views\/headcount$/,
      handle: async (asking) => answer(await peopleHeadcount(deps, asking)),
    },
    // What saving these cells would be warned about, saving nothing (PEO-125).
    {
      method: 'POST',
      pattern: /^\/v1\/views\/completeness\/identifier-check$/,
      safe: true,
      handle: compute(Grid, (asking, input) => checkGrid(deps, asking, input.changes)),
    },

    /* bulk edit (PEO-071): the screen, the preview that keeps nothing, the commit */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/bulk-edit$/,
      handle: async (asking, _r, _p, query) => {
        const ids = (query.get('people') ?? '').split(',').filter((id) => id !== '');
        if (!ids.every((id) => new RegExp(`^${UUID}$`).test(id))) {
          return refused(
            failure('BAD_REQUEST', 'people is person ids, comma-separated', ['people']),
          );
        }
        return answer(await bulkEditView(deps, asking, ids));
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/bulk-edit\/preview$/,
      safe: true,
      handle: compute(BulkEditBody, (asking, input) => bulkEdit(deps, asking, input, 'preview')),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/bulk-edit$/,
      handle: write(BulkEditBody, (asking, input) => bulkEdit(deps, asking, input, 'commit'), {
        // A retry is answered from what stands now: what the first request
        // wrote reads as unchanged, and nothing is written twice.
        again: async (asking, _resource, input) =>
          answer(await bulkEdit(deps, asking, input, 'preview')),
      }),
    },
    /* bulk hire: provisional people hired from a start date, the same shape */
    {
      method: 'POST',
      pattern: /^\/v1\/views\/bulk-hire\/preview$/,
      safe: true,
      handle: compute(BulkHireBody, (asking, input) => bulkHire(deps, asking, input, 'preview')),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/bulk-hire$/,
      // A retry is answered with the first request's answer, kept with the
      // key: recomputed, those it hired would read as already employed.
      handle: async (asking, request) => {
        const input = body(BulkHireBody, request.body);
        if (!input.ok) return refused(input.error);
        let first: RestResponse | undefined;
        return idempotent(
          keys,
          asking,
          request,
          200,
          async (tx) => {
            const done = await sharing({ tx, tenantId: asking.tenantId }, () =>
              bulkHire(deps, asking, input.value, 'commit'),
            );
            if (!done.ok) return done;
            first = answer(done);
            const id = randomUUID();
            await idempotency.keep(tx, asking.tenantId, id, keptRows(done.value));
            return ok(id);
          },
          async (id, again) => {
            if (!again && first !== undefined) return first;
            const kept = await run(deps.service, asking.tenantId, async (tx) =>
              ok(await idempotency.kept(tx, asking.tenantId, id)),
            );
            if (!kept.ok) return refused(kept.error);
            if (!Array.isArray(kept.value)) {
              return refused(failure('NOT_FOUND', 'The first answer to this key is gone'));
            }
            return answer(await replayed(deps, asking, kept.value as KeptRow[]));
          },
        );
      },
    },

    /* roles (PEO-112): the view here, the writes at /v1/roles/* */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/roles$/,
      handle: async (asking) => answer(await rolesView(deps, asking)),
    },

    /* the registry and setup */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/registry$/,
      handle: async (asking) => answer(await registryView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/sections$/,
      handle: write(Label, (asking, input) => addSection(deps, asking, input.label), {
        status: 201,
      }),
    },
    {
      method: 'PUT',
      pattern: /^\/v1\/schema\/draft\/sections\/order$/,
      handle: write(Order, (asking, input) => reorderSections(deps, asking, input.order)),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/schema/draft/sections/${KEY}/order$`),
      handle: write(Order, (asking, input, key) => reorderFields(deps, asking, key, input.order)),
    },
    {
      // A field shared with the assistant, or not.
      method: 'POST',
      pattern: new RegExp(`^/v1/schema/draft/attributes/${KEY}/assistant$`),
      handle: write(AssistantShareBody, (asking, input, key) =>
        setFieldAssistant(deps, asking, key, input.share),
      ),
    },
    {
      // A field on the sign-up flow, optional or required, or off it.
      method: 'POST',
      pattern: new RegExp(`^/v1/schema/draft/attributes/${KEY}/signup$`),
      handle: write(SignupAskBody, (asking, input, key) =>
        setFieldSignup(deps, asking, key, input.ask),
      ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/attributes$/,
      handle: write(Field, (asking, input) => saveField(deps, asking, input.input, input.editing)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/advice$/,
      safe: true,
      handle: compute(Advice, (_asking, input) => Promise.resolve(ok(adviseClassification(input)))),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/preview$/,
      safe: true,
      handle: compute(RequiredFrom, (asking, input) =>
        previewPublish(deps, asking, input.requiredFrom, async (tx) => {
          const since = new Date(0);
          return (await deps.listEndpoints(tx, asking.tenantId, since)).endpoints.filter(
            (e) => e.enabled && e.events.includes('people.schema.published'),
          ).length;
        }),
      ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/schema\/draft\/publish$/,
      handle: write(
        RequiredFrom,
        (asking, input) => publishDraft(deps, asking, input.requiredFrom),
        { status: 201, again: version },
      ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/setup$/,
      handle: async (asking) => answer(await setupView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/setup\/entity$/,
      handle: write(Entity, (asking, input) => confirmEntity(deps, asking, input)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/setup\/publish$/,
      handle: write(SetupChoice, (asking, input) => publishSetup(deps, asking, input), {
        status: 201,
        again: version,
      }),
    },

    /* integrations */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/integrations$/,
      handle: async (asking) => answer(await integrationsView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/webhooks\/endpoints$/,
      handle: write(EndpointBody, (asking, input) => createEndpoint(deps, asking, input), {
        status: 201,
        resource: (_asking, _id, made) => made.id,
        again: endpoint,
      }),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}$`),
      handle: write(
        EndpointPatch,
        (asking, input, id) =>
          updateEndpoint(
            deps,
            asking,
            id,
            Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
          ),
        { resource: (_asking, id) => id, again: endpoint },
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}/rotate$`),
      handle: write(NoBody, (asking, _input, id) => rotateEndpoint(deps, asking, id), {
        resource: (_asking, id) => id,
        again: endpoint,
      }),
    },
    // Chat apps (Slack today): connecting one, and which notices go there.
    {
      method: 'GET',
      pattern: /^\/v1\/views\/chat$/,
      handle: async (asking) => answer(await chatView(deps, asking)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/chat/apps/${KEY}/connect$`),
      safe: true,
      handle: async (asking, request, params) => {
        const input = body(ChatConnect, request.body);
        if (!input.ok) return refused(input.error);
        return answer(await connectChat(deps, asking, params['id'] ?? '', input.value.origin));
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/chat/apps/${KEY}/complete$`),
      handle: write(ChatComplete, (asking, input, id) => completeChat(deps, asking, id, input), {
        resource: (_asking, id) => id,
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/chat/apps/${KEY}/disconnect$`),
      handle: write(NoBody, (asking, _input, id) => disconnectChat(deps, asking, id), {
        resource: (_asking, id) => id,
      }),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/chat/notices/${KEY}$`),
      handle: write(ChatNotice, (asking, input, id) => setChatNotice(deps, asking, id, input.on), {
        resource: (_asking, id) => id,
      }),
    },
    // SCIM connections (PEO-072, PEO-073): people_admin's, audited by event.
    {
      method: 'POST',
      pattern: /^\/v1\/scim\/connections$/,
      handle: write(
        ScimConnectionBody,
        (asking, input) => createScimConnection(deps, asking, input.system),
        {
          status: 201,
          resource: (_asking, _id, made) => made.id,
          again: (_asking, id) => Promise.resolve({ status: 201, body: { id } }),
        },
      ),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/scim/connections/${UUID}/rotate$`),
      handle: write(NoBody, (asking, _input, id) => rotateScimToken(deps, asking, id), {
        resource: (_asking, id) => id,
        again: endpoint,
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/scim/connections/${UUID}/revoke$`),
      handle: write(NoBody, (asking, _input, id) => revokeScimConnection(deps, asking, id), {
        resource: (_asking, id) => id,
      }),
    },
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/scim/connections/${UUID}/mapping$`),
      handle: write(
        ScimMappingBody,
        (asking, input, id) => setScimMapping(deps, asking, id, input.mapping),
        {
          resource: (_asking, id) => id,
        },
      ),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/webhooks/endpoints/${UUID}/deliveries$`),
      handle: async (asking, _request, params, query) =>
        answer(await deliveriesView(deps, asking, params['id'] ?? '', query.get('after'))),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/webhooks/deliveries/${UUID}/replay$`),
      handle: write(
        NoBody,
        async (asking, _input, id) => {
          const replayed = await replayDelivery(deps, asking, id);
          return replayed.ok ? ok({ deliveryId: replayed.value }) : replayed;
        },
        {
          status: 201,
          resource: (_asking, _id, made) => made.deliveryId,
          again: (_asking, deliveryId) => Promise.resolve({ status: 201, body: { deliveryId } }),
        },
      ),
    },

    /* import */
    {
      // Where to put the file: a presigned PUT, straight to storage (§14.2).
      // Unkeyed: a retry is a fresh upload, and the earlier one is let go.
      method: 'POST',
      pattern: /^\/v1\/imports\/uploads$/,
      safe: true,
      handle: compute(UploadStart, (asking, input) => startImportUpload(deps, asking, input)),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/v1/imports/uploads/${UUID}/complete$`),
      safe: true,
      handle: async (asking, _request, params) =>
        answer(await completeImportUpload(deps, asking, params['id'] ?? '')),
    },
    /* new information in an import's file (docs/ai-settings.md) */
    {
      // Fields proposed for the columns that match none. Nothing is written.
      method: 'POST',
      pattern: /^\/v1\/imports\/new-fields$/,
      safe: true,
      handle: compute(ImportStepInput, (asking, input) =>
        proposeNewFields(newFields, asking, input),
      ),
    },
    {
      // Everything the import will do, from HR's choices, over a dry run. Nothing is written.
      method: 'POST',
      pattern: /^\/v1\/imports\/plan$/,
      safe: true,
      handle: compute(ImportPlanInput, (asking, input) => planImport(newFields, asking, input)),
    },
    {
      // Approve and run: setup if nothing is published, the fields, the defaults, the import.
      method: 'POST',
      pattern: /^\/v1\/imports\/run$/,
      // Checked now, run in the background: the run's id at once, its worker after the commit.
      handle: async (asking, request, params, query) => {
        const answered = await approve(asking, request, params, query);
        const runId = (answered.body as { runId?: unknown } | null)?.runId;
        if (answered.status < 300 && typeof runId === 'string' && runs !== undefined) {
          // Approved either way: a worker that cannot be started now is
          // started by the next pick-up (`startImportRuns`).
          await runs.kick(asking.tenantId, runId).catch((cause: unknown) => {
            logger.warn({ err: cause, runId }, 'import run not started yet');
          });
        }
        return answered;
      },
    },
    {
      // The company's run going now, or null: Import & export and the Directory say so.
      method: 'GET',
      pattern: /^\/v1\/imports\/runs\/active$/,
      handle: async (asking) => {
        const going =
          runs === undefined ? ok(null) : await activeImportRunView(runDeps(runs.store), asking);
        // Wrapped: a body of null is no answer.
        return answer(going.ok ? ok({ run: going.value }) : going);
      },
    },
    {
      // One run, as its page shows it while it goes and once it is over.
      method: 'GET',
      pattern: new RegExp(`^/v1/imports/runs/${UUID}$`),
      handle: async (asking, _request, params) =>
        answer(
          runs === undefined
            ? noRuns()
            : await importRunView(runDeps(runs.store), asking, params['id'] ?? ''),
        ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/imports\/dry-run$/,
      safe: true,
      handle: compute(ImportStepBody, (asking, input) =>
        dryRunImport(deps, asking, importStep(input)),
      ),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/imports$/,
      handle: write(
        ImportStepBody,
        (asking, input) => commitImportView(deps, asking, importStep(input)),
        {
          status: 201,
          // The report is not kept (PEO-090), so a retry is told it went through.
          again: () =>
            Promise.resolve(
              refused(
                failure(
                  'ALREADY_IMPORTED',
                  'This import went through on the first request with this key',
                ),
              ),
            ),
        },
      ),
    },

    // The template (V6): a header row of what this viewer may import, by label.
    {
      method: 'GET',
      pattern: /^\/v1\/imports\/template$/,
      handle: async (asking) =>
        csvFile(await importTemplateFile(deps, asking), 'people-import-template.csv'),
    },
    // Import & export's one history (V6): both ledgers, newest first, 50 at a time.
    {
      method: 'GET',
      pattern: /^\/v1\/views\/transfers$/,
      handle: async (asking, _r, _p, query) => {
        const before = query.get('before');
        if (before !== null && !new RegExp(`^${UUID}$`).test(before)) {
          return refused(failure('BAD_REQUEST', 'before is an entry id', ['before']));
        }
        return answer(
          await transferHistoryView(
            { ...deps, reports: deps.commit.reports.store },
            asking,
            before,
          ),
        );
      },
    },

    /* export and analytics */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/export$/,
      handle: async (asking, _r, _p, query) => {
        // The directory's conditions, offered as one more audience.
        const refine = DirectoryRefine.safeParse({
          conditions: parseJson(query.get('conditions')),
          match: query.get('match') ?? undefined,
        });
        if (!refine.success) {
          return refused(
            failure('BAD_REQUEST', 'conditions or match is malformed', ['conditions']),
          );
        }
        const { conditions = [], match = 'all' } = refine.data;
        return answer(
          await exportViewWith(
            deps,
            asking,
            conditions.length === 0 ? undefined : { conditions, match },
          ),
        );
      },
    },
    /* search and export in words (docs/ai-settings.md): a plan, never a write */
    {
      method: 'POST',
      pattern: /^\/v1\/views\/directory\/plan$/,
      safe: true,
      handle: compute(DirectoryAsk, (asking, input) => planDirectory(selection, asking, input)),
    },
    // Smart search's "Remind all": everybody a search found missing a detail is asked for it.
    {
      method: 'POST',
      pattern: /^\/v1\/views\/directory\/remind$/,
      handle: write(DirectoryRemind, (asking, input) => remindDirectory(selection, asking, input)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/export\/plan$/,
      safe: true,
      handle: compute(PlanAsk, (asking, input) => planExport(selection, asking, input)),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/analytics$/,
      handle: async (asking, _r, _p, query) => {
        const segment = query.get('segment') ?? undefined;
        if (segment !== undefined && !new RegExp(`^${UUID}$`).test(segment)) {
          return refused(failure('BAD_REQUEST', 'segment is a segment id', ['segment']));
        }
        return answer(
          await analyticsView(deps, asking, segment === undefined ? {} : { segmentId: segment }),
        );
      },
    },
    /* what changed (design AI5, AI6, MA4, MA5): its own block */
    {
      method: 'GET',
      pattern: /^\/v1\/views\/analytics\/what-changed$/,
      handle: async (asking, _r, _p, query) => {
        const ask = periodAsk(query);
        return answer(ask.ok ? await whatChangedView(summaries, asking, ask.value) : ask);
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/analytics\/what-changed\/worded$/,
      handle: async (asking, _r, _p, query) => {
        const ask = periodAsk(query);
        return answer(ask.ok ? await wordedPoints(summaries, asking, ask.value) : ask);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/analytics\/what-changed\/ask$/,
      safe: true,
      handle: compute(FollowUpAsk, (asking, input) => followUp(summaries, asking, input)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/analytics\/what-changed\/summary$/,
      safe: true,
      handle: compute(SummaryAsk, (asking, input) => summaryDraft(summaries, asking, input)),
    },
    {
      method: 'POST',
      pattern: /^\/v1\/views\/analytics\/what-changed\/summary\/pdf$/,
      safe: true,
      handle: async (asking, request) => {
        const input = body(SummaryAsk, request.body);
        return pdfFile(input.ok ? await summaryFile(summaries, asking, input.value) : input);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/insights\/summaries$/,
      handle: async (asking, request, params, query) => {
        const stored = await write(ShareAsk, (a, input) => storeSummary(summaries, a, input), {
          resource: (_a, _id, value) => value.id,
          again: (_a, id) => Promise.resolve(answer(ok({ id }))),
        })(asking, request, params, query);
        if (stored.status !== 200) return stored;
        // After the commit: the email says a summary waits, and one does.
        const { id } = stored.body as { id: string };
        return { ...stored, body: { id, emailed: await announceSummary(summaries, asking, id) } };
      },
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/insights/summaries/${UUID}$`),
      handle: async (asking, _r, params) =>
        answer(await sharedSummary(summaries, asking, params['id'] ?? '')),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/insights/summaries/${UUID}/pdf$`),
      handle: async (asking, _r, params) =>
        pdfFile(await sharedSummaryFile(summaries, asking, params['id'] ?? '')),
    },
    // One Insights tab's numbers as CSV (V7, "Export"): the view above, as rows.
    {
      method: 'GET',
      pattern: /^\/v1\/views\/analytics\/export$/,
      handle: async (asking, _r, _p, query) => {
        const tab = query.get('tab') ?? 'headcount';
        const segment = query.get('segment') ?? undefined;
        if (!(INSIGHTS_TABS as readonly string[]).includes(tab)) {
          return refused(
            failure('BAD_REQUEST', `tab is one of ${INSIGHTS_TABS.join(', ')}`, ['tab']),
          );
        }
        if (segment !== undefined && !new RegExp(`^${UUID}$`).test(segment)) {
          return refused(failure('BAD_REQUEST', 'segment is a segment id', ['segment']));
        }
        const view = await analyticsView(
          deps,
          asking,
          segment === undefined ? {} : { segmentId: segment },
        );
        return csvFile(
          view.ok ? ok(writeCsv(analyticsExport(view.value, tab as InsightsTab))) : view,
          `insights-${tab}-${view.ok ? view.value.asOf : 'today'}.csv`,
        );
      },
    },

    /* pay bands (PEO-078): HR or finance, decided by `payBands` */
    {
      method: 'GET',
      pattern: /^\/v1\/pay-bands$/,
      handle: async (asking) => {
        const listed = await bands(asking, (b, tx) => b.list(tx, asking));
        return answer(listed.ok ? ok({ items: listed.value }) : listed);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/pay-bands$/,
      handle: write(
        PayBandBody,
        (asking, input) => bands(asking, (b, tx) => b.set(tx, asking, input)),
        {
          status: 201,
          resource: (_asking, _id, made: PayBandView) => made.id,
          again: async (asking, id) => {
            const listed = await bands(asking, (b, tx) => b.list(tx, asking));
            const made = listed.ok ? listed.value.find((band) => band.id === id) : undefined;
            return made === undefined
              ? refused(failure('NOT_FOUND', 'There is no such pay band'))
              : { status: 201, body: made };
          },
        },
      ),
    },

    /* scheduled reports (PEO-069) */
    {
      method: 'GET',
      pattern: /^\/v1\/report-schedules$/,
      handle: async (asking) => {
        const listed = await scheduled(asking, (d, tx) => listSchedules(d, tx, asking));
        return answer(listed.ok ? ok({ items: listed.value }) : listed);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/report-schedules$/,
      handle: write(
        ScheduleBody,
        (asking, input) => scheduled(asking, (d, tx) => createSchedule(d, tx, asking, input)),
        {
          status: 201,
          resource: (_asking, _id, made) => made.id,
          again: async (asking, id) => {
            const listed = await scheduled(asking, (d, tx) => listSchedules(d, tx, asking));
            const made = listed.ok ? listed.value.find((s) => s.id === id) : undefined;
            return made === undefined ? refused(NoSchedule) : { status: 201, body: made };
          },
        },
      ),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/report-schedules/${UUID}/runs$`),
      handle: async (asking, _r, params) => {
        const runs = await scheduled(asking, (d, tx) =>
          scheduleRuns(d, tx, asking, params['id'] ?? ''),
        );
        return answer(runs.ok ? ok({ items: runs.value }) : runs);
      },
    },
    ...(['pause', 'resume'] as const).map((action) => ({
      method: 'POST',
      pattern: new RegExp(`^/v1/report-schedules/${UUID}/${action}$`),
      handle: write(
        NoBody,
        (asking, _input, id) =>
          scheduled(asking, (d, tx) => setPaused(d, tx, asking, id, action === 'pause')),
        { resource: (_asking, id) => id },
      ),
    })),
    {
      method: 'PUT',
      pattern: new RegExp(`^/v1/report-schedules/${UUID}$`),
      handle: write(
        ScheduleBody,
        (asking, input, id) =>
          scheduled(asking, (d, tx) => updateSchedule(d, tx, asking, id, input)),
        { resource: (_asking, id) => id },
      ),
    },
    {
      method: 'GET',
      pattern: /^\/v1\/views\/report-schedules$/,
      handle: async (asking) => answer(await reportSchedulesView(deps, asking)),
    },
    {
      method: 'GET',
      pattern: new RegExp(`^/v1/views/report-schedules/${UUID}$`),
      handle: async (asking, _r, params) =>
        answer(await reportRunsView(deps, asking, params['id'] ?? '')),
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/v1/report-schedules/${UUID}$`),
      handle: write(
        NoBody,
        (asking, _input, id) => scheduled(asking, (d, tx) => deleteSchedule(d, tx, asking, id)),
        { resource: (_asking, id) => id },
      ),
    },

    /* saved segments (PEO-068) */
    {
      method: 'GET',
      pattern: /^\/v1\/segments$/,
      handle: async (asking) => {
        const listed = await segmentsView(deps, asking);
        return answer(listed.ok ? ok({ items: listed.value }) : listed);
      },
    },
    {
      method: 'POST',
      pattern: /^\/v1\/segments$/,
      handle: write(SegmentBody, (asking, input) => saveSegment(deps, asking, input), {
        status: 201,
        resource: (_asking, _id, made) => made.id,
        again: async (asking, id) => {
          const listed = await segmentsView(deps, asking);
          const made = listed.ok ? listed.value.find((s) => s.id === id) : undefined;
          return made === undefined
            ? refused(failure('NOT_FOUND', 'There is no such segment'))
            : { status: 201, body: made };
        },
      }),
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/v1/segments/${UUID}$`),
      handle: write(NoBody, (asking, _input, id) => deleteSegment(deps, asking, id), {
        resource: (_asking, id) => id,
      }),
    },
  ];
}

/** How big a request body may be. No file comes this way: an import's goes to storage (§14.2). */
export const BODY_LIMIT = 256 * 1024;

/** The directory's conditions, match and sort, as the query string carries them. */
const DirectoryRefine = z
  .object({
    conditions: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
          op: z.enum([
            'is',
            'in',
            'contains',
            'before',
            'after',
            'between',
            'empty',
            'not_empty',
            'under',
          ]),
          values: z.array(z.string().max(200)).max(50).default([]),
        }),
      )
      .max(20)
      .optional(),
    match: z.enum(['all', 'any']).optional(),
    // `key:asc` or `key:desc`.
    sort: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,62}:(asc|desc)$/)
      .transform((v) => {
        const [key = '', direction] = v.split(':');
        return { key, direction: direction === 'desc' ? ('desc' as const) : ('asc' as const) };
      })
      .optional(),
  })
  .transform((v) => ({
    ...(v.conditions === undefined ? {} : { conditions: v.conditions }),
    ...(v.match === undefined ? {} : { match: v.match }),
    ...(v.sort === undefined ? {} : { sort: v.sort }),
  }));

function parseJson(text: string | null): unknown {
  if (text === null || text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return 'malformed';
  }
}
