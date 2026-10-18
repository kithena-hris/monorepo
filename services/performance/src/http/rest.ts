import { createHash } from 'node:crypto';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import {
  ActivityKind,
  CalendarDate,
  FormActivity,
  FormAnswers,
  FormDefinition,
  InboxAnswer,
  PersonId,
} from '@kithena/contracts';

import * as ai from '../application/ai.js';
import * as analytics from '../application/analytics.js';
import * as automations from '../application/automations.js';
import * as calibration from '../application/calibration.js';
import { audit, contextOf, deliver, type Ctx, type Outgoing } from '../application/context.js';
import * as cycles from '../application/cycles.js';
import * as feedback from '../application/feedback.js';
import * as goals from '../application/goals.js';
import * as home from '../application/home.js';
import { startLaunch, tell } from '../application/launch.js';
import * as learning from '../application/learning.js';
import { importMembers } from '../application/import.js';
import * as pdf from '../application/pdf.js';
import type { Caller, Deps, UnitOfWork } from '../application/ports.js';
import * as retention from '../application/retention.js';
import * as reviews from '../application/reviews.js';
import * as webhooks from '../application/webhooks.js';
import { aiOn, saveSection } from '../application/settings.js';
import * as templates from '../application/templates.js';
import type { CallerFrom } from './caller.js';

/**
 * REST v1 for Performance (PRD §31, PRF-057): `/v1/performance/...`. One
 * route table serves REST, the OpenAPI document and the subgraph, as in
 * Onboarding; every write carries `Idempotency-Key`; no route decides who
 * may do anything. Every write is audited by its use case, and a refused one
 * here, in a transaction of its own (§24.1).
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
const Json = z.unknown();

function route<P extends z.ZodObject, B extends z.ZodType | null>(def: {
  readonly name: string;
  readonly method: Method;
  readonly path: string;
  readonly summary: string;
  readonly params?: P;
  readonly body?: B;
  readonly answer?: z.ZodType;
  readonly status?: number;
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
    graphql: true,
    public: false,
    run: def.run as Route['run'],
  };
}

const V1 = '/v1/performance';
const Id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const okOf = async <T>(v: Promise<T>): Promise<Result<T>> => ok(await v);
const flag = z.enum(['true', 'false']).optional();

const DeadlineIn = z.union([
  z.object({ kind: z.literal('exact'), date: CalendarDate }),
  z.object({
    kind: z.literal('relative'),
    days: z.int().min(0).max(365),
    from: z.enum(['start', 'nominations']),
  }),
]);
const RemindersIn = z.object({
  rules: z.array(z.string().regex(/^(before:\d{1,2}|on_day|late:\d{1,2}|opens)$/u)).max(8),
  email: z.boolean(),
  chat: z.boolean(),
});
const ActivityIn = z.object({
  on: z.boolean(),
  templateId: Id.nullable(),
  pinnedVersion: z.int().min(1).nullable(),
  due: DeadlineIn,
  afterOthers: z.boolean().optional(),
  reminders: RemindersIn.optional(),
});
const ConditionIn = z.object({
  field: z.enum([
    'department',
    'status',
    'startedBefore',
    'hiredOn',
    'manager',
    'title',
    'legalEntity',
    'location',
  ]),
  value: text(120).min(1),
  op: z.enum(['is', 'not', 'contains', 'before', 'after']).optional(),
});
const ChoiceIn = z.object({
  personId: Id,
  reason: text(300).nullable(),
  by: text(200),
  at: z.string().max(40),
});
const CyclePatch = z.object({
  name: text(200).min(1).optional(),
  description: text(4000).optional(),
  start: z
    .object({ date: CalendarDate, time: z.string().regex(/^\d{2}:\d{2}$/u), zone: text(60).min(1) })
    .optional(),
  period: z.object({ from: CalendarDate, to: CalendarDate }).optional(),
  goals: z.enum(['none', 'context', 'scored']).optional(),
  participants: z
    .object({
      filter: z.array(ConditionIn).max(30),
      match: z.enum(['all', 'any']).optional(),
      include: z.array(ChoiceIn).max(5000),
      exclude: z.array(ChoiceIn).max(5000),
      keepInStep: z.boolean(),
    })
    .optional(),
  activities: z
    .object({
      self: ActivityIn,
      manager: ActivityIn,
      peer: ActivityIn,
      upward: ActivityIn,
      skip: ActivityIn,
      goals: ActivityIn,
    })
    .optional(),
  peer: z
    .object({
      picker: z.enum(['subject', 'manager', 'hr']),
      min: z.int().min(0).max(20),
      max: z.int().min(1).max(20),
      approval: z.boolean(),
      declineReplace: z.boolean(),
      all: z.boolean(),
      perReviewerMax: z.int().min(1).max(50),
    })
    .refine((p) => p.min <= p.max, 'The minimum is above the maximum')
    .optional(),
  nominations: DeadlineIn.optional(),
  visibility: z
    .object({
      peerNames: z.enum(['hidden', 'shown', 'writer']),
      upwardNames: z.enum(['hidden', 'shown', 'writer']),
      minimum: z.int().min(1).max(20),
      release: z.object({
        mode: z.enum(['manager', 'hr_date', 'close']),
        date: CalendarDate.nullable(),
      }),
      acknowledge: z.boolean(),
      subjectComment: z.boolean(),
      peerSummary: z.boolean(),
    })
    .optional(),
  reminders: RemindersIn.optional(),
});
const KeyResultIn = z.object({
  title: text(200).min(1),
  measure: z.enum(['number', 'percentage', 'currency', 'done']),
  start: z.number(),
  target: z.number(),
  current: z.number(),
  unit: text(20).nullable(),
  weight: z.int().min(0).max(100).nullable(),
  linked: text(200).nullable(),
});
const GoalIn = z.object({
  title: text(200).min(1),
  description: text(4000),
  ownerId: Id.nullable(),
  ownerKind: z.enum(['person', 'team', 'company']),
  periodId: text(40).min(1),
  parentId: Id.nullable(),
  weight: z.int().min(0).max(100).nullable(),
  commitment: z.enum(['committed', 'aspirational']),
  keyResults: z.array(KeyResultIn).min(1).max(10),
  /** Who sees it: the owner and their managers (the default), their team too, or everyone. */
  visibility: z.enum(['owner', 'team', 'everyone']).optional(),
});
const ItemIn = z.object({
  title: text(200).min(1),
  kind: z.enum(['course', 'path', 'session', 'document', 'link', 'quiz', 'recording']),
  provider: text(60).min(1),
  minutes: z.int().min(0).max(10_000),
  parts: z
    .array(
      z.object({ id: text(40).min(1), title: text(200).min(1), minutes: z.int().min(0).max(1000) }),
    )
    .max(50),
  acknowledgement: text(400).nullable(),
  quiz: z.object({ definition: FormDefinition, passMark: z.int().min(0).max(100) }).nullable(),
  recursMonths: z.int().min(1).max(60).nullable(),
  certificateYears: z.int().min(1).max(20).nullable(),
  sessions: z
    .array(
      z.object({
        id: Id.nullable(),
        start: z.iso.datetime({ offset: true }),
        end: z.iso.datetime({ offset: true }),
        place: text(200).nullable(),
        online: text(400).nullable(),
      }),
    )
    .max(20),
  skills: z.array(text(40)).max(20),
  url: z.url().nullable(),
});
const AutomationIn = z.object({
  name: text(200).min(1),
  trigger: z.union([
    z.object({
      kind: z.literal('calendar'),
      every: z.enum(['quarter', 'half', 'year']),
      startMonth: z.int().min(1).max(12),
      leadDays: z.int().min(0).max(90),
    }),
    z.object({
      kind: z.literal('event'),
      event: z.enum(['hired', 'probation_end', 'anniversary']),
      offsetDays: z.int().min(0).max(730),
      repeatDays: z.int().min(0).max(730),
      times: z.int().min(1).max(6),
      group: z.enum(['week', 'person']),
      leadDays: z.int().min(0).max(90),
    }),
  ]),
  activities: z.array(ActivityKind).min(1),
  templates: z.record(z.string(), Id),
  dueDays: z.record(z.string(), z.int().min(0).max(365)),
  skip: z.array(z.enum(['on_leave', 'in_review', 'probation'])),
  paused: z.boolean(),
});
const MemberIn = z.object({
  personId: PersonId,
  accountId: Id.nullable(),
  displayName: text(200).min(1),
  workEmail: z.email().nullable(),
  managerPersonId: PersonId.nullable(),
  status: z.enum(['active', 'terminated']),
  title: text(200).nullable(),
  department: text(120).nullable(),
  hiredOn: CalendarDate.nullable(),
  /** A leaver's last working day, where retention counts from. */
  leftOn: CalendarDate.nullable().optional(),
});

const RunBody = z.object({
  steps: z
    .array(
      z.object({
        route: z.string().max(80),
        params: z.record(z.string(), z.unknown()),
        body: z.unknown(),
      }),
    )
    .min(1)
    .max(10),
});

export const ROUTES: readonly Route[] = [
  /* ------------------------------------------------------------- shell -- */
  route({
    name: 'performanceViewer',
    method: 'GET',
    path: `${V1}/viewer`,
    summary: 'Who the viewer is to Performance, for the shell',
    run: (ctx) => okOf(home.viewer(ctx)),
  }),
  route({
    name: 'performanceInbox',
    method: 'GET',
    path: `${V1}/inbox`,
    summary: 'The Inbox: Performance’s items for me',
    answer: InboxAnswer,
    run: async (ctx) => ok({ items: await home.inbox(ctx) }),
  }),
  route({
    name: 'performanceHome',
    method: 'GET',
    path: `${V1}/home`,
    summary: 'PF1: home',
    run: (ctx) => home.homeScreen(ctx),
  }),
  route({
    name: 'performanceDirectory',
    method: 'GET',
    path: `${V1}/people`,
    summary: 'People to pick',
    params: z.object({ q: z.string().max(100).optional() }),
    run: (ctx, { params }) => okOf(home.directory(ctx, params.q ?? '')),
  }),
  route({
    name: 'performancePerson',
    method: 'GET',
    path: `${V1}/people/{personId}`,
    summary: 'X2: a person’s Performance summary',
    params: z.object({ personId: Id }),
    run: (ctx, { params }) => analytics.personSummary(ctx, params.personId),
  }),
  route({
    name: 'performanceRecipient',
    method: 'GET',
    path: `${V1}/people/{personId}/recipient`,
    summary: 'Who feedback to a person reaches',
    params: z.object({ personId: Id }),
    run: (ctx, { params }) => feedback.recipientScreen(ctx, params.personId),
  }),
  route({
    name: 'importPerformanceMembers',
    method: 'POST',
    path: `${V1}/members/import`,
    summary: 'Members from another HR system, without People',
    body: z.object({ members: z.array(MemberIn).max(5000) }),
    run: (ctx, { body }) => importMembers(ctx, body.members),
  }),

  /* --------------------------------------------------------- templates -- */
  route({
    name: 'performanceTemplates',
    method: 'GET',
    path: `${V1}/templates`,
    summary: 'PF3: templates',
    params: z.object({ q: z.string().max(100).optional(), show: z.string().max(20).optional() }),
    run: (ctx, { params }) => okOf(templates.templatesScreen(ctx, params)),
  }),
  route({
    name: 'performanceTemplate',
    method: 'GET',
    path: `${V1}/templates/{id}`,
    summary: 'PF2: the builder',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => templates.templateScreen(ctx, params.id),
  }),
  route({
    name: 'performanceTemplatePreview',
    method: 'GET',
    path: `${V1}/templates/{id}/preview`,
    summary: 'PF2b: the form as one reader sees it',
    params: z.object({
      id: Id,
      version: z.coerce.number().int().min(1).optional(),
      as: z.enum(['reviewer', 'subject', 'calibrator']).optional(),
      activity: FormActivity.optional(),
    }),
    run: (ctx, { params }) =>
      templates.previewScreen(ctx, params.id, {
        ...(params.version === undefined ? {} : { version: params.version }),
        ...(params.as === undefined ? {} : { as: params.as }),
        ...(params.activity === undefined ? {} : { activity: params.activity }),
      }),
  }),
  route({
    name: 'performanceTemplateHistory',
    method: 'GET',
    path: `${V1}/templates/{id}/history`,
    summary: 'PF2c: versions and what changed',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => templates.historyScreen(ctx, params.id),
  }),
  route({
    name: 'performancePublishImpact',
    method: 'GET',
    path: `${V1}/templates/{id}/impact`,
    summary: 'PF2d: which cycles a publish moves',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => okOf(templates.publishImpact(ctx, params.id)),
  }),
  route({
    name: 'createPerformanceTemplate',
    method: 'POST',
    path: `${V1}/templates`,
    summary: 'A new template',
    status: 201,
    body: z.object({
      name: text(200).min(1),
      purpose: z.array(FormActivity).min(1).max(8),
      definition: FormDefinition.nullable(),
    }),
    run: (ctx, { body }) => templates.newTemplate(ctx, body),
  }),
  route({
    name: 'savePerformanceTemplate',
    method: 'PUT',
    path: `${V1}/templates/{id}`,
    summary: 'Save the draft',
    params: z.object({ id: Id }),
    body: z.object({
      name: text(200).min(1).optional(),
      purpose: z.array(FormActivity).min(1).max(8).optional(),
      definition: FormDefinition,
    }),
    run: (ctx, { params, body }) =>
      templates.saveTemplate(ctx, params.id, {
        definition: body.definition,
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.purpose === undefined ? {} : { purpose: body.purpose }),
      }),
  }),
  route({
    name: 'publishPerformanceTemplate',
    method: 'POST',
    path: `${V1}/templates/{id}/publish`,
    summary: 'Publish the draft',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => templates.publishTemplate(ctx, params.id),
  }),
  route({
    name: 'archivePerformanceTemplate',
    method: 'POST',
    path: `${V1}/templates/{id}/archive`,
    summary: 'Archive or unarchive',
    params: z.object({ id: Id }),
    body: z.object({ archived: z.boolean() }),
    run: (ctx, { params, body }) => templates.archiveTemplate(ctx, params.id, body.archived),
  }),
  route({
    name: 'deletePerformanceTemplate',
    method: 'DELETE',
    path: `${V1}/templates/{id}`,
    summary: 'Delete a template no cycle used',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => templates.deleteTemplate(ctx, params.id),
  }),
  route({
    name: 'duplicatePerformanceTemplate',
    method: 'POST',
    path: `${V1}/templates/{id}/duplicate`,
    summary: 'Copy a template',
    params: z.object({ id: Id }),
    body: z.object({ version: z.int().min(1).nullable() }),
    run: (ctx, { params, body }) =>
      templates.duplicateTemplate(ctx, params.id, body.version ?? undefined),
  }),
  route({
    name: 'restorePerformanceVersion',
    method: 'POST',
    path: `${V1}/templates/{id}/restore`,
    summary: 'A version back into the draft',
    params: z.object({ id: Id }),
    body: z.object({ version: z.int().min(1) }),
    run: (ctx, { params, body }) => templates.restoreVersion(ctx, params.id, body.version),
  }),
  route({
    name: 'writePerformanceTemplate',
    method: 'POST',
    path: `${V1}/ai/templates/write`,
    summary: 'PF2f: write a template with AI',
    body: z.object({ description: text(2000).min(5) }),
    run: (ctx, { body }) => ai.writeTemplate(ctx, body.description),
  }),
  route({
    name: 'checkPerformanceTemplate',
    method: 'POST',
    path: `${V1}/ai/templates/{id}/check`,
    summary: 'PF2e: check a form',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => ai.checkTemplate(ctx, params.id),
  }),
  route({
    name: 'translatePerformanceTemplate',
    method: 'POST',
    path: `${V1}/ai/templates/{id}/translate`,
    summary: 'PF2e: translate a form',
    params: z.object({ id: Id }),
    body: z.object({ language: text(40).min(2) }),
    run: (ctx, { params, body }) => ai.translateTemplate(ctx, params.id, body.language),
  }),

  /* ------------------------------------------------------------ cycles -- */
  route({
    name: 'performanceCycles',
    method: 'GET',
    path: `${V1}/cycles`,
    summary: 'PF6: cycles',
    params: z.object({ q: z.string().max(100).optional(), state: z.string().max(20).optional() }),
    run: (ctx, { params }) => okOf(cycles.cyclesScreen(ctx, params)),
  }),
  route({
    name: 'performanceCycle',
    method: 'GET',
    path: `${V1}/cycles/{id}`,
    summary: 'PF5: the overview',
    params: z.object({
      id: Id,
      q: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).optional(),
      size: z.coerce.number().int().min(10).max(200).optional(),
      tab: z.string().max(20).optional(),
    }),
    run: (ctx, { params }) =>
      cycles.overviewScreen(ctx, params.id, {
        ...(params.q === undefined ? {} : { q: params.q }),
        ...(params.page === undefined ? {} : { page: params.page }),
        ...(params.size === undefined ? {} : { size: params.size }),
        ...(params.tab === undefined ? {} : { tab: params.tab }),
      }),
  }),
  route({
    name: 'performanceCycleSetup',
    method: 'GET',
    path: `${V1}/cycles/{id}/setup`,
    summary: 'PF4: setup',
    params: z.object({ id: Id, q: z.string().max(100).optional() }),
    run: (ctx, { params }) => cycles.setupScreen(ctx, params.id, params.q),
  }),
  route({
    name: 'performanceUnlocks',
    method: 'GET',
    path: `${V1}/unlocks`,
    summary: 'PF20: unlock requests',
    run: (ctx) => cycles.unlocksScreen(ctx),
  }),
  route({
    name: 'createPerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles`,
    summary: 'A new cycle, or a copy',
    status: 201,
    body: z.object({
      name: text(200).min(1),
      start: CalendarDate.nullable(),
      copyFrom: Id.nullable(),
    }),
    run: (ctx, { body }) => cycles.createCycle(ctx, body),
  }),
  route({
    name: 'savePerformanceCycle',
    method: 'PATCH',
    path: `${V1}/cycles/{id}`,
    summary: 'A setup step saved',
    params: z.object({ id: Id }),
    body: CyclePatch,
    run: (ctx, { params, body }) => cycles.saveCycle(ctx, params.id, body as never),
  }),
  route({
    name: 'startPerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/start`,
    summary: 'Schedule or launch',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => cycles.scheduleOrLaunch(ctx, params.id),
  }),
  route({
    name: 'unschedulePerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/unschedule`,
    summary: 'Back to draft',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => cycles.unschedule(ctx, params.id),
  }),
  route({
    name: 'retryPerformanceLaunch',
    method: 'POST',
    path: `${V1}/cycles/{id}/retry`,
    summary: 'Retry a failed launch',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => cycles.retryLaunch(ctx, params.id),
  }),
  route({
    name: 'closePerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/close`,
    summary: 'PF5g: close',
    params: z.object({ id: Id }),
    body: z.object({ releaseNow: z.boolean() }),
    run: (ctx, { params, body }) => cycles.closeCycle(ctx, params.id, body.releaseNow),
  }),
  route({
    name: 'archivePerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/archive`,
    summary: 'Archive or unarchive',
    params: z.object({ id: Id }),
    body: z.object({ archived: z.boolean() }),
    run: (ctx, { params, body }) => cycles.archiveCycle(ctx, params.id, body.archived),
  }),
  route({
    name: 'addPerformanceParticipant',
    method: 'POST',
    path: `${V1}/cycles/{id}/participants`,
    summary: 'PF5d: add someone',
    params: z.object({ id: Id }),
    body: z.object({ personId: Id, reason: text(300).nullable() }),
    run: (ctx, { params, body }) =>
      cycles.addParticipant(ctx, params.id, body.personId, body.reason),
  }),
  route({
    name: 'removePerformanceParticipant',
    method: 'POST',
    path: `${V1}/cycles/{id}/participants/remove`,
    summary: 'PF5e: remove someone',
    params: z.object({ id: Id }),
    body: z.object({ personId: Id, reason: text(300).nullable() }),
    run: (ctx, { params, body }) =>
      cycles.removeParticipant(ctx, params.id, body.personId, body.reason),
  }),
  route({
    name: 'extendPerformanceDeadline',
    method: 'POST',
    path: `${V1}/cycles/{id}/extend`,
    summary: 'PF5b: extend a deadline',
    params: z.object({ id: Id }),
    body: z.object({
      kind: ActivityKind,
      personIds: z.array(Id).max(5000),
      due: CalendarDate,
      reason: text(300),
    }),
    run: (ctx, { params, body }) => cycles.extendDeadline(ctx, params.id, body),
  }),
  route({
    name: 'remindPerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/remind`,
    summary: 'Remind by hand',
    params: z.object({ id: Id }),
    body: z.object({ personIds: z.array(Id).max(5000) }),
    run: (ctx, { params, body }) => cycles.remind(ctx, params.id, body.personIds),
  }),
  route({
    name: 'releasePerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/release`,
    summary: 'HR releases',
    params: z.object({ id: Id }),
    body: z.object({ personIds: z.array(Id).max(5000) }),
    run: (ctx, { params, body }) => cycles.releaseFor(ctx, params.id, body.personIds),
  }),
  route({
    name: 'exportPerformanceCycle',
    method: 'POST',
    path: `${V1}/cycles/{id}/export`,
    summary: 'PF5h: the reviews as one PDF, or a zip of a PDF each',
    params: z.object({ id: Id }),
    body: z.object({
      full: z.boolean(),
      kinds: z.array(ActivityKind).max(6),
      format: z.enum(['pdf', 'zip']).default('pdf'),
    }),
    run: (ctx, { params, body }) => pdf.cyclePdf(ctx, params.id, body),
  }),
  route({
    name: 'handOverPerformanceReview',
    method: 'POST',
    path: `${V1}/reviews/{id}/hand-over`,
    summary: 'PF5f: a manager change',
    params: z.object({ id: Id }),
    body: z.object({
      choice: z.enum(['hand_over', 'old_finishes', 'restart']),
      to: Id,
      note: text(1000).nullable(),
    }),
    run: (ctx, { params, body }) => cycles.handOver(ctx, params.id, body),
  }),
  route({
    name: 'performanceParticipantsInWords',
    method: 'POST',
    path: `${V1}/ai/cycles/{id}/participants`,
    summary: 'PF4h: participants in words',
    params: z.object({ id: Id }),
    body: z.object({ text: text(1000).min(3) }),
    run: (ctx, { params, body }) => ai.participantsInWords(ctx, params.id, body.text),
  }),

  /* ------------------------------------------------------- nominations -- */
  route({
    name: 'performancePicker',
    method: 'GET',
    path: `${V1}/nominations/{id}`,
    summary: 'PF9b: pick peers',
    params: z.object({ id: Id, q: z.string().max(100).optional() }),
    run: (ctx, { params }) => reviews.pickerScreen(ctx, params.id, params.q ?? ''),
  }),
  route({
    name: 'nominatePerformancePeers',
    method: 'POST',
    path: `${V1}/nominations/{id}`,
    summary: 'Nominate',
    params: z.object({ id: Id }),
    body: z.object({ people: z.array(Id).max(20), note: text(1000).nullable() }),
    run: (ctx, { params, body }) => reviews.nominatePeers(ctx, params.id, body),
  }),
  route({
    name: 'decidePerformanceNominations',
    method: 'POST',
    path: `${V1}/nominations/{id}/decide`,
    summary: 'PF9c: approve, decline, replace',
    params: z.object({ id: Id }),
    body: z.object({
      decisions: z
        .array(z.object({ personId: Id, approve: z.boolean(), reason: text(300).nullable() }))
        .max(20),
      replacements: z.array(Id).max(20),
    }),
    run: (ctx, { params, body }) => reviews.decideNominations(ctx, params.id, body),
  }),

  /* ----------------------------------------------------------- reviews -- */
  route({
    name: 'performanceMyReviews',
    method: 'GET',
    path: `${V1}/reviews`,
    summary: 'PF13: my reviews',
    params: z.object({ tab: z.enum(['write', 'about', 'written', 'nominations']).optional() }),
    run: (ctx, { params }) => reviews.myReviews(ctx, params.tab ?? 'write'),
  }),
  route({
    name: 'performanceReview',
    method: 'GET',
    path: `${V1}/reviews/{id}`,
    summary: 'PF10: write a review',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => reviews.writeScreen(ctx, params.id),
  }),
  route({
    name: 'performanceReleased',
    method: 'GET',
    path: `${V1}/reviews/{id}/released`,
    summary: 'PF11b: a released review',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => reviews.releasedScreen(ctx, params.id),
  }),
  route({
    name: 'performanceReviewsAbout',
    method: 'GET',
    path: `${V1}/cycles/{cycleId}/about/{subjectId}`,
    summary: 'PF11: read and release',
    params: z.object({ cycleId: Id, subjectId: Id }),
    run: (ctx, { params }) => reviews.aboutScreen(ctx, params.cycleId, params.subjectId),
  }),
  route({
    name: 'performanceReviewPdf',
    method: 'GET',
    path: `${V1}/reviews/{id}/pdf`,
    summary: 'A review as PDF',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => pdf.reviewPdf(ctx, params.id),
  }),
  route({
    name: 'savePerformanceAnswers',
    method: 'PATCH',
    path: `${V1}/reviews/{id}/answers`,
    summary: 'Autosave',
    params: z.object({ id: Id }),
    body: z.object({ revision: z.int().min(0), answers: FormAnswers }),
    run: (ctx, { params, body }) => reviews.saveAnswers(ctx, params.id, body),
  }),
  route({
    name: 'submitPerformanceReview',
    method: 'POST',
    path: `${V1}/reviews/{id}/submit`,
    summary: 'PF12: submit',
    params: z.object({ id: Id }),
    body: z.object({
      confidential: z.boolean().nullable(),
      confirm: z.array(z.string().max(40)).max(100),
    }),
    run: (ctx, { params, body }) => reviews.submitReview(ctx, params.id, body),
  }),
  route({
    name: 'confirmPerformanceSuggestion',
    method: 'POST',
    path: `${V1}/reviews/{id}/suggestions/{questionId}`,
    summary: 'Confirm a suggested answer',
    params: z.object({ id: Id, questionId: z.string().max(40) }),
    run: (ctx, { params }) => reviews.confirmSuggestion(ctx, params.id, params.questionId),
  }),
  route({
    name: 'requestPerformanceUnlock',
    method: 'POST',
    path: `${V1}/reviews/{id}/unlock`,
    summary: 'PF20b: ask HR to unlock',
    params: z.object({ id: Id }),
    body: z.object({ reason: text(1000) }),
    run: (ctx, { params, body }) => reviews.requestUnlockOf(ctx, params.id, body.reason),
  }),
  route({
    name: 'withdrawPerformanceUnlock',
    method: 'POST',
    path: `${V1}/reviews/{id}/unlock/withdraw`,
    summary: 'Withdraw an unlock request',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => reviews.withdrawUnlockOf(ctx, params.id),
  }),
  route({
    name: 'decidePerformanceUnlock',
    method: 'POST',
    path: `${V1}/reviews/{id}/unlock/decide`,
    summary: 'PF20: HR decides',
    params: z.object({ id: Id }),
    body: z.object({ approve: z.boolean(), note: text(1000) }),
    run: (ctx, { params, body }) => reviews.decideUnlockOf(ctx, params.id, body),
  }),
  route({
    name: 'declinePerformanceReview',
    method: 'POST',
    path: `${V1}/reviews/{id}/decline`,
    summary: 'A peer declines',
    params: z.object({ id: Id }),
    body: z.object({ reason: text(500).min(3) }),
    run: (ctx, { params, body }) => reviews.declineReview(ctx, params.id, body.reason),
  }),
  route({
    name: 'keepPerformanceDetached',
    method: 'POST',
    path: `${V1}/reviews/{id}/detached`,
    summary: 'PF10f: keep or delete',
    params: z.object({ id: Id }),
    body: z.object({ keep: z.boolean() }),
    run: (ctx, { params, body }) => reviews.detachedChoice(ctx, params.id, body.keep),
  }),
  route({
    name: 'releasePerformanceSubject',
    method: 'POST',
    path: `${V1}/cycles/{cycleId}/about/{subjectId}/release`,
    summary: 'PF11: release to the subject',
    params: z.object({ cycleId: Id, subjectId: Id }),
    body: z.object({ acknowledge: z.boolean() }),
    run: (ctx, { params, body }) =>
      reviews.releaseToSubject(ctx, params.cycleId, params.subjectId, body.acknowledge),
  }),
  route({
    name: 'acknowledgePerformanceReview',
    method: 'POST',
    path: `${V1}/reviews/{id}/acknowledge`,
    summary: 'PF11b: acknowledge',
    params: z.object({ id: Id }),
    body: z.object({ comment: text(4000).nullable() }),
    run: (ctx, { params, body }) => reviews.acknowledge(ctx, params.id, body.comment),
  }),
  route({
    name: 'summarisePerformanceReview',
    method: 'POST',
    path: `${V1}/ai/reviews/{id}/summary`,
    summary: 'PF10b: summary with citations',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => ai.summarise(ctx, params.id),
  }),
  route({
    name: 'prefillPerformanceReview',
    method: 'POST',
    path: `${V1}/ai/reviews/{id}/prefill`,
    summary: 'PF10b: prefill',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => ai.prefill(ctx, params.id),
  }),
  route({
    name: 'performanceHowItReads',
    method: 'POST',
    path: `${V1}/ai/reviews/{id}/reads`,
    summary: 'PF10c: how it will read',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => ai.howItReads(ctx, params.id),
  }),
  route({
    name: 'performanceSentiment',
    method: 'POST',
    path: `${V1}/ai/sentiment`,
    summary: 'Sentence sentiment',
    body: z.object({ text: z.string().max(40_000), on: text(120) }),
    run: (ctx, { body }) => ai.sentiment(ctx, body.text, body.on),
  }),

  /* ---------------------------------------------------------- feedback -- */
  route({
    name: 'performanceFeedback',
    method: 'GET',
    path: `${V1}/feedback`,
    summary: 'PF14: feedback',
    params: z.object({ tab: z.enum(['received', 'sent', 'requests', 'praise']).optional() }),
    run: (ctx, { params }) => feedback.feedbackScreen(ctx, params.tab ?? 'received'),
  }),
  route({
    name: 'givePerformanceFeedback',
    method: 'POST',
    path: `${V1}/feedback`,
    summary: 'PF14b: give feedback',
    status: 201,
    body: z.object({
      to: Id,
      kind: z.enum(['feedback', 'praise']),
      body: z.string().max(20_000),
      audience: z.enum(['recipient', 'recipient_manager', 'manager_only', 'everyone']),
      showName: z.boolean(),
      value: text(40).nullable(),
      templateId: Id.nullable(),
      answers: FormAnswers.nullable(),
      requestId: Id.nullable(),
    }),
    run: (ctx, { body }) => feedback.giveFeedback(ctx, body),
  }),
  route({
    name: 'undoPerformanceFeedback',
    method: 'POST',
    path: `${V1}/feedback/{id}/undo`,
    summary: 'Undo within ten minutes',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => feedback.undoFeedback(ctx, params.id),
  }),
  route({
    name: 'requestPerformanceFeedback',
    method: 'POST',
    path: `${V1}/feedback/requests`,
    summary: 'PF14e: request feedback',
    status: 201,
    body: z.object({
      to: z.array(Id).min(1).max(10),
      about: Id.nullable(),
      question: text(1000).nullable(),
      templateId: Id.nullable(),
      topic: text(200).nullable(),
      due: CalendarDate.nullable(),
    }),
    run: (ctx, { body }) => feedback.requestFeedback(ctx, body),
  }),
  route({
    name: 'declinePerformanceRequest',
    method: 'POST',
    path: `${V1}/feedback/requests/{id}/decline`,
    summary: 'Decline a request',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => feedback.declineRequest(ctx, params.id),
  }),
  route({
    name: 'performanceToneCheck',
    method: 'POST',
    path: `${V1}/ai/tone`,
    summary: 'PF14b: tone check',
    body: z.object({ text: z.string().max(20_000) }),
    run: (ctx, { body }) => ai.toneCheck(ctx, body.text),
  }),

  /* ------------------------------------------------------------- notes -- */
  route({
    name: 'performanceNotes',
    method: 'GET',
    path: `${V1}/notes`,
    summary: 'PF21: notes',
    params: z.object({ about: Id.optional() }),
    run: (ctx, { params }) => feedback.notesScreen(ctx, params.about ?? null),
  }),
  route({
    name: 'savePerformanceNote',
    method: 'PUT',
    path: `${V1}/notes`,
    summary: 'Save a note',
    body: z.object({
      id: Id.nullable(),
      about: Id,
      title: text(200),
      body: z.string().max(20_000),
      shared: z.boolean(),
    }),
    run: (ctx, { body }) => feedback.saveNote(ctx, body),
  }),
  route({
    name: 'deletePerformanceNote',
    method: 'DELETE',
    path: `${V1}/notes/{id}`,
    summary: 'Delete a note',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => feedback.deleteNote(ctx, params.id),
  }),

  /* ------------------------------------------------------------- goals -- */
  route({
    name: 'performanceGoals',
    method: 'GET',
    path: `${V1}/goals`,
    summary: 'PF18: goals',
    params: z.object({
      tab: z.enum(['list', 'alignment', 'checkins']).optional(),
      period: z.string().max(40).optional(),
      scope: z.enum(['mine', 'team', 'company']).optional(),
      risk: flag,
    }),
    run: (ctx, { params }) =>
      goals.goalsScreen(ctx, {
        ...(params.tab === undefined ? {} : { tab: params.tab }),
        ...(params.period === undefined ? {} : { period: params.period }),
        ...(params.scope === undefined ? {} : { scope: params.scope }),
        risk: params.risk === 'true',
      }),
  }),
  route({
    name: 'performanceGoal',
    method: 'GET',
    path: `${V1}/goals/{id}`,
    summary: 'PF18b: a goal',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => goals.goalScreen(ctx, params.id),
  }),
  route({
    name: 'createPerformanceGoal',
    method: 'POST',
    path: `${V1}/goals`,
    summary: 'PF18c: a new goal',
    status: 201,
    body: GoalIn,
    run: (ctx, { body }) => goals.saveGoal(ctx, null, body),
  }),
  route({
    name: 'savePerformanceGoal',
    method: 'PUT',
    path: `${V1}/goals/{id}`,
    summary: 'Edit a goal',
    params: z.object({ id: Id }),
    body: GoalIn,
    run: (ctx, { params, body }) => goals.saveGoal(ctx, params.id, body),
  }),
  route({
    name: 'setPerformanceGoalVisibility',
    method: 'PUT',
    path: `${V1}/goals/{id}/visibility`,
    summary: 'Who sees a goal',
    params: z.object({ id: Id }),
    body: z.object({ visibility: z.enum(['owner', 'team', 'everyone']) }),
    run: (ctx, { params, body }) => goals.setGoalVisibility(ctx, params.id, body.visibility),
  }),
  route({
    name: 'setPerformanceGoalStatus',
    method: 'POST',
    path: `${V1}/goals/{id}/status`,
    summary: 'Complete, miss or cancel a goal',
    params: z.object({ id: Id }),
    body: z.object({ status: z.enum(['active', 'completed', 'missed', 'cancelled']) }),
    run: (ctx, { params, body }) => goals.setGoalStatus(ctx, params.id, body.status),
  }),
  route({
    name: 'checkInPerformanceGoal',
    method: 'POST',
    path: `${V1}/goals/{id}/check-ins`,
    summary: 'PF18e: check in',
    params: z.object({ id: Id }),
    body: z.object({
      values: z.record(z.string(), z.number()),
      confidence: z.enum(['on_track', 'at_risk', 'off_track']),
      note: text(2000).nullable(),
    }),
    run: (ctx, { params, body }) => goals.checkInGoal(ctx, params.id, body),
  }),
  route({
    name: 'performanceAttachGoals',
    method: 'GET',
    path: `${V1}/cycles/{id}/goals`,
    summary: 'PF18f: goals in a cycle',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => goals.attachScreen(ctx, params.id),
  }),
  route({
    name: 'attachPerformanceGoals',
    method: 'POST',
    path: `${V1}/cycles/{id}/goals`,
    summary: 'PF18f: attach goals',
    params: z.object({ id: Id }),
    body: z.object({ mode: z.enum(['none', 'context', 'scored']), people: z.array(Id).max(5000) }),
    run: (ctx, { params, body }) => goals.attachGoals(ctx, params.id, body),
  }),

  /* ---------------------------------------------------------- learning -- */
  route({
    name: 'performanceLearning',
    method: 'GET',
    path: `${V1}/learning`,
    summary: 'PF15: learning',
    params: z.object({ tab: z.enum(['assigned', 'catalogue', 'sessions']).optional() }),
    run: (ctx, { params }) => learning.learningScreen(ctx, params.tab ?? 'assigned'),
  }),
  route({
    name: 'performanceLearningItem',
    method: 'GET',
    path: `${V1}/learning/{id}`,
    summary: 'PF15b: an item',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => learning.itemScreen(ctx, params.id),
  }),
  route({
    name: 'performanceSession',
    method: 'GET',
    path: `${V1}/learning/{id}/sessions/{sessionId}`,
    summary: 'PF15d: a session',
    params: z.object({ id: Id, sessionId: Id }),
    run: (ctx, { params }) => learning.sessionScreen(ctx, params.id, params.sessionId),
  }),
  route({
    name: 'createPerformanceItem',
    method: 'POST',
    path: `${V1}/learning`,
    summary: 'A new learning item',
    status: 201,
    body: ItemIn,
    run: (ctx, { body }) => learning.saveItem(ctx, null, body as never),
  }),
  route({
    name: 'savePerformanceItem',
    method: 'PUT',
    path: `${V1}/learning/{id}`,
    summary: 'Edit a learning item',
    params: z.object({ id: Id }),
    body: ItemIn,
    run: (ctx, { params, body }) => learning.saveItem(ctx, params.id, body as never),
  }),
  route({
    name: 'assignPerformanceLearning',
    method: 'POST',
    path: `${V1}/learning/{id}/assign`,
    summary: 'PF15c: assign',
    params: z.object({ id: Id }),
    body: z.object({
      people: z.array(Id).max(5000),
      filter: z.array(ConditionIn).max(20),
      cycleId: Id.nullable(),
      due: CalendarDate.nullable(),
      why: text(200),
    }),
    run: (ctx, { params, body }) => learning.assign(ctx, params.id, body),
  }),
  route({
    name: 'markPerformancePart',
    method: 'POST',
    path: `${V1}/assignments/{id}/parts/{partId}`,
    summary: 'A part done',
    params: z.object({ id: Id, partId: z.string().max(40) }),
    run: (ctx, { params }) => learning.markLearningPart(ctx, params.id, params.partId),
  }),
  route({
    name: 'acknowledgePerformanceLearning',
    method: 'POST',
    path: `${V1}/assignments/{id}/acknowledge`,
    summary: 'Acknowledge an item',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => learning.acknowledgeLearning(ctx, params.id),
  }),
  route({
    name: 'submitPerformanceQuiz',
    method: 'POST',
    path: `${V1}/assignments/{id}/quiz`,
    summary: 'PF15e: a quiz',
    params: z.object({ id: Id }),
    body: z.object({ answers: FormAnswers }),
    run: (ctx, { params, body }) => learning.submitQuiz(ctx, params.id, body.answers),
  }),
  route({
    name: 'respondPerformanceSession',
    method: 'POST',
    path: `${V1}/assignments/{id}/sessions/{sessionId}`,
    summary: 'Answer an invitation',
    params: z.object({ id: Id, sessionId: Id }),
    body: z.object({ invitation: z.enum(['accepted', 'tentative', 'declined']) }),
    run: (ctx, { params, body }) =>
      learning.respondSession(ctx, params.id, params.sessionId, body.invitation),
  }),
  route({
    name: 'scanPerformanceSession',
    method: 'POST',
    path: `${V1}/attendance/scan`,
    summary: 'PFM8b: scan the door’s code',
    body: z.object({ code: text(40).min(4) }),
    run: (ctx, { body }) => learning.scanSession(ctx, body.code),
  }),
  route({
    name: 'markPerformanceAttendance',
    method: 'POST',
    path: `${V1}/assignments/{id}/attendance`,
    summary: 'Attendance by hand',
    params: z.object({ id: Id }),
    body: z.object({ sessionId: Id, attended: z.boolean() }),
    run: (ctx, { params, body }) =>
      learning.markAttendance(ctx, params.id, body.sessionId, body.attended),
  }),
  route({
    name: 'importPerformanceCompletions',
    method: 'POST',
    path: `${V1}/learning/completions`,
    summary: 'Completions from a CSV',
    body: z.object({ csv: z.string().max(2_000_000) }),
    run: (ctx, { body }) => learning.importCompletions(ctx, body.csv),
  }),
  route({
    name: 'performanceLearningSuggestions',
    method: 'POST',
    path: `${V1}/ai/learning/{personId}`,
    summary: 'Learning suggestions',
    params: z.object({ personId: Id }),
    run: (ctx, { params }) => ai.learningSuggestions(ctx, params.personId),
  }),

  /* ------------------------------------------------------- automations -- */
  route({
    name: 'performanceAutomations',
    method: 'GET',
    path: `${V1}/automations`,
    summary: 'PF16: automations',
    run: (ctx) => automations.automationsScreen(ctx),
  }),
  route({
    name: 'performanceAutomation',
    method: 'GET',
    path: `${V1}/automations/{id}`,
    summary: 'PF16c: one automation',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => automations.automationScreen(ctx, params.id),
  }),
  route({
    name: 'createPerformanceAutomation',
    method: 'POST',
    path: `${V1}/automations`,
    summary: 'PF16b: a new automation',
    status: 201,
    body: AutomationIn,
    run: (ctx, { body }) => automations.saveAutomation(ctx, null, body as never),
  }),
  route({
    name: 'savePerformanceAutomation',
    method: 'PUT',
    path: `${V1}/automations/{id}`,
    summary: 'Edit an automation',
    params: z.object({ id: Id }),
    body: AutomationIn,
    run: (ctx, { params, body }) => automations.saveAutomation(ctx, params.id, body as never),
  }),
  route({
    name: 'pausePerformanceAutomation',
    method: 'POST',
    path: `${V1}/automations/{id}/pause`,
    summary: 'Pause or turn on',
    params: z.object({ id: Id }),
    body: z.object({ paused: z.boolean() }),
    run: (ctx, { params, body }) => automations.pauseAutomation(ctx, params.id, body.paused),
  }),
  route({
    name: 'deletePerformanceAutomation',
    method: 'DELETE',
    path: `${V1}/automations/{id}`,
    summary: 'Delete an automation',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => automations.deleteAutomation(ctx, params.id),
  }),
  route({
    name: 'performanceAutomationInWords',
    method: 'POST',
    path: `${V1}/ai/automations`,
    summary: 'PF16d: an automation in words',
    body: z.object({ text: text(2000).min(5) }),
    run: (ctx, { body }) => ai.automationInWords(ctx, body.text),
  }),

  /* ------------------------------------------------------- calibration -- */
  route({
    name: 'performanceCalibrations',
    method: 'GET',
    path: `${V1}/calibration`,
    summary: 'PF19: sessions',
    run: (ctx) => calibration.sessionsScreen(ctx),
  }),
  route({
    name: 'performanceCalibration',
    method: 'GET',
    path: `${V1}/calibration/{id}`,
    summary: 'PF19b: a session',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => calibration.sessionScreen(ctx, params.id),
  }),
  route({
    name: 'createPerformanceCalibration',
    method: 'POST',
    path: `${V1}/calibration`,
    summary: 'A new session',
    status: 201,
    body: z.object({
      name: text(200).min(1),
      cycleId: Id,
      calibrators: z.array(Id).max(20),
      subjects: z.array(Id).max(5000),
      department: text(120).nullable(),
      meetsOn: CalendarDate.nullable(),
    }),
    run: (ctx, { body }) => calibration.createSession(ctx, body),
  }),
  route({
    name: 'changePerformanceScore',
    method: 'POST',
    path: `${V1}/calibration/{id}/changes`,
    summary: 'PF19c: change a score',
    params: z.object({ id: Id }),
    body: z.object({ personId: Id, now: z.int().min(0).max(10_000), reason: text(1000) }),
    run: (ctx, { params, body }) => calibration.changeCalibratedScore(ctx, params.id, body),
  }),
  route({
    name: 'finalisePerformanceCalibration',
    method: 'POST',
    path: `${V1}/calibration/{id}/finalise`,
    summary: 'PF19d: finalise',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => calibration.finaliseSession(ctx, params.id),
  }),
  route({
    name: 'removePerformanceCalibrationSubject',
    method: 'POST',
    path: `${V1}/calibration/{id}/remove`,
    summary: 'Take someone out',
    params: z.object({ id: Id }),
    body: z.object({ personId: Id }),
    run: (ctx, { params, body }) => calibration.removeFromSession(ctx, params.id, body.personId),
  }),
  route({
    name: 'performanceCalibrationSuggestions',
    method: 'POST',
    path: `${V1}/ai/calibration/{id}`,
    summary: 'PF19e: AI suggestions',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => ai.calibrationSuggestions(ctx, params.id),
  }),

  /* --------------------------------------------------------- analytics -- */
  route({
    name: 'performanceAnalytics',
    method: 'GET',
    path: `${V1}/analytics`,
    summary: 'PF7: analytics',
    params: z.object({
      tab: z.enum(['cycle', 'raters', 'trends', 'fairness', 'ask']).optional(),
      cycleId: Id.optional(),
      personId: Id.optional(),
    }),
    run: (ctx, { params }) =>
      analytics.analyticsScreen(ctx, {
        ...(params.tab === undefined ? {} : { tab: params.tab }),
        ...(params.cycleId === undefined ? {} : { cycleId: params.cycleId }),
        ...(params.personId === undefined ? {} : { personId: params.personId }),
      }),
  }),
  route({
    name: 'askPerformanceChart',
    method: 'POST',
    path: `${V1}/ai/charts`,
    summary: 'PF8: ask for a chart',
    body: z.object({ question: text(500).min(3), cycleId: Id.nullable() }),
    run: (ctx, { body }) => ai.askChart(ctx, body.question, body.cycleId),
  }),
  route({
    name: 'savePerformanceChart',
    method: 'POST',
    path: `${V1}/charts`,
    summary: 'Save a chart to the dashboard',
    body: z.object({ title: text(120).min(1), plan: z.unknown() }),
    run: (ctx, { body }) => ai.saveChart(ctx, body),
  }),

  /* ---------------------------------------------------------- retention -- */
  route({
    name: 'performanceRetention',
    method: 'GET',
    path: `${V1}/retention`,
    summary: 'S10: what is due to go, the holds and what comes next',
    run: (ctx) => retention.retentionScreen(ctx),
  }),
  route({
    name: 'confirmPerformanceRetention',
    method: 'POST',
    path: `${V1}/retention/delete`,
    summary: 'HR confirms a batch: the due records of these people go',
    body: z.object({ personIds: z.array(Id).min(1).max(500) }),
    run: (ctx, { body }) => retention.confirmRetention(ctx, body.personIds),
  }),
  route({
    name: 'placePerformanceHold',
    method: 'POST',
    path: `${V1}/holds`,
    summary: 'A legal hold on a person’s records',
    status: 201,
    body: z.object({ personId: Id, reason: text(300).min(1) }),
    run: (ctx, { body }) => retention.placeHold(ctx, body.personId, body.reason),
  }),
  route({
    name: 'liftPerformanceHold',
    method: 'POST',
    path: `${V1}/holds/{id}/lift`,
    summary: 'Lift a legal hold',
    params: z.object({ id: Id }),
    body: z.object({ reason: text(300).nullable() }),
    run: (ctx, { params, body }) => retention.liftHold(ctx, params.id, body.reason),
  }),
  route({
    name: 'exportPerformancePerson',
    method: 'POST',
    path: `${V1}/people/{id}/export`,
    summary: 'A person’s data, for their request (DSAR)',
    params: z.object({ id: Id }),
    body: z.object({}),
    run: (ctx, { params }) => retention.personExport(ctx, params.id),
  }),

  /* ----------------------------------------------------------- webhooks -- */
  route({
    name: 'performanceWebhooks',
    method: 'GET',
    path: `${V1}/webhooks`,
    summary: 'S8b: webhook endpoints and their deliveries',
    run: (ctx) => webhooks.webhooksScreen(ctx),
  }),
  route({
    name: 'addPerformanceWebhook',
    method: 'POST',
    path: `${V1}/webhooks`,
    summary: 'A webhook endpoint, its secret shown once',
    status: 201,
    body: z.object({ url: z.url().max(2000), events: z.array(text(80)).max(40) }),
    run: (ctx, { body }) => webhooks.addWebhook(ctx, body),
  }),
  route({
    name: 'changePerformanceWebhook',
    method: 'PATCH',
    path: `${V1}/webhooks/{id}`,
    summary: 'A webhook endpoint’s events, or on or off',
    params: z.object({ id: Id }),
    body: z.object({ events: z.array(text(80)).max(40).optional(), on: z.boolean().optional() }),
    run: (ctx, { params, body }) => webhooks.changeWebhook(ctx, params.id, body),
  }),
  route({
    name: 'rotatePerformanceWebhook',
    method: 'POST',
    path: `${V1}/webhooks/{id}/rotate`,
    summary: 'A new webhook secret; the old one signs for a day',
    params: z.object({ id: Id }),
    body: z.object({}),
    run: (ctx, { params }) => webhooks.rotateWebhook(ctx, params.id),
  }),
  route({
    name: 'testPerformanceWebhook',
    method: 'POST',
    path: `${V1}/webhooks/{id}/test`,
    summary: 'Send a webhook endpoint a signed test',
    params: z.object({ id: Id }),
    body: z.object({}),
    run: (ctx, { params }) => webhooks.testWebhook(ctx, params.id),
  }),
  route({
    name: 'removePerformanceWebhook',
    method: 'DELETE',
    path: `${V1}/webhooks/{id}`,
    summary: 'Remove a webhook endpoint',
    params: z.object({ id: Id }),
    run: (ctx, { params }) => webhooks.removeWebhook(ctx, params.id),
  }),

  /* ----------------------------------------------------------- settings -- */
  route({
    name: 'performanceSettings',
    method: 'GET',
    path: `${V1}/settings`,
    summary: 'S1–S10: settings',
    run: (ctx) => home.settingsScreen(ctx),
  }),
  route({
    name: 'savePerformanceSettings',
    method: 'PUT',
    path: `${V1}/settings/{section}`,
    summary: 'Save a settings section',
    params: z.object({ section: z.string().max(40) }),
    body: z.unknown(),
    run: (ctx, { params, body }) => saveSection(ctx, params.section, body),
  }),
  route({
    name: 'performanceAiLog',
    method: 'GET',
    path: `${V1}/ai/log`,
    summary: 'S7b: the AI output log',
    run: (ctx) => ai.aiLogScreen(ctx),
  }),
  route({
    name: 'performanceConnectedTools',
    method: 'GET',
    path: `${V1}/me/tools`,
    summary: 'S12: my connected tools',
    run: (ctx) => home.connectedTools(ctx),
  }),
  route({
    name: 'setPerformanceGrant',
    method: 'PUT',
    path: `${V1}/me/tools/{source}`,
    summary: 'Grant or revoke a source',
    params: z.object({ source: z.string().max(20) }),
    body: z.object({ on: z.boolean() }),
    run: (ctx, { params, body }) => home.setGrant(ctx, params.source, body.on),
  }),

  /* ----------------------------------------------------- Ask Kithena -- */
  route({
    name: 'performanceAsk',
    method: 'POST',
    path: `${V1}/ai/ask`,
    summary: 'X6: what Ask Kithena would do, as proposals',
    body: z.object({ text: text(2000).min(2), path: z.string().max(200).nullable() }),
    run: async (ctx, { body }) => plan(ctx, body.text, body.path),
  }),
  // Answered by `runPlan` before routing; listed so the subgraph and OpenAPI carry it.
  route({
    name: 'runPerformanceAsk',
    method: 'POST',
    path: `${V1}/ai/ask/run`,
    summary: 'X6: run a confirmed plan, as the person',
    body: RunBody,
    run: () => Promise.resolve(err(failure('UNAVAILABLE', 'Run through the dispatcher'))),
  }),
];

/* ------------------------------------------------- Ask Kithena's plans -- */

const Step = z.object({
  route: z.string().max(80),
  params: z.record(z.string(), z.unknown()),
  body: z.unknown(),
  summary: z.string().max(300),
});

/**
 * X6 (PRD §22.1): the model plans any write the person could run, by route
 * name and arguments; each step is checked against its route's schemas and
 * shown with what it will do. Nothing runs until the person confirms, and
 * then each step runs as them, through the same routes, audited as "Ask
 * Kithena for …" (`runPlan`).
 */
export async function plan(
  ctx: Ctx,
  request: string,
  path: string | null,
): Promise<Result<unknown>> {
  const writes = ROUTES.filter((r) => r.method !== 'GET' && !r.path.includes('/ai/'));
  const directory = (await ctx.members()).map((m) => ({ id: m.personId, name: m.displayName }));
  const recentCycles = (await ctx.tx.cycles.find()).map((c) => ({
    id: c.id,
    name: c.name,
    state: c.state,
  }));
  const model = ctx.deps.model;
  if (model === undefined || !(await aiOn(ctx, 'panel'))) return err(ai.aiOff());
  const raw = await model.complete(ctx.caller.tenantId, {
    instruction:
      'You are Ask Kithena inside Performance. Plan the writes that do what the person asks, using only these routes. ' +
      'Return JSON {"reply":"one sentence","steps":[{"route","params":{},"body":{},"summary":"what it does, in words"}]}. Use ids from the lists.',
    context: {
      request,
      page: path,
      routes: writes.map((r) => ({
        name: r.name,
        summary: r.summary,
        path: r.path,
        body: r.body === null ? null : z.toJSONSchema(r.body, { unrepresentable: 'any' }),
      })),
      people: directory,
      cycles: recentCycles,
    },
  });
  let parsed: unknown = null;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const answer = z
    .object({ reply: z.string().max(500), steps: z.array(Step).max(10) })
    .safeParse(parsed);
  if (!answer.success)
    return err(failure('AI_UNAVAILABLE', 'Ask Kithena could not plan that just now'));
  const steps = answer.data.steps.flatMap((s) => {
    const r = writes.find((w) => w.name === s.route);
    if (
      r === undefined ||
      !r.params.safeParse(s.params).success ||
      (r.body !== null && !r.body.safeParse(s.body).success)
    )
      return [];
    return [{ ...s, method: r.method, path: r.path }];
  });
  return ok({ reply: answer.data.reply, steps, dropped: answer.data.steps.length - steps.length });
}

/* ---------------------------------------------------------- dispatch -- */

const STATUS: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  NOT_ENTITLED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  STALE_REVISION: 409,
  BAD_STATE: 409,
  LOCKED: 409,
  IDEMPOTENCY_KEY_REQUIRED: 428,
  AI_OFF: 503,
  AI_UNAVAILABLE: 503,
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

/** After a commit: mail sent, the live stream told, a launch the write began started. */
async function afterCommit(
  deps: Deps,
  caller: Caller,
  mail: readonly Outgoing[],
  touched: readonly string[],
): Promise<void> {
  await deliver(deps, caller.tenantId, mail);
  if (touched.length === 0) return;
  await tell(deps, caller.tenantId, touched);
  const launching = await deps.uow.run(caller.tenantId, async (tx) =>
    (await Promise.all(touched.map((id) => tx.cycles.get(id))))
      .filter((c) => c?.state === 'launching')
      .map((c) => c?.id ?? ''),
  );
  for (const id of launching) startLaunch(deps, caller.tenantId, id);
}

/** One transaction per request: the use case, its events, its key and its answer commit together. */
async function inTransaction(
  deps: Deps,
  caller: Caller,
  run: (ctx: Ctx) => Promise<Result<unknown>>,
  key: { readonly key: string; readonly hash: string; readonly status: number } | null,
): Promise<RestResponse | Result<unknown>> {
  const mail: Outgoing[] = [];
  let touched: string[] = [];
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
    const ctx = await contextOf(deps, tx, caller, mail);
    const answer = await run(ctx);
    if (answer.ok && key !== null)
      await tx.idempotency.put(
        key.key,
        key.hash,
        key.status,
        JSON.parse(JSON.stringify(answer.value ?? null)) as unknown,
      );
    if (answer.ok) touched = [...ctx.touched];
    return answer;
  });
  if (held.replay !== null) return held.replay;
  if (result.ok) await afterCommit(deps, caller, mail, touched);
  return result;
}

/** A refused write, in its own transaction, so the log keeps what the rolled-back one could not. */
async function auditRefusal(
  deps: Deps,
  caller: Caller,
  r: Route,
  why: DomainFailure,
): Promise<void> {
  if (r.method === 'GET' || ['NOT_FOUND', 'BAD_REQUEST', 'STALE_REVISION'].includes(why.code))
    return;
  try {
    await deps.uow.run(caller.tenantId, async (tx) => {
      const ctx = await contextOf(deps, tx, caller);
      await audit(ctx, {
        action: r.summary,
        target: r.name,
        outcome: 'refused',
        fields: [why.code],
      });
    });
  } catch {
    // The refusal itself stands; the log line is best effort.
  }
}

export function restHandler(
  rest: RestDeps,
): (request: RestRequest) => Promise<RestResponse | null> {
  const compiled = ROUTES.map(compile);
  const { deps } = rest;
  return async (request) => {
    const url = new URL(request.url, 'http://performance.internal');
    if (!url.pathname.startsWith(`${V1}/`)) return null;
    if (url.pathname === `${V1}/ai/ask/run` && request.method === 'POST')
      return runPlan(rest, request);
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
    const params = parse(r.params, raw);
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
    const asked = await rest.callerFrom(request);
    if (!asked.ok) return refused(asked.error);
    const via = request.headers['x-performance-via'];
    const caller: Caller = { ...asked.value, ...(typeof via === 'string' ? { via } : {}) };
    let key: { key: string; hash: string; status: number } | null = null;
    if (r.method !== 'GET') {
      const given = request.headers['idempotency-key'];
      if (typeof given !== 'string' || given.length === 0 || given.length > 255)
        return refused(
          failure('IDEMPOTENCY_KEY_REQUIRED', 'Every write carries an Idempotency-Key header'),
        );
      const hash = createHash('sha256')
        .update(
          `${caller.accountId}\n${request.method} ${url.pathname}${url.search}\n${request.body}`,
        )
        .digest('hex');
      key = { key: given, hash, status: r.status };
    }
    const answer = await inTransaction(deps, caller, (ctx) => r.run(ctx, input), key);
    if ('status' in answer) return answer;
    if (!answer.ok) await auditRefusal(deps, caller, r, answer.error);
    return answer.ok ? { status: r.status, body: answer.value } : refused(answer.error);
  };
}

/**
 * The confirmed plan, run step by step through the routes as the person, each
 * audited "via Ask Kithena". A step refused stops the rest and says which.
 */
async function runPlan(rest: RestDeps, request: RestRequest): Promise<RestResponse> {
  let json: unknown;
  try {
    json = JSON.parse(request.body);
  } catch {
    return refused(failure('BAD_REQUEST', 'The body is not JSON'));
  }
  const parsed = RunBody.safeParse(json);
  if (!parsed.success) return refused(failure('BAD_REQUEST', 'Not a plan'));
  const asked = await rest.callerFrom(request);
  if (!asked.ok) return refused(asked.error);
  const dispatch = restHandler(rest);
  const done: { route: string; ok: boolean; message: string | null }[] = [];
  for (const [i, s] of parsed.data.steps.entries()) {
    const r = ROUTES.find(
      (x) => x.name === s.route && x.method !== 'GET' && !x.path.includes('/ai/'),
    );
    if (r === undefined) {
      done.push({ route: s.route, ok: false, message: 'Not something Ask Kithena can do' });
      break;
    }
    const path = r.path.replaceAll(/\{([a-zA-Z]+)\}/gu, (_m, n: string) => {
      const v = s.params[n];
      return encodeURIComponent(typeof v === 'string' || typeof v === 'number' ? String(v) : '');
    });
    const answer = await dispatch({
      method: r.method,
      url: path,
      headers: {
        ...request.headers,
        'idempotency-key': `${String(request.headers['idempotency-key'] ?? 'ask')}:${String(i)}`,
        'x-performance-via': 'Ask Kithena',
      },
      body: r.body === null ? '' : JSON.stringify(s.body ?? {}),
    });
    const passed = answer !== null && answer.status < 400;
    done.push({
      route: s.route,
      ok: passed,
      message: passed
        ? null
        : ((answer?.body as { error?: { message?: string } } | undefined)?.error?.message ??
          'Refused'),
    });
    if (!passed) break;
  }
  return { status: 200, body: { steps: done } };
}

/**
 * One route, as a caller who is not asking through the router: a button
 * pressed in the chat app (PRF-164). The same dispatch, so the same schemas,
 * the same idempotency (a second press is the first's answer) and the same
 * audit, the surface the caller's own.
 */
export async function runAs(
  deps: Deps,
  caller: Caller,
  route: string,
  params: Readonly<Record<string, unknown>>,
  body: unknown,
  key: string,
): Promise<{ readonly ok: boolean; readonly message: string | null }> {
  const r = ROUTES.find((x) => x.name === route && x.method !== 'GET');
  if (r === undefined)
    return { ok: false, message: 'Not something Performance does from a chat app' };
  const path = r.path.replaceAll(/\{([a-zA-Z]+)\}/gu, (_m, n: string) => {
    const v = params[n];
    return encodeURIComponent(typeof v === 'string' || typeof v === 'number' ? String(v) : '');
  });
  const answer = await restHandler({ deps, callerFrom: () => Promise.resolve(ok(caller)) })({
    method: r.method,
    url: path,
    headers: {
      'idempotency-key': key,
      ...(caller.via === undefined ? {} : { 'x-performance-via': caller.via }),
    },
    body: r.body === null ? '' : JSON.stringify(body ?? {}),
  });
  const passed = answer !== null && answer.status < 400;
  return {
    ok: passed,
    message: passed
      ? null
      : ((answer?.body as { error?: { message?: string } } | undefined)?.error?.message ??
        'Refused'),
  };
}

export type { UnitOfWork };
