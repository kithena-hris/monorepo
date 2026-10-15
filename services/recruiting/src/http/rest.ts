import { createHash } from 'node:crypto';
import { presentsInternalToken } from '@kithena/auth-kit';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  ConditionKind,
  Instant,
  InboxAnswer,
  PrehireCancelReason,
  PublicationTarget,
  Rating,
  Recommendation,
  TenantId,
  WorkMode,
} from '@kithena/contracts';

import { overview, offerAcceptance, chart, speed, timeInStage } from '../application/analytics.js';
import {
  contextOf,
  deliver,
  PUBLIC_ACCOUNT,
  recruiterOnly,
  type Ctx,
  type Outgoing,
} from '../application/context.js';
import {
  addCandidate,
  apply,
  applyInternally,
  refer,
  requestCode,
  type IncomingFile,
} from '../application/intake.js';
import {
  answerReference,
  bookByLink,
  debriefOf,
  decide,
  kit,
  linkSlots,
  nameReferee,
  requestReference,
  saveScorecard,
  scheduleInterview,
  saveWorkingHours,
  myWorkingHours,
  selfScheduleLink,
  setInterviewState,
  scheduleScreen,
} from '../application/interviews.js';
import {
  createJob,
  moveJobState,
  publishTo,
  saveAd,
  saveForm,
  saveJobDetails,
  setCriteria,
  setPlan,
  setStages,
  setTeam,
  unpublish,
} from '../application/jobs.js';
import {
  addToPool,
  agreeToPool,
  bulk,
  correctMove,
  moveApplication,
  rejectApplication,
  sendMessage,
  undoMove,
  withdrawApplication,
  withdrawPoolConsent,
} from '../application/moves.js';
import {
  cancelThePrehire,
  candidateAccepts,
  candidateDeclines,
  composeOffer,
  decideOffer,
  decidePrehireCondition,
  offerForCandidate,
  presentToWorksCouncil,
  sendTheOffer,
  submitOfferForApproval,
  uploadSignedContract,
  withdrawTheOffer,
  worksCouncilDecides,
} from '../application/offers.js';
import {
  anonymise,
  candidateByToken,
  candidatePage,
  exportCandidate,
  placeHold,
} from '../application/privacy.js';
import {
  cancelRequisition,
  decideRequisition,
  saveRequisition,
  submitRequisition,
} from '../application/requisitions.js';
import {
  boardScreen,
  candidateScreen,
  candidatesScreen,
  home,
  interviewsScreen,
  jobScreen,
  offerScreen,
  offersScreen,
  pipelineScreen,
  poolsScreen,
  recruitingInbox,
  requisitionsScreen,
  settingsScreen,
} from '../application/screens.js';
import {
  saveBenefit,
  saveChain,
  saveEntity,
  saveGeneralSettings,
  saveLocation,
  savePayBand,
  savePipeline,
  saveQuestionnaire,
  saveScorecardTemplate,
  saveTemplate,
  recordWorksCouncilConsent,
} from '../application/setup.js';
import {
  agencyPortal,
  openAgencySession,
  requestAgencyCode,
  submitAsAgency,
} from '../application/agency-portal.js';
import { confirmAlert, stopAlert, subscribeAlert } from '../application/alerts.js';
import { agreeWithFinding, assessMatrix, jobNotices, rediscover } from '../application/matrix.js';
import { summariseDebrief } from '../application/debrief-summary.js';
import { askAboutJob, askRecruiter } from '../application/job-assistant.js';
import { askForChart } from '../application/chart-ask.js';
import { SelfId, fairness, saveSelfId, selfIdQuestions } from '../application/fairness.js';
import { importMembers } from '../application/members.js';
import {
  refreshAssessment,
  refreshBackgroundCheck,
  sendAssessment,
  startBackgroundCheck,
} from '../application/providers.js';
import {
  draftAd,
  draftEmail,
  explainPhrase,
  suggestQuestions,
  translateAd,
} from '../application/writer.js';
import {
  confirmParsedProfile,
  myParsedProfile,
  parseCv,
  parsedProfile,
} from '../application/parser.js';
import { receiveReply } from '../application/replies.js';
import type { Caller, Deps, UnitOfWork } from '../application/ports.js';
import type { CallerFrom } from './caller.js';
import { allowed } from './limits.js';

/**
 * REST v1 for Recruiting (PRD §32, REC-061): `/v1/recruiting/...`.
 *
 * Documents' design, copied: one route table serves REST, the OpenAPI
 * document and the subgraph; every write carries `Idempotency-Key`, saved
 * with its answer in the write's own transaction; no route decides who may
 * do anything — the application layer does.
 *
 * The public routes (`/v1/recruiting/public/{company}/...`, PRD §32) are the
 * headless API Kithena Jobs and a company's own site call: no account, the
 * company named by its slug, a candidate by their page's token in
 * `X-Candidate-Token`.
 */

export interface RestRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

export interface RestResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export interface RestDeps {
  readonly deps: Deps;
  readonly callerFrom: CallerFrom;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Route {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly params: z.ZodObject;
  readonly body: z.ZodType | null;
  readonly answer: z.ZodType;
  readonly status: number;
  readonly graphql: boolean;
  readonly public: boolean;
  readonly run: (
    ctx: Ctx,
    input: {
      readonly params: unknown;
      readonly body: unknown;
      readonly headers: RestRequest['headers'];
    },
  ) => Promise<Result<unknown>>;
}

const NoParams = z.object({});
/** A screen's read model: JSON, shaped as `application/screens.ts` builds it. */
const Json = z.unknown();
const Done = z.object({ ok: z.literal(true) });
const done = <T>(r: Result<T>): Result<{ ok: true }> => (r.ok ? ok({ ok: true }) : r);

function route<P extends z.ZodObject, B extends z.ZodType | null>(def: {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly params?: P;
  readonly body?: B;
  readonly answer?: z.ZodType;
  readonly status?: number;
  readonly public?: true;
  readonly run: (
    ctx: Ctx,
    input: {
      readonly params: z.output<P>;
      readonly body: B extends z.ZodType ? z.output<B> : undefined;
      readonly headers: RestRequest['headers'];
    },
  ) => Promise<Result<unknown>>;
}): Route {
  return {
    name: def.name,
    method: def.method,
    path: def.path,
    summary: def.summary,
    params: def.params ?? NoParams,
    body: def.body ?? null,
    answer: def.answer ?? Json,
    status: def.status ?? 200,
    graphql: def.public !== true,
    public: def.public === true,
    run: def.run as Route['run'],
  };
}

const V1 = '/v1/recruiting';
const Id = z.uuid();
const File = z.object({
  field: z.string().max(60),
  fileName: z.string().min(1).max(200),
  mediaType: z.string().max(120),
  /** Base64; the bytes are checked against 10 MB in Recruiting. */
  base64: z.string().max(14_000_000),
});
const files = (list: readonly z.infer<typeof File>[] | undefined): IncomingFile[] =>
  (list ?? []).map((f) => ({
    field: f.field,
    fileName: f.fileName,
    mediaType: f.mediaType,
    bytes: new Uint8Array(Buffer.from(f.base64, 'base64')),
  }));
const text = (max: number) => z.string().max(max);

const Stage = z.object({
  id: Id,
  name: z.string().min(1).max(60),
  candidateName: z.string().max(60).nullable(),
  category: z.enum([
    'applied',
    'screening',
    'interview',
    'assessment',
    'works_council',
    'offer',
    'hired',
  ]),
  automations: z.array(z.record(z.string(), z.unknown())).max(10),
});
const TermLength = z.object({
  count: z.int().nonnegative(),
  unit: z.enum(['days', 'weeks', 'months']),
});
const Terms = z.object({
  region: z.string().max(10).nullable().optional(),
  relationship: z.enum(['employee', 'worker', 'contractor']).optional(),
  contractType: z.string().max(60).optional(),
  fixedTermReason: z.string().max(60).nullable().optional(),
  previouslyEmployed: z.boolean().optional(),
  contractEnd: CalendarDate.nullable().optional(),
  weeklyMinutes: z.int().positive().max(10_080).optional(),
  probation: TermLength.nullable().optional(),
  noticeEmployee: TermLength.optional(),
  noticeEmployer: TermLength.optional(),
  workMode: WorkMode.optional(),
  hybridDaysOnsite: z.int().min(1).max(5).nullable().optional(),
  remoteCountry: z.string().length(2).nullable().optional(),
  remoteKind: z.enum(['mobile', 'telearbeit']).nullable().optional(),
  agreement: z
    .object({ key: z.string().max(60), group: z.string().max(60).nullable() })
    .nullable()
    .optional(),
  annualPayMinor: z.int().nonnegative().optional(),
  paymentsPerYear: z.int().min(12).max(14).optional(),
  exempt: z.boolean().nullable().optional(),
  roleGroup: z.enum(['qualified', 'other']).nullable().optional(),
  benefitIds: z.array(z.string().max(80)).optional(),
  nonCompeteMonths: z.int().min(0).max(36).nullable().optional(),
  nonCompeteCompensationPercent: z.int().min(0).max(100).nullable().optional(),
  mobilityClause: z.boolean().optional(),
});

export const ROUTES: readonly Route[] = [
  /* ------------------------------------------------------------ screens -- */
  route({
    name: 'recruitingHome',
    method: 'GET',
    path: `${V1}/home`,
    summary: 'R1: my tasks and my jobs',
    run: async (ctx) => ok(await home(ctx)),
  }),
  route({
    name: 'recruitingRequisitions',
    method: 'GET',
    path: `${V1}/requisitions`,
    summary: 'R2: requisitions',
    run: async (ctx) => ok(await requisitionsScreen(ctx)),
  }),
  route({
    name: 'recruitingJob',
    method: 'GET',
    path: `${V1}/jobs/{jobId}`,
    summary: 'R4–R7, R14: a job’s setup',
    params: z.object({ jobId: Id }),
    run: (ctx, { params }) => jobScreen(ctx, params.jobId),
  }),
  route({
    name: 'recruitingPipeline',
    method: 'GET',
    path: `${V1}/jobs/{jobId}/pipeline`,
    summary: 'R10: a job’s pipeline, filtered in the URL',
    params: z.object({
      jobId: Id,
      q: text(200).optional(),
      stage: text(40).optional(),
      source: text(80).optional(),
      sort: z.enum(['newest', 'name', 'days']).optional(),
    }),
    run: (ctx, { params }) => pipelineScreen(ctx, params.jobId, params),
  }),
  route({
    name: 'recruitingCandidates',
    method: 'GET',
    path: `${V1}/candidates`,
    summary: 'R26: every candidate',
    params: z.object({ q: text(200).optional(), tag: text(60).optional() }),
    run: async (ctx, { params }) => ok(await candidatesScreen(ctx, params.q, params.tag)),
  }),
  route({
    name: 'recruitingCandidate',
    method: 'GET',
    path: `${V1}/candidates/{candidateId}`,
    summary: 'R11, R12: a candidate',
    params: z.object({ candidateId: Id }),
    run: (ctx, { params }) => candidateScreen(ctx, params.candidateId),
  }),
  route({
    name: 'recruitingPools',
    method: 'GET',
    path: `${V1}/pools`,
    summary: 'R13: talent pools',
    params: z.object({ poolId: Id.optional() }),
    run: (ctx, { params }) => poolsScreen(ctx, params.poolId),
  }),
  route({
    name: 'recruitingInterviews',
    method: 'GET',
    path: `${V1}/interviews`,
    summary: 'RM1: my interviews and scorecards owed',
    run: async (ctx) => ok(await interviewsScreen(ctx)),
  }),
  route({
    name: 'recruitingKit',
    method: 'GET',
    path: `${V1}/interviews/{interviewId}`,
    summary: 'R15: an interview kit and my scorecard',
    params: z.object({ interviewId: Id }),
    run: (ctx, { params }) => kit(ctx, params.interviewId),
  }),
  route({
    name: 'recruitingSlots',
    method: 'GET',
    path: `${V1}/applications/{applicationId}/slots`,
    summary: 'R16: the plan and free slots for one of its interviews, a week at a time',
    params: z.object({
      applicationId: Id,
      planKey: text(40).optional(),
      from: Instant.optional(),
      away: text(4000).optional(),
    }),
    run: (ctx, { params }) =>
      scheduleScreen(
        ctx,
        params.applicationId,
        params.planKey,
        params.from,
        params.away === undefined ? {} : (JSON.parse(params.away) as Record<string, string[]>),
      ),
  }),
  route({
    name: 'recruitingDebrief',
    method: 'GET',
    path: `${V1}/applications/{applicationId}/debrief`,
    summary: 'R17: the debrief',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => debriefOf(ctx, params.applicationId),
  }),
  route({
    name: 'recruitingOffers',
    method: 'GET',
    path: `${V1}/offers`,
    summary: 'Offers',
    run: async (ctx) => ok(await offersScreen(ctx)),
  }),
  route({
    name: 'recruitingOffer',
    method: 'GET',
    path: `${V1}/offers/{offerId}`,
    summary: 'R19–R22: an offer, its terms, approval and contract',
    params: z.object({ offerId: Id }),
    run: (ctx, { params }) => offerScreen(ctx, params.offerId),
  }),
  route({
    name: 'recruitingBoard',
    method: 'GET',
    path: `${V1}/board`,
    summary: 'R8: the internal board and my referrals',
    run: async (ctx) => ok(await boardScreen(ctx)),
  }),
  route({
    name: 'recruitingSettings',
    method: 'GET',
    path: `${V1}/settings`,
    summary: 'S1–S8',
    run: async (ctx) => ok(await settingsScreen(ctx)),
  }),
  route({
    name: 'recruitingAnalytics',
    method: 'GET',
    path: `${V1}/analytics`,
    summary: 'R23: dashboards',
    params: z.object({
      period: z
        .enum(['last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'last_year'])
        .default('last_90_days'),
      jobId: Id.optional(),
      department: text(80).optional(),
      source: text(80).optional(),
    }),
    run: async (ctx, { params }) =>
      ok({
        overview: await overview(ctx, params),
        speed: await speed(ctx, params),
        timeInStage: await timeInStage(ctx, params),
        offers: await offerAcceptance(ctx),
        filters: params,
      }),
  }),
  route({
    name: 'recruitingInbox',
    method: 'GET',
    path: `${V1}/inbox`,
    summary: 'The Inbox: Recruiting’s items for me',
    answer: InboxAnswer,
    run: async (ctx) => ok(await recruitingInbox(ctx)),
  }),
  route({
    name: 'recruitingExport',
    method: 'GET',
    path: `${V1}/candidates/{candidateId}/export`,
    summary: 'Everything held about a candidate (GDPR art. 15)',
    params: z.object({ candidateId: Id }),
    run: (ctx, { params }) =>
      ctx.viewer.admin
        ? exportCandidate(ctx, params.candidateId)
        : Promise.resolve(err(failure('FORBIDDEN', 'Only an administrator exports a candidate'))),
  }),

  /* ------------------------------------------------------- requisitions -- */
  route({
    name: 'saveRequisition',
    method: 'PUT',
    path: `${V1}/requisitions/{requisitionId}`,
    summary: 'Draft or edit a requisition',
    params: z.object({ requisitionId: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) =>
      saveRequisition(ctx, {
        ...body,
        id: params.requisitionId,
      } as never),
  }),
  route({
    name: 'submitRequisition',
    method: 'POST',
    path: `${V1}/requisitions/{requisitionId}/submit`,
    summary: 'Send for approval',
    params: z.object({ requisitionId: Id }),
    run: (ctx, { params }) => submitRequisition(ctx, params.requisitionId),
  }),
  route({
    name: 'decideRequisition',
    method: 'POST',
    path: `${V1}/requisitions/{requisitionId}/decide`,
    summary: 'R3: approve or reject',
    params: z.object({ requisitionId: Id }),
    body: z.object({ decision: z.enum(['approved', 'rejected']), comment: text(2000).nullable() }),
    run: (ctx, { params, body }) =>
      decideRequisition(ctx, params.requisitionId, body.decision, body.comment),
  }),
  route({
    name: 'cancelRequisition',
    method: 'POST',
    path: `${V1}/requisitions/{requisitionId}/cancel`,
    summary: 'Cancel a requisition',
    params: z.object({ requisitionId: Id }),
    run: (ctx, { params }) => cancelRequisition(ctx, params.requisitionId),
  }),

  /* --------------------------------------------------------------- jobs -- */
  route({
    name: 'createJob',
    method: 'POST',
    path: `${V1}/jobs`,
    summary: 'Open a job, from a requisition or directly',
    body: z.object({
      id: Id,
      title: text(200).min(1),
      internalTitle: text(200),
      requisitionIds: z.array(Id),
      entityId: Id.nullable(),
      locationIds: z.array(Id),
      department: text(80).nullable(),
      workMode: WorkMode,
      openings: z.int().min(1).max(500),
      languages: z.array(text(5)),
      hiringManagerId: Id.nullable(),
    }),
    status: 201,
    run: (ctx, { body }) => createJob(ctx, body),
  }),
  route({
    name: 'saveJobDetails',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}`,
    summary: 'R4: details',
    params: z.object({ jobId: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveJobDetails(ctx, params.jobId, body as never),
  }),
  route({
    name: 'setJobTeam',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}/team`,
    summary: 'R4: the hiring team',
    params: z.object({ jobId: Id }),
    body: z.object({
      team: z
        .array(
          z.object({
            personId: Id,
            role: z.enum(['recruiter', 'hiring_manager', 'interviewer', 'coordinator']),
          }),
        )
        .max(50),
    }),
    run: (ctx, { params, body }) => setTeam(ctx, params.jobId, body.team),
  }),
  route({
    name: 'setJobStages',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}/stages`,
    summary: 'The job’s pipeline',
    params: z.object({ jobId: Id }),
    body: z.object({ stages: z.array(Stage).max(20) }),
    run: (ctx, { params, body }) => setStages(ctx, params.jobId, body.stages as never),
  }),
  route({
    name: 'saveJobForm',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}/form`,
    summary: 'R6: the apply form',
    params: z.object({ jobId: Id }),
    body: z.object({
      fields: z.array(z.record(z.string(), z.unknown())).max(40),
      questionnaireId: Id.nullable(),
    }),
    run: (ctx, { params, body }) =>
      saveForm(ctx, params.jobId, body.fields as never, body.questionnaireId),
  }),
  route({
    name: 'saveJobAd',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}/ads/{language}`,
    summary: 'R5: the ad in one language',
    params: z.object({ jobId: Id, language: z.string().regex(/^[a-z]{2}$/u) }),
    // The editor's document only: the HTML is rendered from it, never taken from the browser.
    body: z.object({ title: text(200).min(1), doc: z.unknown() }),
    run: (ctx, { params, body }) =>
      saveAd(ctx, params.jobId, params.language, body.title, body.doc),
  }),
  route({
    name: 'draftAd',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/ad-drafts`,
    summary: 'R5: a draft ad from the intake, for a person to edit and save',
    params: z.object({ jobId: Id }),
    body: z.object({ language: z.string().min(2).max(8), intake: text(4000) }),
    run: (ctx, { params, body }) => draftAd(ctx, params.jobId, body),
  }),
  route({
    name: 'explainAdPhrase',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/ad-hints`,
    summary: 'R5: why a flagged phrase may put people off, and a neutral one',
    params: z.object({ jobId: Id }),
    body: z.object({
      language: z.string().min(2).max(8),
      phrase: text(300).min(1),
      check: text(300),
    }),
    run: (ctx, { params, body }) => explainPhrase(ctx, params.jobId, body),
  }),
  route({
    name: 'translateAd',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/ad-translations`,
    summary: 'R5: the prose translated, for a person to approve by saving',
    params: z.object({ jobId: Id }),
    body: z.object({ from: z.string().min(2).max(8), to: z.string().min(2).max(8) }),
    run: (ctx, { params, body }) => translateAd(ctx, params.jobId, body),
  }),
  route({
    name: 'suggestKitQuestions',
    method: 'POST',
    path: `${V1}/scorecard-templates/{id}/suggestions`,
    summary: 'R14: questions suggested per competency, for an administrator to keep',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => suggestQuestions(ctx, params.id),
  }),
  route({
    name: 'setJobCriteria',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}/criteria`,
    summary: 'R4: criteria',
    params: z.object({ jobId: Id }),
    body: z.object({
      criteria: z
        .array(
          z.object({ id: Id, text: text(500), must: z.boolean(), weight: z.int().min(1).max(5) }),
        )
        .max(20),
    }),
    run: (ctx, { params, body }) => setCriteria(ctx, params.jobId, body.criteria),
  }),
  route({
    name: 'setJobPlan',
    method: 'PUT',
    path: `${V1}/jobs/{jobId}/plan`,
    summary: 'R14: the interview plan',
    params: z.object({ jobId: Id }),
    body: z.object({
      plan: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u),
            title: text(120),
            minutes: z.int(),
            interviewerIds: z.array(Id),
            competencies: z.array(text(60)),
            scorecardTemplateId: z.string().max(80).nullable(),
          }),
        )
        .max(12),
    }),
    run: (ctx, { params, body }) => setPlan(ctx, params.jobId, body.plan),
  }),
  route({
    name: 'moveJob',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/state`,
    summary: 'Open, hold, close or reopen a job',
    params: z.object({ jobId: Id }),
    body: z.object({ to: z.enum(['open', 'on_hold', 'closed']) }),
    run: (ctx, { params, body }) => moveJobState(ctx, params.jobId, body.to),
  }),
  route({
    name: 'publishJob',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/targets/{target}`,
    summary: 'R7: publish to a target',
    params: z.object({ jobId: Id, target: PublicationTarget }),
    run: (ctx, { params }) => publishTo(ctx, params.jobId, params.target),
  }),
  route({
    name: 'unpublishJob',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/unpublish`,
    summary: 'R7: take the job down everywhere',
    params: z.object({ jobId: Id }),
    run: (ctx, { params }) => unpublish(ctx, params.jobId),
  }),
  route({
    name: 'addCandidate',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/candidates`,
    summary: 'Add a candidate by hand, or a sourced profile',
    params: z.object({ jobId: Id }),
    body: z.object({
      name: text(200).min(1),
      email: z.email(),
      phone: text(40).nullable(),
      sourced: z.boolean(),
      files: z.array(File).max(5).optional(),
    }),
    status: 201,
    run: (ctx, { params, body }) =>
      addCandidate(
        ctx,
        params.jobId,
        body.name,
        body.email,
        body.phone,
        files(body.files),
        body.sourced,
      ),
  }),
  route({
    name: 'refer',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/referrals`,
    summary: 'R8, RM6: refer someone',
    params: z.object({ jobId: Id }),
    body: z.object({ name: text(200).min(1), email: z.email(), note: text(2000).nullable() }),
    status: 201,
    run: (ctx, { params, body }) => refer(ctx, params.jobId, body.name, body.email, body.note),
  }),
  route({
    name: 'applyInternally',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/internal-applications`,
    summary: 'R8: apply to a job inside the company',
    params: z.object({ jobId: Id }),
    body: z.object({ files: z.array(File).max(5).optional() }),
    status: 201,
    run: (ctx, { params, body }) => applyInternally(ctx, params.jobId, files(body.files)),
  }),

  /* ------------------------------------------------------ the pipeline -- */
  route({
    name: 'moveApplication',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/move`,
    summary: 'R10: move to a stage',
    params: z.object({ applicationId: Id }),
    body: z.object({ to: Id, interviewType: text(40).optional() }),
    run: (ctx, { params, body }) =>
      moveApplication(
        ctx,
        params.applicationId,
        body.to,
        body.interviewType === undefined ? {} : { interviewType: body.interviewType },
      ),
  }),
  route({
    name: 'undoMove',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/undo`,
    summary: 'Undo a move within ten seconds',
    params: z.object({ applicationId: Id }),
    body: z.object({ moveId: Id }),
    run: (ctx, { params, body }) => undoMove(ctx, params.applicationId, body.moveId),
  }),
  route({
    name: 'correctMove',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/correct`,
    summary: 'Correct a move, with a reason',
    params: z.object({ applicationId: Id }),
    body: z.object({ moveId: Id, to: Id, reason: text(500).min(1) }),
    run: (ctx, { params, body }) =>
      correctMove(ctx, params.applicationId, body.moveId, body.to, body.reason),
  }),
  route({
    name: 'rejectApplication',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/reject`,
    summary: 'Reject with a reason, an email and a pool',
    params: z.object({ applicationId: Id }),
    body: z.object({
      reasonKey: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/u),
      templateId: Id.nullable(),
      send: z.enum(['now', 'later_today', 'none']),
      poolId: Id.nullable(),
    }),
    run: (ctx, { params, body }) => rejectApplication(ctx, params.applicationId, body),
  }),
  route({
    name: 'bulkApplications',
    method: 'POST',
    path: `${V1}/applications/bulk`,
    summary: 'R10: move, reject or pool many at once',
    body: z.discriminatedUnion('action', [
      z.object({ action: z.literal('move'), ids: z.array(Id).max(500), to: Id }),
      z.object({
        action: z.literal('reject'),
        ids: z.array(Id).max(500),
        reasonKey: z.string().max(63),
        templateId: Id.nullable(),
        send: z.enum(['now', 'later_today', 'none']),
      }),
      z.object({ action: z.literal('pool'), ids: z.array(Id).max(500), poolId: Id }),
    ]),
    run: async (ctx, { body }) =>
      ok(
        await bulk(ctx, body.ids, async (id) => {
          if (body.action === 'move') return moveApplication(ctx, id, body.to);
          if (body.action === 'reject')
            return rejectApplication(ctx, id, {
              reasonKey: body.reasonKey,
              templateId: body.templateId,
              send: body.send,
              poolId: null,
            });
          const app = await ctx.tx.applications.get(id);
          return app === null
            ? err(failure('NOT_FOUND', 'No such application'))
            : addToPool(ctx, body.poolId, app.candidateId, 'Added from the pipeline');
        }),
      ),
  }),
  route({
    name: 'sendMessage',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/messages`,
    summary: 'R12: email the candidate',
    params: z.object({ applicationId: Id }),
    body: z.object({
      subject: text(300).min(1),
      body: text(20_000).min(1),
      templateId: Id.nullable(),
    }),
    run: (ctx, { params, body }) =>
      sendMessage(ctx, params.applicationId, body.subject, body.body, body.templateId),
  }),
  route({
    name: 'addNote',
    method: 'POST',
    path: `${V1}/candidates/{candidateId}/notes`,
    summary: 'A note, with @mentions',
    params: z.object({ candidateId: Id }),
    body: z.object({
      applicationId: Id.nullable(),
      body: text(10_000).min(1),
      mentions: z.array(Id).max(20),
    }),
    run: async (ctx, { params, body }) => {
      if (ctx.viewer.personId === null)
        return err(failure('FORBIDDEN', 'A note needs a member of the company'));
      await ctx.tx.notes.add({
        id: ctx.deps.newId(),
        candidateId: params.candidateId,
        applicationId: body.applicationId,
        authorId: ctx.viewer.personId,
        body: body.body,
        mentions: body.mentions,
        createdAt: ctx.at,
      });
      return ok({ ok: true });
    },
  }),
  route({
    name: 'savePool',
    method: 'PUT',
    path: `${V1}/pools/{poolId}`,
    summary: 'A talent pool',
    params: z.object({ poolId: Id }),
    body: z.object({ name: text(120).min(1), description: text(500).nullable() }),
    run: async (ctx, { params, body }) => {
      const allowed = await recruiterOnly(ctx);
      if (!allowed.ok) return allowed;
      await ctx.tx.pools.save({ id: params.poolId, ...body });
      return ok({ ok: true });
    },
  }),
  route({
    name: 'addToPool',
    method: 'POST',
    path: `${V1}/pools/{poolId}/members`,
    summary: 'Add a candidate to a pool, asking consent when needed',
    params: z.object({ poolId: Id }),
    body: z.object({ candidateId: Id, reason: text(300).min(1) }),
    run: (ctx, { params, body }) => addToPool(ctx, params.poolId, body.candidateId, body.reason),
  }),

  /* --------------------------------------------------------- interviews -- */
  route({
    name: 'recruitingWorkingHours',
    method: 'GET',
    path: `${V1}/me/working-hours`,
    summary: 'My working hours, for slots without a calendar',
    run: (ctx) => myWorkingHours(ctx),
  }),
  route({
    name: 'saveRecruitingWorkingHours',
    method: 'PUT',
    path: `${V1}/me/working-hours`,
    summary: 'Set my working hours',
    body: z.object({
      timeZone: text(60).min(1),
      week: z.record(
        z.enum(['1', '2', '3', '4', '5', '6', '7']),
        z.array(z.tuple([z.int().min(0).max(1440), z.int().min(0).max(1440)])).max(4),
      ),
    }),
    run: (ctx, { body }) => saveWorkingHours(ctx, body),
  }),
  route({
    name: 'scheduleInterview',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/interviews`,
    summary: 'R16: book an interview',
    params: z.object({ applicationId: Id }),
    body: z.object({
      planKey: text(40),
      startsAt: Instant,
      interviewerIds: z.array(Id).optional(),
      place: text(500).nullable(),
      videoUrl: z.url().nullable(),
    }),
    status: 201,
    run: (ctx, { params, body }) => scheduleInterview(ctx, params.applicationId, body),
  }),
  route({
    name: 'selfScheduleLink',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/schedule-links`,
    summary: 'Send a self-scheduling link',
    params: z.object({ applicationId: Id }),
    body: z.object({ planKey: text(40) }),
    run: (ctx, { params, body }) => selfScheduleLink(ctx, params.applicationId, body.planKey),
  }),
  route({
    name: 'setInterviewState',
    method: 'POST',
    path: `${V1}/interviews/{interviewId}/state`,
    summary: 'Completed, no-show or cancelled',
    params: z.object({ interviewId: Id }),
    body: z.object({ to: z.enum(['completed', 'no_show', 'cancelled']) }),
    run: (ctx, { params, body }) => setInterviewState(ctx, params.interviewId, body.to),
  }),
  route({
    name: 'saveScorecard',
    method: 'PUT',
    path: `${V1}/interviews/{interviewId}/scorecard`,
    summary: 'R15: my scorecard, saved or submitted',
    params: z.object({ interviewId: Id }),
    body: z.object({
      ratings: z.record(z.string().max(60), Rating),
      recommendation: Recommendation.nullable(),
      notes: text(10_000).nullable(),
      submit: z.boolean(),
    }),
    run: (ctx, { params, body }) => saveScorecard(ctx, params.interviewId, body),
  }),
  route({
    name: 'decideApplication',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/decision`,
    summary: 'R17: the hiring manager decides',
    params: z.object({ applicationId: Id }),
    body: z.object({ decision: z.enum(['advance', 'reject', 'offer']), reason: text(2000).min(1) }),
    run: (ctx, { params, body }) => decide(ctx, params.applicationId, body.decision, body.reason),
  }),
  route({
    name: 'parseCv',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/profile`,
    summary: 'R11: the model reads the masked CV into a profile, with a passage behind every value',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => parseCv(ctx, params.applicationId),
  }),
  route({
    name: 'assessMatrix',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/matrix`,
    summary: 'R10, R11: the evidence matrix against the job’s criteria; the domain scores it',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => assessMatrix(ctx, params.applicationId),
  }),
  route({
    name: 'rediscover',
    method: 'POST',
    path: `${V1}/jobs/{jobId}/rediscover`,
    summary:
      'R10: pool members with live consent, read against this job’s criteria, strongest first',
    params: z.object({ jobId: Id }),
    run: (ctx, { params }) => rediscover(ctx, params.jobId),
  }),
  route({
    name: 'draftEmail',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/email-drafts`,
    summary: 'R12: an email drafted from its purpose, the variables filled from data',
    params: z.object({ applicationId: Id }),
    body: z.object({ intent: text(500).min(1), language: z.string().min(2).max(8).optional() }),
    run: (ctx, { params, body }) => draftEmail(ctx, params.applicationId, body),
  }),
  route({
    name: 'summariseDebrief',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/debrief-summary`,
    summary: 'R17: the scorecards summarised, every sentence citing its sources',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => summariseDebrief(ctx, params.applicationId),
  }),
  route({
    name: 'sendAssessment',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/assessment`,
    summary: 'R11: send the candidate a third-party assessment',
    params: z.object({ applicationId: Id }),
    body: z.object({ packageKey: text(80).min(1) }),
    run: (ctx, { params, body }) => sendAssessment(ctx, params.applicationId, body.packageKey),
  }),
  route({
    name: 'refreshAssessment',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/assessment/refresh`,
    summary: 'R11: the assessment’s score and report, once the candidate has finished',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => refreshAssessment(ctx, params.applicationId),
  }),
  route({
    name: 'startBackgroundCheck',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/background-check`,
    summary: 'R22: a background check, only after the offer and only where lawful',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => startBackgroundCheck(ctx, params.applicationId),
  }),
  route({
    name: 'refreshBackgroundCheck',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/background-check/refresh`,
    summary: 'R22: the check’s state; clear meets the pre-hire condition',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => refreshBackgroundCheck(ctx, params.applicationId),
  }),
  route({
    name: 'agreeWithFinding',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/matrix/{assessmentId}/{criterionId}`,
    summary: 'R11: was this right? Per criterion, stored with the assessment',
    params: z.object({ applicationId: Id, assessmentId: Id, criterionId: Id }),
    body: z.object({ agreed: z.boolean() }),
    run: async (ctx, { params, body }) =>
      done(
        await agreeWithFinding(
          ctx,
          params.applicationId,
          params.assessmentId,
          params.criterionId,
          body.agreed,
        ),
      ),
  }),
  route({
    name: 'recruitingParsedProfile',
    method: 'GET',
    path: `${V1}/applications/{applicationId}/profile`,
    summary: 'R11: the parsed profile, and whether the candidate confirmed it',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => parsedProfile(ctx, params.applicationId),
  }),
  route({
    name: 'requestReference',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/references/{referenceId}`,
    summary: 'R18: ask a named referee',
    params: z.object({ applicationId: Id, referenceId: Id }),
    run: (ctx, { params }) => requestReference(ctx, params.referenceId, params.applicationId),
  }),

  /* ------------------------------------------------------------- offers -- */
  route({
    name: 'composeOffer',
    method: 'PUT',
    path: `${V1}/applications/{applicationId}/offer`,
    summary: 'R19: compose or revise the offer',
    params: z.object({ applicationId: Id }),
    body: z.object({
      terms: Terms,
      pay: z.object({
        baseMinor: z.int().nonnegative(),
        currency: z.string().length(3),
        frequency: z.enum(['year', 'month', 'hour']),
        variableTargetMinor: z.int().nonnegative(),
        signOnMinor: z.int().nonnegative(),
        relocationMinor: z.int().nonnegative(),
        equity: z.object({ description: text(300), units: z.int().nonnegative() }).nullable(),
      }),
      benefitIds: z.array(z.string().max(80)),
      startDate: CalendarDate,
      expiresOn: CalendarDate,
      letterTemplateId: Id.nullable(),
      grade: text(40).nullable(),
      outsideBandReason: text(1000).nullable(),
    }),
    run: (ctx, { params, body }) => composeOffer(ctx, params.applicationId, body as never),
  }),
  route({
    name: 'submitOffer',
    method: 'POST',
    path: `${V1}/offers/{offerId}/submit`,
    summary: 'Check and send for approval',
    params: z.object({ offerId: Id }),
    run: (ctx, { params }) => submitOfferForApproval(ctx, params.offerId),
  }),
  route({
    name: 'decideOffer',
    method: 'POST',
    path: `${V1}/offers/{offerId}/decide`,
    summary: 'R20: approve or reject an offer',
    params: z.object({ offerId: Id }),
    body: z.object({ decision: z.enum(['approved', 'rejected']), comment: text(2000).nullable() }),
    run: (ctx, { params, body }) => decideOffer(ctx, params.offerId, body.decision, body.comment),
  }),
  route({
    name: 'sendOffer',
    method: 'POST',
    path: `${V1}/offers/{offerId}/send`,
    summary: 'Send the offer to the candidate',
    params: z.object({ offerId: Id }),
    run: (ctx, { params }) => sendTheOffer(ctx, params.offerId),
  }),
  route({
    name: 'withdrawOffer',
    method: 'POST',
    path: `${V1}/offers/{offerId}/withdraw`,
    summary: 'Withdraw an offer',
    params: z.object({ offerId: Id }),
    run: (ctx, { params }) => withdrawTheOffer(ctx, params.offerId),
  }),
  route({
    name: 'uploadSignedContract',
    method: 'POST',
    path: `${V1}/offers/{offerId}/contract`,
    summary: 'R22: the signed contract, uploaded',
    params: z.object({ offerId: Id }),
    body: z.object({ fileId: Id, signedOn: CalendarDate }),
    run: (ctx, { params, body }) =>
      uploadSignedContract(ctx, params.offerId, body.fileId, body.signedOn),
  }),
  route({
    name: 'decideCondition',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/conditions/{kind}`,
    summary: 'R22: a pre-hire condition met, waived or failed',
    params: z.object({ applicationId: Id, kind: ConditionKind }),
    body: z.object({ state: z.enum(['met', 'waived', 'failed']), note: text(1000).nullable() }),
    run: (ctx, { params, body }) =>
      decidePrehireCondition(ctx, params.applicationId, params.kind, body.state, body.note),
  }),
  route({
    name: 'cancelPrehire',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/cancel-prehire`,
    summary: 'The hire fell through before the start',
    params: z.object({ applicationId: Id }),
    body: z.object({ reason: PrehireCancelReason }),
    run: (ctx, { params, body }) => cancelThePrehire(ctx, params.applicationId, body.reason),
  }),
  route({
    name: 'presentToWorksCouncil',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/works-council`,
    summary: '§ 99 BetrVG: present the hire',
    params: z.object({ applicationId: Id }),
    run: (ctx, { params }) => presentToWorksCouncil(ctx, params.applicationId),
  }),
  route({
    name: 'worksCouncilDecides',
    method: 'POST',
    path: `${V1}/applications/{applicationId}/works-council/decision`,
    summary: 'The works council consents or refuses',
    params: z.object({ applicationId: Id }),
    body: z.object({ decision: z.enum(['consented', 'refused']), reason: text(4000).nullable() }),
    run: (ctx, { params, body }) =>
      worksCouncilDecides(ctx, params.applicationId, body.decision, body.reason),
  }),

  /* ---------------------------------------------------------- settings -- */
  route({
    name: 'importRecruitingMembers',
    method: 'POST',
    path: `${V1}/members:import`,
    summary:
      'Members from CSV or JSON when People is absent: a dry run, then all rows or none; admin',
    body: z.object({
      format: z.enum(['csv', 'json']),
      content: z.string().max(5_000_000),
      dryRun: z.boolean().default(true),
    }),
    run: (ctx, { body }) => importMembers(ctx, body),
  }),
  route({
    name: 'saveSettings',
    method: 'PUT',
    path: `${V1}/settings`,
    summary: 'S1: general',
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { body }) => saveGeneralSettings(ctx, body),
  }),
  route({
    name: 'saveEntity',
    method: 'PUT',
    path: `${V1}/settings/entities/{id}`,
    summary: 'A legal entity',
    params: z.object({ id: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveEntity(ctx, { ...body, id: params.id }),
  }),
  route({
    name: 'saveLocation',
    method: 'PUT',
    path: `${V1}/settings/locations/{id}`,
    summary: 'A location',
    params: z.object({ id: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveLocation(ctx, { ...body, id: params.id }),
  }),
  route({
    name: 'savePipeline',
    method: 'PUT',
    path: `${V1}/settings/pipelines/{id}`,
    summary: 'S2: a pipeline template',
    params: z.object({ id: Id }),
    body: z.object({
      name: text(120).min(1),
      isDefault: z.boolean(),
      stages: z.array(Stage).max(20),
    }),
    run: (ctx, { params, body }) => savePipeline(ctx, { id: params.id, ...body } as never),
  }),
  route({
    name: 'saveChain',
    method: 'PUT',
    path: `${V1}/settings/chains/{id}`,
    summary: 'S4: an approval chain',
    params: z.object({ id: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveChain(ctx, { ...body, id: params.id } as never),
  }),
  route({
    name: 'saveQuestionnaire',
    method: 'PUT',
    path: `${V1}/settings/questionnaires/{id}`,
    summary: 'S3: a questionnaire',
    params: z.object({ id: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveQuestionnaire(ctx, { ...body, id: params.id } as never),
  }),
  route({
    name: 'consentQuestionnaire',
    method: 'POST',
    path: `${V1}/settings/questionnaires/{id}/works-council`,
    summary: 'Record the works council’s consent (§ 94 BetrVG)',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => recordWorksCouncilConsent(ctx, params.id),
  }),
  route({
    name: 'saveScorecardTemplate',
    method: 'PUT',
    path: `${V1}/settings/scorecards/{id}`,
    summary: 'S5: a scorecard',
    params: z.object({ id: Id }),
    body: z.object({
      name: text(200).min(1),
      competencies: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/u),
            name: text(120).min(1),
            description: text(1000),
            questions: z.array(text(500)).max(20),
          }),
        )
        .max(30),
    }),
    run: (ctx, { params, body }) => saveScorecardTemplate(ctx, { ...body, id: params.id }),
  }),
  route({
    name: 'saveTemplate',
    method: 'PUT',
    path: `${V1}/settings/templates/{id}`,
    summary: 'An email or letter template',
    params: z.object({ id: Id }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveTemplate(ctx, { ...body, id: params.id } as never),
  }),
  route({
    name: 'saveBenefit',
    method: 'PUT',
    path: `${V1}/settings/benefits/{id}`,
    summary: 'S6: a benefit',
    params: z.object({ id: z.string().max(80) }),
    body: z.record(z.string(), z.unknown()),
    run: (ctx, { params, body }) => saveBenefit(ctx, { ...body, id: params.id } as never),
  }),
  route({
    name: 'savePayBand',
    method: 'PUT',
    path: `${V1}/settings/pay-bands/{id}`,
    summary: 'A pay band',
    params: z.object({ id: Id }),
    body: z.object({
      entityId: Id.nullable(),
      grade: text(40).min(1),
      minMinor: z.int().nonnegative(),
      maxMinor: z.int().nonnegative(),
      currency: z.string().length(3),
    }),
    run: (ctx, { params, body }) =>
      savePayBand(ctx, { ...body, id: params.id, source: 'recruiting' }),
  }),
  route({
    name: 'saveAgency',
    method: 'PUT',
    path: `${V1}/agencies/{id}`,
    summary: 'R9: an agency and the jobs it may submit to',
    params: z.object({ id: Id }),
    body: z.object({
      name: text(200).min(1),
      contactEmail: z.email(),
      fee: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('percent'), basisPoints: z.int().min(0).max(10_000) }),
        z.object({ kind: z.literal('fixed'), amountMinor: z.int().nonnegative() }),
      ]),
      guaranteeDays: z.int().min(0).max(365),
      ownershipMonths: z.int().min(1).max(24),
      active: z.boolean(),
      jobIds: z.array(Id),
    }),
    run: async (ctx, { params, body }) => {
      if (!ctx.viewer.admin)
        return err(failure('FORBIDDEN', 'Only an administrator manages agencies'));
      await ctx.tx.agencies.save({ id: params.id, ...body });
      return ok({ ok: true });
    },
  }),
  route({
    name: 'placeHold',
    method: 'POST',
    path: `${V1}/candidates/{candidateId}/hold`,
    summary: 'A legal hold',
    params: z.object({ candidateId: Id }),
    body: z.object({ reason: text(500).min(1) }),
    run: (ctx, { params, body }) => placeHold(ctx, params.candidateId, body.reason),
  }),
  route({
    name: 'deleteCandidate',
    method: 'POST',
    path: `${V1}/candidates/{candidateId}/delete`,
    summary: 'Delete a candidate on request (GDPR art. 17)',
    params: z.object({ candidateId: Id }),
    run: (ctx, { params }) =>
      ctx.viewer.admin
        ? anonymise(ctx, params.candidateId)
        : Promise.resolve(err(failure('FORBIDDEN', 'Only an administrator deletes a candidate'))),
  }),
  route({
    name: 'chart',
    method: 'POST',
    path: `${V1}/analytics/chart`,
    summary: 'R25: a chart from its plan',
    body: z.object({
      metric: text(60),
      breakdown: z
        .enum([
          'department',
          'source',
          'job',
          'stage',
          'hiring_manager',
          'country',
          'month',
          'rejection_reason',
        ])
        .nullable(),
      filters: z.record(z.string(), z.array(z.string())),
      period: z.enum(['last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'last_year']),
      compare: z
        .enum(['last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'last_year'])
        .nullable(),
      chart: z.enum([
        'funnel',
        'trend',
        'bar',
        'stacked_bar',
        'heatmap',
        'bullet',
        'combo',
        'donut',
        'cohort',
      ]),
    }),
    run: (ctx, { body }) => chart(ctx, body),
  }),

  route({
    name: 'recruitingFairness',
    method: 'GET',
    path: `${V1}/analytics/fairness`,
    summary: 'R23: stage pass rates by self-ID group, four-fifths rule; administrators only',
    params: z.object({ category: z.enum(['gender', 'ethnicity']).default('gender') }),
    run: (ctx, { params }) => fairness(ctx, params.category),
  }),
  route({
    name: 'askForChart',
    method: 'POST',
    path: `${V1}/analytics/ask`,
    summary: 'R25: a question becomes a plan, validated and computed by the domain',
    body: z.object({ question: text(300).min(1) }),
    run: (ctx, { body }) => askForChart(ctx, body.question),
  }),

  /* ------------------------------------------------------ the public API -- */
  route({
    name: 'publicCode',
    method: 'POST',
    path: `${V1}/public/{company}/codes`,
    summary: 'J4: email a six-digit code',
    params: z.object({ company: text(63) }),
    body: z.object({ jobSlug: text(120), email: z.email(), name: text(200).min(1) }),
    public: true,
    run: (ctx, { body }) => requestCode(ctx, body.jobSlug, body.email, body.name),
  }),
  route({
    name: 'publicApply',
    method: 'POST',
    path: `${V1}/public/{company}/applications`,
    summary: 'J4: apply',
    params: z.object({ company: text(63) }),
    body: z.object({ payload: z.unknown(), files: z.array(File).max(6).optional() }),
    status: 201,
    public: true,
    run: (ctx, { body }) => apply(ctx, body.payload, files(body.files)),
  }),
  route({
    name: 'publicMe',
    method: 'GET',
    path: `${V1}/public/{company}/me`,
    summary: 'J6: my applications',
    params: z.object({ company: text(63) }),
    public: true,
    run: (ctx, { headers }) =>
      asCandidate(ctx, headers, async (id) => {
        const c = await ctx.tx.candidates.get(id);
        return c === null
          ? err(failure('NOT_FOUND', 'No such page'))
          : ok(await candidatePage(ctx, c));
      }),
  }),
  route({
    name: 'publicWithdraw',
    method: 'POST',
    path: `${V1}/public/{company}/me/applications/{applicationId}/withdraw`,
    summary: 'J6: withdraw an application',
    params: z.object({ company: text(63), applicationId: Id }),
    public: true,
    run: (ctx, { params, headers }) =>
      asCandidate(ctx, headers, (id) => withdrawApplication(ctx, id, params.applicationId)),
  }),
  route({
    name: 'publicOffer',
    method: 'GET',
    path: `${V1}/public/{company}/me/offers/{offerId}`,
    summary: 'J7: read an offer',
    params: z.object({ company: text(63), offerId: Id }),
    public: true,
    run: (ctx, { params, headers }) =>
      asCandidate(ctx, headers, (id) => offerForCandidate(ctx, id, params.offerId)),
  }),
  route({
    name: 'publicAccept',
    method: 'POST',
    path: `${V1}/public/{company}/me/offers/{offerId}/accept`,
    summary: 'J7: accept, against the version read',
    params: z.object({ company: text(63), offerId: Id }),
    body: z.object({ hash: z.string().length(64) }),
    public: true,
    run: (ctx, { params, body, headers }) =>
      asCandidate(ctx, headers, (id) =>
        candidateAccepts(ctx, id, params.offerId, body.hash, ipOf(headers)),
      ),
  }),
  route({
    name: 'publicDecline',
    method: 'POST',
    path: `${V1}/public/{company}/me/offers/{offerId}/decline`,
    summary: 'J7: decline',
    params: z.object({ company: text(63), offerId: Id }),
    body: z.object({ reason: text(1000).nullable() }),
    public: true,
    run: (ctx, { params, body, headers }) =>
      asCandidate(ctx, headers, (id) => candidateDeclines(ctx, id, params.offerId, body.reason)),
  }),
  route({
    name: 'publicProfile',
    method: 'GET',
    path: `${V1}/public/{company}/me/applications/{applicationId}/profile`,
    summary: 'J6: what was read from my CV',
    params: z.object({ company: text(63), applicationId: Id }),
    public: true,
    run: (ctx, { params, headers }) =>
      asCandidate(ctx, headers, (id) => myParsedProfile(ctx, id, params.applicationId)),
  }),
  route({
    name: 'publicProfileConfirm',
    method: 'POST',
    path: `${V1}/public/{company}/me/applications/{applicationId}/profile/confirm`,
    summary: 'J6: I checked it, and here is what is wrong',
    params: z.object({ company: text(63), applicationId: Id }),
    body: z.object({ note: text(2000).nullable() }),
    public: true,
    run: (ctx, { params, body, headers }) =>
      asCandidate(ctx, headers, (id) =>
        confirmParsedProfile(ctx, id, params.applicationId, body.note),
      ),
  }),
  route({
    name: 'publicSelfIdQuestions',
    method: 'GET',
    path: `${V1}/public/{company}/me/applications/{applicationId}/self-id`,
    summary: 'J6: the voluntary self-ID questions the company asks, after applying',
    params: z.object({ company: text(63), applicationId: Id }),
    public: true,
    run: (ctx, { params, headers }) =>
      asCandidate(ctx, headers, (id) => selfIdQuestions(ctx, id, params.applicationId)),
  }),
  route({
    name: 'publicSelfId',
    method: 'POST',
    path: `${V1}/public/{company}/me/applications/{applicationId}/self-id`,
    summary: 'J6: voluntary self-ID, sealed, never seen by the hiring team or a model',
    params: z.object({ company: text(63), applicationId: Id }),
    body: SelfId,
    public: true,
    run: (ctx, { params, body, headers }) =>
      asCandidate(ctx, headers, (id) => saveSelfId(ctx, id, params.applicationId, body)),
  }),
  route({
    name: 'publicReferee',
    method: 'POST',
    path: `${V1}/public/{company}/me/applications/{applicationId}/referees`,
    summary: 'Name a referee',
    params: z.object({ company: text(63), applicationId: Id }),
    body: z.object({
      name: text(200).min(1),
      email: z.email(),
      relationship: text(200).nullable(),
    }),
    public: true,
    run: (ctx, { params, body, headers }) =>
      asCandidate(ctx, headers, (id) =>
        nameReferee(ctx, id, params.applicationId, body.name, body.email, body.relationship),
      ),
  }),
  route({
    name: 'publicPoolConsent',
    method: 'POST',
    path: `${V1}/public/{company}/me/pool`,
    summary: 'Agree to the talent pool, or withdraw',
    params: z.object({ company: text(63) }),
    body: z.object({ agree: z.boolean() }),
    public: true,
    run: (ctx, { body, headers }) =>
      asCandidate(ctx, headers, (id) =>
        body.agree ? agreeToPool(ctx, id) : withdrawPoolConsent(ctx, id),
      ),
  }),
  route({
    name: 'publicExport',
    method: 'GET',
    path: `${V1}/public/{company}/me/export`,
    summary: 'Download my data',
    params: z.object({ company: text(63) }),
    public: true,
    run: (ctx, { headers }) => asCandidate(ctx, headers, (id) => exportCandidate(ctx, id)),
  }),
  route({
    name: 'publicDelete',
    method: 'POST',
    path: `${V1}/public/{company}/me/delete`,
    summary: 'Delete my data',
    params: z.object({ company: text(63) }),
    public: true,
    run: (ctx, { headers }) =>
      asCandidate(ctx, headers, async (id) => done(await anonymise(ctx, id))),
  }),
  route({
    name: 'publicSlots',
    method: 'GET',
    path: `${V1}/public/{company}/schedule`,
    summary: 'J6: the slots a scheduling link offers',
    params: z.object({ company: text(63) }),
    public: true,
    run: (ctx, { headers }) => linkSlots(ctx, tokenOf(headers)),
  }),
  route({
    name: 'publicBook',
    method: 'POST',
    path: `${V1}/public/{company}/schedule`,
    summary: 'J6: book or reschedule',
    params: z.object({ company: text(63) }),
    body: z.object({ startsAt: Instant }),
    public: true,
    run: (ctx, { body, headers }) => bookByLink(ctx, tokenOf(headers), body.startsAt),
  }),
  route({
    name: 'publicJobNotices',
    method: 'GET',
    path: `${V1}/public/{company}/jobs/{slug}/notices`,
    summary: 'J4: whether the apply form carries the NYC automated-tool notice, and what it reads',
    params: z.object({ company: text(63), slug: text(120) }),
    public: true,
    run: (ctx, { params }) => jobNotices(ctx, params.slug),
  }),
  route({
    name: 'publicJobQuestion',
    method: 'POST',
    path: `${V1}/public/{company}/jobs/{slug}/questions`,
    summary: 'J8: the job assistant, an AI, answering from the ad, the company and the process',
    params: z.object({ company: text(63), slug: text(120) }),
    body: z.object({ question: text(500).min(1) }),
    public: true,
    run: (ctx, { params, body, headers }) =>
      allowed(ipOf(headers), Date.parse(ctx.at))
        ? askAboutJob(ctx, params.slug, body.question)
        : Promise.resolve(err(failure('TOO_MANY', 'Too many questions; try again in an hour'))),
  }),
  route({
    name: 'publicAskRecruiter',
    method: 'POST',
    path: `${V1}/public/{company}/jobs/{slug}/recruiter-questions`,
    summary: 'J8: ask the recruiter, by email, when the assistant cannot answer',
    params: z.object({ company: text(63), slug: text(120) }),
    body: z.object({ email: z.email(), question: text(2000).min(1) }),
    public: true,
    run: (ctx, { params, body, headers }) =>
      allowed(ipOf(headers), Date.parse(ctx.at))
        ? askRecruiter(ctx, params.slug, body.email, body.question)
        : Promise.resolve(err(failure('TOO_MANY', 'Too many questions; try again in an hour'))),
  }),
  route({
    name: 'publicAlert',
    method: 'POST',
    path: `${V1}/public/{company}/alerts`,
    summary: 'J11: email me jobs like this, once the address confirms',
    params: z.object({ company: text(63) }),
    body: z.object({
      email: z.email(),
      query: z.string().max(120).default(''),
      frequency: z.enum(['daily', 'weekly']).default('weekly'),
    }),
    status: 201,
    public: true,
    run: (ctx, { body }) => subscribeAlert(ctx, body),
  }),
  route({
    name: 'publicAlertConfirm',
    method: 'POST',
    path: `${V1}/public/{company}/alerts/confirm`,
    summary: 'J11: the address confirms its alert',
    params: z.object({ company: text(63) }),
    body: z.object({ token: z.string().min(16).max(64) }),
    public: true,
    run: (ctx, { body }) => confirmAlert(ctx, body.token),
  }),
  route({
    name: 'publicAlertStop',
    method: 'POST',
    path: `${V1}/public/{company}/alerts/stop`,
    summary: 'J11: one click ends an alert',
    params: z.object({ company: text(63) }),
    body: z.object({ token: z.string().min(16).max(64) }),
    public: true,
    run: (ctx, { body }) => stopAlert(ctx, body.token),
  }),
  route({
    name: 'publicAgencyCode',
    method: 'POST',
    path: `${V1}/public/{company}/agency/codes`,
    summary: 'J9: a code for the agency portal, to the address the company recorded',
    params: z.object({ company: text(63) }),
    body: z.object({ email: z.email() }),
    public: true,
    run: (ctx, { body }) => requestAgencyCode(ctx, body.email),
  }),
  route({
    name: 'publicAgencySession',
    method: 'POST',
    path: `${V1}/public/{company}/agency/sessions`,
    summary: 'J9: sign in with the code',
    params: z.object({ company: text(63) }),
    body: z.object({ email: z.email(), code: z.string().regex(/^\d{6}$/u) }),
    status: 201,
    public: true,
    run: (ctx, { body }) => openAgencySession(ctx, body.email, body.code),
  }),
  route({
    name: 'publicAgency',
    method: 'GET',
    path: `${V1}/public/{company}/agency`,
    summary: 'J9: the jobs an agency may submit to and its own candidates',
    params: z.object({ company: text(63) }),
    public: true,
    run: (ctx, { headers }) => agencyPortal(ctx, tokenOf(headers)),
  }),
  route({
    name: 'publicAgencySubmit',
    method: 'POST',
    path: `${V1}/public/{company}/agency/submissions`,
    summary: 'J9: submit a candidate; the first agency to submit them owns them',
    params: z.object({ company: text(63) }),
    body: z.object({
      jobId: Id,
      name: text(200).min(1),
      email: z.email(),
      files: z.array(File).max(6).optional(),
    }),
    status: 201,
    public: true,
    run: (ctx, { body, headers }) => submitAsAgency(ctx, tokenOf(headers), body, files(body.files)),
  }),
  route({
    name: 'publicReply',
    method: 'POST',
    path: `${V1}/public/{company}/replies`,
    summary: 'A candidate replied by email; messaging hands it on',
    params: z.object({ company: text(63) }),
    body: z.object({
      token: z.string().regex(/^[a-f0-9]{20}$/u),
      from: z.string().max(320),
      subject: z.string().max(500),
      text: z.string().max(20_000),
    }),
    status: 201,
    public: true,
    run: (ctx, { body, headers }) =>
      ctx.deps.inbound !== undefined && presentsInternalToken({ headers }, ctx.deps.inbound.token)
        ? receiveReply(ctx, body)
        : Promise.resolve(err(failure('FORBIDDEN', 'Only messaging hands on a reply'))),
  }),
  route({
    name: 'publicReference',
    method: 'POST',
    path: `${V1}/public/{company}/references`,
    summary: 'A referee answers',
    params: z.object({ company: text(63) }),
    body: z.object({ answers: z.record(z.string().max(60), text(4000)) }),
    public: true,
    run: (ctx, { body, headers }) => answerReference(ctx, tokenOf(headers), body.answers),
  }),
];

const header = (headers: RestRequest['headers'], name: string): string => {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};
const tokenOf = (headers: RestRequest['headers']) => header(headers, 'x-candidate-token');
const ipOf = (headers: RestRequest['headers']) =>
  header(headers, 'x-forwarded-for').split(',')[0]?.trim() ?? '';

async function asCandidate<T>(
  ctx: Ctx,
  headers: RestRequest['headers'],
  fn: (candidateId: string) => Promise<Result<T>>,
): Promise<Result<T>> {
  const candidate = await candidateByToken(ctx, tokenOf(headers));
  if (candidate === null)
    return err(failure('NOT_FOUND', 'This link has expired; ask for a new one'));
  return fn(candidate.id);
}

/* ------------------------------------------------------------ the handler -- */

const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  INVALID: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_ENTITLED: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  ALREADY_APPLIED: 409,
  ALREADY_SUBMITTED: 409,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

function refused(why: DomainFailure): RestResponse {
  return {
    status: STATUS[why.code] ?? 422,
    body: {
      error: {
        code: why.code,
        message: why.message,
        ...(why.path === undefined ? {} : { path: why.path }),
      },
    },
  };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): Result<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  return err(failure('BAD_REQUEST', issue?.message ?? 'invalid request', issue?.path.map(String)));
}

function base(schema: z.ZodType): z.ZodType {
  let s = schema;
  for (;;) {
    const def = s._zod.def as { type: string; innerType?: z.ZodType };
    if (
      def.innerType === undefined ||
      !['optional', 'nullable', 'default', 'prefault'].includes(def.type)
    )
      return s;
    s = def.innerType;
  }
}

function coerce(params: z.ZodObject, raw: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = params.shape[key] as z.ZodType | undefined;
    const type = field === undefined ? 'string' : (base(field)._zod.def as { type: string }).type;
    out[key] =
      type === 'boolean'
        ? value === 'true'
          ? true
          : value === 'false'
            ? false
            : value
        : type === 'number' && value.trim() !== '' && !Number.isNaN(Number(value))
          ? Number(value)
          : value;
  }
  return out;
}

const escape = (s: string) => s.replaceAll(/[.*+?^$()|[\]\\]/gu, '\\$&');

interface Compiled {
  readonly route: Route;
  readonly pattern: RegExp;
  readonly names: readonly string[];
}

function compile(r: Route): Compiled {
  const names: string[] = [];
  const source = r.path
    .split(/(\{[a-zA-Z]+\})/u)
    .map((part) => {
      const name = /^\{([a-zA-Z]+)\}$/u.exec(part)?.[1];
      if (name === undefined) return escape(part);
      names.push(name);
      return '([^/]+)';
    })
    .join('');
  return { route: r, pattern: new RegExp(`^${source}$`, 'u'), names };
}

/**
 * One transaction per request: the use case, its events, its key and its
 * answer commit together. A refusal commits what it chose to keep (a wrong
 * code's attempt counts) and keeps no key, so the same key may try again.
 */
async function inTransaction(
  deps: Deps,
  caller: Caller,
  run: (ctx: Ctx) => Promise<Result<unknown>>,
  key: { readonly key: string; readonly hash: string; readonly status: number } | null,
): Promise<RestResponse | Result<unknown>> {
  const mail: Outgoing[] = [];
  const held: { replay: RestResponse | null } = { replay: null };
  const result = await deps.uow.run(caller.tenantId, async (tx) => {
    if (key !== null) {
      const prior = await tx.idempotency.get(key.key);
      if (prior !== null) {
        held.replay =
          prior.requestHash === key.hash
            ? { status: prior.status, body: prior.answer }
            : refused(
                failure('IDEMPOTENCY_KEY_REUSED', 'This key was used for a different request'),
              );
        return ok(null);
      }
    }
    const answer = await run(await contextOf(deps, tx, caller, mail));
    if (answer.ok && key !== null)
      await tx.idempotency.put(
        key.key,
        key.hash,
        key.status,
        JSON.parse(JSON.stringify(answer.value ?? null)) as unknown,
      );
    return answer;
  });
  if (held.replay !== null) return held.replay;
  if (result.ok) await deliver(deps, caller.tenantId, mail);
  return result;
}

export function restHandler(
  rest: RestDeps,
): (request: RestRequest) => Promise<RestResponse | null> {
  const compiled = ROUTES.map(compile);
  const { deps } = rest;
  return async (request) => {
    const url = new URL(request.url, 'http://recruiting.internal');
    if (!url.pathname.startsWith(`${V1}/`)) return null;
    const matching = compiled.filter((c) => c.pattern.test(url.pathname));
    if (matching.length === 0) return refused(failure('NOT_FOUND', 'No such route'));
    const found = matching.find((c) => c.route.method === request.method);
    if (found === undefined)
      return {
        status: 405,
        body: { error: { code: 'METHOD_NOT_ALLOWED', message: request.method } },
      };
    const r = found.route;
    const values = found.pattern.exec(url.pathname) ?? [];
    const raw: Record<string, string> = {};
    found.names.forEach((name, i) => {
      raw[name] = decodeURIComponent(values[i + 1] ?? '');
    });
    if (r.method === 'GET') for (const [k, v] of url.searchParams) raw[k] ??= v;
    const params = parse(r.params, coerce(r.params, raw));
    if (!params.ok) return refused(params.error);
    let body: unknown;
    if (r.body !== null) {
      let json: unknown;
      try {
        json = request.body === '' ? {} : JSON.parse(request.body);
      } catch {
        return refused(failure('BAD_REQUEST', 'The body is not JSON'));
      }
      const parsed = parse(r.body, json);
      if (!parsed.ok) return refused(parsed.error);
      body = parsed.value;
    }
    const input = { params: params.value, body, headers: request.headers };

    let caller: Caller;
    let key: { key: string; hash: string; status: number } | null = null;
    if (r.public) {
      const company = (params.value as { company?: string }).company ?? '';
      const tenantId = await deps.uow.tenantBySlug(company);
      if (tenantId === null) return refused(failure('NOT_FOUND', 'No such company'));
      caller = {
        tenantId: TenantId.parse(tenantId),
        accountId: PUBLIC_ACCOUNT,
        personId: null,
        correlationId: deps.newId(),
      };
    } else {
      const asked = await rest.callerFrom(request);
      if (!asked.ok) return refused(asked.error);
      caller = asked.value;
      if (r.method !== 'GET') {
        const given = request.headers['idempotency-key'];
        if (typeof given !== 'string' || given.length === 0 || given.length > 255) {
          return refused(
            failure('IDEMPOTENCY_KEY_REQUIRED', 'Every write carries an Idempotency-Key header'),
          );
        }
        const hash = createHash('sha256')
          .update(
            `${caller.accountId}\n${request.method} ${url.pathname}${url.search}\n${request.body}`,
          )
          .digest('hex');
        key = { key: given, hash, status: r.status };
      }
    }
    const answer = await inTransaction(deps, caller, (ctx) => r.run(ctx, input), key);
    if ('status' in answer) return answer;
    return answer.ok ? { status: r.status, body: answer.value } : refused(answer.error);
  };
}

/** For tests: the unit of work a request runs on. */
export type { UnitOfWork };
export { Done };
