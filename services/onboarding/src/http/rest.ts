import { createHash } from 'node:crypto';
import * as z from 'zod';
import { err, failure, ok, type DomainFailure, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  HireIntake,
  InboxAnswer,
  LaunchCountry,
  OnboardingActivityRecorded,
  OwnerRole,
  Phase,
  ProbationOutcome,
  routeActivity,
  TaskKind,
  TenantId,
  WorkMode,
  type ModuleActivity,
} from '@kithena/contracts';

import {
  contextOf,
  deliver,
  event,
  hrOnly,
  PUBLIC_ACCOUNT,
  type Ctx,
  type Outgoing,
} from '../application/context.js';
import {
  checkIn,
  completeByWelcome,
  completeTask,
  intake,
  moveStartDate,
  reopenTask,
  reviewProbation,
  setBuddy,
  welcomePage,
} from '../application/plans.js';
import {
  analyticsScreen,
  boardScreen,
  myTasks,
  onboardingInbox,
  planScreen,
  saveSettings,
  saveTemplate,
  settingsScreen,
  templatesScreen,
} from '../application/screens.js';
import type { Caller, Deps, UnitOfWork } from '../application/ports.js';
import type { CallerFrom } from './caller.js';

/**
 * REST v1 for Onboarding (Recruiting PRD §O11, ONB-009): `/v1/onboarding/...`.
 * Recruiting's design: one route table serves REST, the OpenAPI document and
 * the subgraph; every write carries `Idempotency-Key`; no route decides who
 * may do anything.
 *
 * The public routes are the new hire's welcome page: no account, the plan
 * named by the page's token in `X-Welcome-Token`, whose first part is the
 * tenant, as Documents' signing links are.
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

const V1 = '/v1/onboarding';
const Id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const header = (headers: RestRequest['headers'], name: string): string => {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
};
const welcomeToken = (headers: RestRequest['headers']) => header(headers, 'x-welcome-token');

const TaskInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/u),
  title: text(200).min(1),
  phase: Phase,
  ownerRole: OwnerRole,
  ownerPersonId: Id.nullable(),
  kind: TaskKind,
  due: z.string().regex(/^(probation)?[+-]?\d{1,3}d?$/u),
  link: text(500).nullable(),
});

export const ROUTES: readonly Route[] = [
  /* ------------------------------------------------------------ screens -- */
  route({
    name: 'onboardingBoard',
    method: 'GET',
    path: `${V1}/board`,
    summary: 'O1: every plan in flight',
    params: z.object({
      state: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
    }),
    run: async (ctx, { params }) => ok(await boardScreen(ctx, params.state)),
  }),
  route({
    name: 'onboardingPlan',
    method: 'GET',
    path: `${V1}/plans/{planId}`,
    summary: 'O3: a plan',
    params: z.object({ planId: Id }),
    run: (ctx, { params }) => planScreen(ctx, params.planId),
  }),
  route({
    name: 'onboardingTasks',
    method: 'GET',
    path: `${V1}/tasks`,
    summary: 'O4: my onboarding tasks',
    run: async (ctx) => ok(await myTasks(ctx)),
  }),
  route({
    name: 'onboardingTemplates',
    method: 'GET',
    path: `${V1}/templates`,
    summary: 'O2: templates',
    run: (ctx) => templatesScreen(ctx),
  }),
  route({
    name: 'onboardingSettings',
    method: 'GET',
    path: `${V1}/settings`,
    summary: 'O7: settings',
    run: (ctx) => settingsScreen(ctx),
  }),
  route({
    name: 'onboardingAnalytics',
    method: 'GET',
    path: `${V1}/analytics`,
    summary: 'O9: analytics',
    run: (ctx) => analyticsScreen(ctx),
  }),
  route({
    name: 'onboardingInbox',
    method: 'GET',
    path: `${V1}/inbox`,
    summary: 'The Inbox: Onboarding’s items for me',
    answer: InboxAnswer,
    run: async (ctx) => ok(await onboardingInbox(ctx)),
  }),

  /* -------------------------------------------------------------- hires -- */
  route({
    name: 'addOnboardingHire',
    method: 'POST',
    path: `${V1}/hires`,
    summary: 'A hire from another ATS (§O2)',
    body: HireIntake.omit({ source: true }),
    status: 201,
    run: async (ctx, { body }) => {
      const may = hrOnly(ctx);
      if (!may.ok) return may;
      const plan = await intake(ctx, { ...body, source: 'webhook' });
      return plan.ok ? ok({ planId: plan.value.id }) : plan;
    },
  }),

  /* -------------------------------------------------------------- plans -- */
  route({
    name: 'completeOnboardingTask',
    method: 'POST',
    path: `${V1}/plans/{planId}/tasks/{taskId}/complete`,
    summary: 'Tick a task',
    params: z.object({ planId: Id, taskId: Id }),
    run: async (ctx, { params }) => done(await completeTask(ctx, params.planId, params.taskId)),
  }),
  route({
    name: 'reopenOnboardingTask',
    method: 'POST',
    path: `${V1}/plans/{planId}/tasks/{taskId}/reopen`,
    summary: 'Untick a task',
    params: z.object({ planId: Id, taskId: Id }),
    run: async (ctx, { params }) => done(await reopenTask(ctx, params.planId, params.taskId)),
  }),
  route({
    name: 'setOnboardingBuddy',
    method: 'PUT',
    path: `${V1}/plans/{planId}/buddy`,
    summary: 'Choose the buddy',
    params: z.object({ planId: Id }),
    body: z.object({ buddyId: Id.nullable() }),
    run: async (ctx, { params, body }) => done(await setBuddy(ctx, params.planId, body.buddyId)),
  }),
  route({
    name: 'moveOnboardingStart',
    method: 'PUT',
    path: `${V1}/plans/{planId}/start`,
    summary: 'Move the start date',
    params: z.object({ planId: Id }),
    body: z.object({ startDate: CalendarDate }),
    run: async (ctx, { params, body }) =>
      done(await moveStartDate(ctx, params.planId, body.startDate)),
  }),
  route({
    name: 'onboardingCheckIn',
    method: 'POST',
    path: `${V1}/plans/{planId}/check-ins`,
    summary: 'O6: a check-in',
    params: z.object({ planId: Id }),
    body: z.object({
      day: z.union([z.literal(30), z.literal(60), z.literal(90)]),
      notes: text(4000).min(1),
    }),
    status: 201,
    run: (ctx, { params, body }) => checkIn(ctx, params.planId, body.day, body.notes),
  }),
  route({
    name: 'reviewOnboardingProbation',
    method: 'POST',
    path: `${V1}/plans/{planId}/probation`,
    summary: 'O8: the probation review',
    params: z.object({ planId: Id }),
    body: z.object({ outcome: ProbationOutcome, extendMonths: z.int().min(1).max(12).nullable() }),
    run: async (ctx, { params, body }) =>
      done(await reviewProbation(ctx, params.planId, body.outcome, body.extendMonths)),
  }),

  /* ----------------------------------------------------------- settings -- */
  route({
    name: 'saveOnboardingTemplate',
    method: 'PUT',
    path: `${V1}/templates/{id}`,
    summary: 'O2: a template',
    params: z.object({ id: Id }),
    body: z.object({
      name: text(200).min(1),
      active: z.boolean(),
      conditions: z.object({
        countries: z.array(LaunchCountry).optional(),
        legalEntityIds: z.array(Id).optional(),
        departments: z.array(text(120)).optional(),
        workModes: z.array(WorkMode).optional(),
        contractTypes: z.array(text(80)).optional(),
      }),
      tasks: z.array(TaskInput).max(80),
    }),
    run: async (ctx, { params, body }) => done(await saveTemplate(ctx, params.id, body)),
  }),
  route({
    name: 'saveOnboardingSettings',
    method: 'PUT',
    path: `${V1}/settings`,
    summary: 'O7: who holds HR and IT, holidays, the default country',
    body: z.object({
      roles: z.object({ hr: z.array(Id).max(50), it: z.array(Id).max(50) }),
      holidays: z.record(LaunchCountry, z.array(CalendarDate).max(60)),
      defaultCountry: LaunchCountry,
    }),
    run: (ctx, { body }) => saveSettings(ctx, body),
  }),

  /* ----------------------------------------------------- the welcome page -- */
  route({
    name: 'welcome',
    method: 'GET',
    path: `${V1}/welcome`,
    summary: 'O5: the new hire’s page before day one',
    public: true,
    run: (ctx, { headers }) => welcomePage(ctx, welcomeToken(headers)),
  }),
  route({
    name: 'welcomeComplete',
    method: 'POST',
    path: `${V1}/welcome/tasks/{taskId}/complete`,
    summary: 'O5: the new hire ticks their own task',
    params: z.object({ taskId: Id }),
    public: true,
    run: (ctx, { params, headers }) => completeByWelcome(ctx, welcomeToken(headers), params.taskId),
  }),
];

const STATUS: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  NOT_ENTITLED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_REUSED: 409,
  ALREADY_DONE: 409,
  PLAN_CLOSED: 409,
  IDEMPOTENCY_KEY_REQUIRED: 428,
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

/** One transaction per request: the use case, its events, its key and its answer commit together. */
async function inTransaction(
  deps: Deps,
  caller: Caller,
  run: (ctx: Ctx) => Promise<Result<unknown>>,
  key: { readonly key: string; readonly hash: string; readonly status: number } | null,
  /** The write as the activity log words it (`docs/audit.md`), raised once it stands. */
  act: ModuleActivity | null = null,
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
    const ctx = await contextOf(deps, tx, caller, mail);
    const answer = await run(ctx);
    // In the write's own transaction, and only a first one: a replay returned above.
    if (answer.ok && act !== null)
      await tx.outbox.publish([
        event(ctx, OnboardingActivityRecorded.name, { type: 'activity', id: deps.newId() }, act),
      ]);
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
    const url = new URL(request.url, 'http://onboarding.internal');
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

    let caller: Caller;
    let key: { key: string; hash: string; status: number } | null = null;
    if (r.public) {
      const tenant = TenantId.safeParse(welcomeToken(request.headers).split('.')[0]);
      if (!tenant.success) return refused(failure('NOT_FOUND', 'No such page'));
      caller = {
        tenantId: tenant.data,
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
    }
    const answer = await inTransaction(
      deps,
      caller,
      (ctx) => r.run(ctx, input),
      key,
      key === null ? null : routeActivity(r, params.value),
    );
    if ('status' in answer) return answer;
    return answer.ok ? { status: r.status, body: answer.value } : refused(answer.error);
  };
}

export type { UnitOfWork };
export { Done };
