import { createHash, randomBytes } from 'node:crypto';
import {
  OnboardingTaskCompleted,
  PlanCancelled,
  PlanCompleted,
  PlanStarted,
  ProbationReviewed,
  type CalendarDate,
  type HireIntake,
  type ProbationOutcome,
} from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { countryTasks, defaultTemplate } from '../domain/country.js';
import {
  buildPlan,
  cancelPlan,
  completeTask as complete,
  moveStart,
  reopenTask as reopen,
  type PlanTask,
} from '../domain/plan.js';
import { decideProbation } from '../domain/probation.js';
import { event, forbidden, hrOnly, notFound, publish, type Ctx } from './context.js';
import type { PlanRecord } from './ports.js';

/**
 * A hire becomes a plan, and the plan is worked through (Recruiting PRD §O4–§O8,
 * ONB-007, ONB-008). Who may do what is decided here, never in a transport.
 */

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** The welcome page's token names its tenant, as Documents' signing links do. */
const welcomeToken = (tenantId: string) => `${tenantId}.${randomBytes(24).toString('base64url')}`;

/** Holidays the shell passed from Time Off, per country, kept in settings. */
async function holidaysOf(ctx: Ctx, country: string): Promise<ReadonlySet<string>> {
  const held = ((await ctx.tx.settings.get('holidays')) as Record<string, string[]> | null) ?? {};
  return new Set(held[country] ?? []);
}

/** A hire from any source: one plan per hire, the same source id twice changes nothing but a moved start. */
export async function intake(ctx: Ctx, hire: HireIntake): Promise<Result<PlanRecord>> {
  const known =
    (await ctx.tx.hires.bySource(hire.source, hire.externalId)) ??
    // People's event for somebody Recruiting already handed over: the same person.
    (hire.source === 'people' ? await ctx.tx.hires.byEmail(hire.email) : null);
  if (known !== null) {
    const plan = await ctx.tx.plans.byHire(known.id);
    if (plan === null) return err(notFound('plan'));
    const next: PlanRecord = {
      ...(plan.startDate === hire.startDate || plan.state !== 'scheduled'
        ? plan
        : { ...plan, ...moveStart(plan, hire.startDate, await holidaysOf(ctx, plan.country)) }),
      personId: plan.personId ?? hire.personId,
      managerId: plan.managerId ?? hire.managerId,
    };
    await ctx.tx.plans.save(next);
    return ok(next);
  }
  const hireId = ctx.deps.newId();
  await ctx.tx.hires.save({ ...hire, id: hireId, createdAt: ctx.at });
  let templates = await ctx.tx.templates.list();
  if (templates.length === 0) {
    const first = defaultTemplate(ctx.deps.newId());
    await ctx.tx.templates.save(first);
    templates = [first];
  }
  const built = buildPlan({
    id: ctx.deps.newId(),
    hireId,
    hire: { ...hire },
    templates,
    country: countryTasks(hire.country),
    holidays: await holidaysOf(ctx, hire.country),
    newId: ctx.deps.newId,
  });
  const token = welcomeToken(ctx.caller.tenantId);
  const plan: PlanRecord = {
    ...built,
    name: `${hire.givenName} ${hire.familyName}`.trim(),
    email: hire.email,
    personId: hire.personId,
    managerId: hire.managerId,
    country: hire.country,
    department: hire.department,
    location: hire.location,
    workMode: hire.workMode,
    allowedExtensionMonths: hire.probationExtensionMonths,
    welcomeHash: sha256(token),
  };
  await ctx.tx.plans.save(plan);
  await publish(
    ctx,
    event(
      ctx,
      PlanStarted.name,
      { type: 'plan', id: plan.id },
      {
        planId: plan.id,
        hireId,
        personId: plan.personId,
        startDate: plan.startDate,
        tasks: plan.tasks.length,
      },
      plan.startDate,
    ),
  );
  ctx.mail.push({
    to: hire.email,
    subject: 'Welcome: what happens before your first day',
    text: `Hello ${hire.givenName},\n\nWe’re glad you’re joining us on ${plan.startDate}. Your first days, who meets you and what to do beforehand are here:\n${ctx.deps.jobsOrigin}/welcome#${token}\n\nThe link is yours alone; please don’t share it.`,
    dedupeKey: `onboarding:welcome:${plan.id}`,
  });
  return ok(plan);
}

/** A hire that fell through before the start: the plan is cancelled (§O4). */
export async function cancelForHire(
  ctx: Ctx,
  source: HireIntake['source'],
  externalId: string,
): Promise<Result<PlanRecord | null>> {
  const hire = await ctx.tx.hires.bySource(source, externalId);
  const plan = hire === null ? null : await ctx.tx.plans.byHire(hire.id);
  if (plan === null) return ok(null);
  if (plan.state === 'cancelled' || plan.state === 'completed') return ok(plan);
  const next = { ...plan, ...cancelPlan(plan) };
  await ctx.tx.plans.save(next);
  await publish(
    ctx,
    event(
      ctx,
      PlanCancelled.name,
      { type: 'plan', id: plan.id },
      { planId: plan.id, hireId: plan.hireId },
    ),
  );
  return ok(next);
}

/* --------------------------------------------------------------- access -- */

/** Who a task is for, as this viewer: the owner, or HR for any task. */
export function owns(ctx: Ctx, plan: PlanRecord, task: PlanTask): boolean {
  const me = ctx.viewer.personId;
  if (ctx.viewer.hr) return true;
  switch (task.ownerRole) {
    case 'new_hire':
      return me !== null && me === plan.personId;
    case 'manager':
      return me !== null && me === plan.managerId;
    case 'buddy':
      return me !== null && me === plan.buddyId;
    case 'it':
      return ctx.viewer.it;
    case 'person':
      return me !== null && me === task.ownerPersonId;
    case 'hr':
      return false;
  }
}

/** HR sees every plan; a manager, a buddy and the new hire see their own. */
export function maySee(ctx: Ctx, plan: PlanRecord): boolean {
  const me = ctx.viewer.personId;
  return (
    ctx.viewer.hr ||
    (ctx.viewer.it && plan.state !== 'cancelled') ||
    (me !== null && [plan.managerId, plan.buddyId, plan.personId].includes(me)) ||
    plan.tasks.some((t) => t.ownerRole === 'person' && t.ownerPersonId === me)
  );
}

export async function loadPlan(ctx: Ctx, planId: string): Promise<Result<PlanRecord>> {
  const plan = await ctx.tx.plans.get(planId);
  if (plan === null || !maySee(ctx, plan)) return err(notFound('plan'));
  return ok(plan);
}

/* ---------------------------------------------------------------- tasks -- */

async function finish(
  ctx: Ctx,
  plan: PlanRecord,
  taskId: string,
  by: string,
): Promise<Result<PlanRecord>> {
  const done = complete(plan, taskId, by, ctx.at, ctx.today);
  if (!done.ok) return done;
  const next: PlanRecord = { ...plan, ...done.value.plan };
  await ctx.tx.plans.save(next);
  const task = next.tasks.find((t) => t.id === taskId);
  await publish(
    ctx,
    event(
      ctx,
      OnboardingTaskCompleted.name,
      { type: 'plan', id: plan.id },
      {
        planId: plan.id,
        taskId,
        ownerRole: task?.ownerRole ?? 'hr',
        late: done.value.late,
      },
    ),
  );
  if (next.state === 'completed')
    await publish(
      ctx,
      event(
        ctx,
        PlanCompleted.name,
        { type: 'plan', id: plan.id },
        { planId: plan.id, hireId: plan.hireId, personId: plan.personId },
      ),
    );
  return ok(next);
}

export async function completeTask(
  ctx: Ctx,
  planId: string,
  taskId: string,
): Promise<Result<PlanRecord>> {
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  const task = loaded.value.tasks.find((t) => t.id === taskId);
  if (task === undefined) return err(notFound('task'));
  if (!owns(ctx, loaded.value, task)) return err(forbidden('This task is somebody else’s'));
  return finish(ctx, loaded.value, taskId, ctx.viewer.personId ?? ctx.caller.accountId);
}

export async function reopenTask(
  ctx: Ctx,
  planId: string,
  taskId: string,
): Promise<Result<PlanRecord>> {
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  const task = loaded.value.tasks.find((t) => t.id === taskId);
  if (task === undefined) return err(notFound('task'));
  if (!owns(ctx, loaded.value, task)) return err(forbidden('This task is somebody else’s'));
  const next = reopen(loaded.value, taskId);
  if (!next.ok) return next;
  const saved: PlanRecord = { ...loaded.value, ...next.value };
  await ctx.tx.plans.save(saved);
  return ok(saved);
}

/** The manager or HR chooses the buddy (§O6). */
export async function setBuddy(
  ctx: Ctx,
  planId: string,
  buddyId: string | null,
): Promise<Result<PlanRecord>> {
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  if (!ctx.viewer.hr && ctx.viewer.personId !== loaded.value.managerId)
    return err(forbidden('The manager or HR chooses the buddy'));
  if (buddyId !== null && (await ctx.tx.members.get(buddyId)) === null)
    return err(notFound('person'));
  const next = { ...loaded.value, buddyId };
  await ctx.tx.plans.save(next);
  return ok(next);
}

export async function moveStartDate(
  ctx: Ctx,
  planId: string,
  start: CalendarDate,
): Promise<Result<PlanRecord>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  if (loaded.value.state === 'completed' || loaded.value.state === 'cancelled')
    return err(failure('PLAN_CLOSED', `This plan is ${loaded.value.state}`));
  const next: PlanRecord = {
    ...loaded.value,
    ...moveStart(loaded.value, start, await holidaysOf(ctx, loaded.value.country)),
  };
  await ctx.tx.plans.save(next);
  return ok(next);
}

/* ------------------------------------------------------------ check-ins -- */

export async function checkIn(
  ctx: Ctx,
  planId: string,
  day: 30 | 60 | 90,
  notes: string,
): Promise<Result<{ ok: true }>> {
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  const me = ctx.viewer.personId;
  if (me === null || (me !== loaded.value.personId && me !== loaded.value.managerId))
    return err(forbidden('A check-in is the new hire’s and their manager’s'));
  await ctx.tx.checkIns.save({ id: ctx.deps.newId(), planId, day, by: me, notes, at: ctx.at });
  return ok({ ok: true });
}

/* ------------------------------------------------------------ probation -- */

export async function reviewProbation(
  ctx: Ctx,
  planId: string,
  outcome: ProbationOutcome,
  extendMonths: number | null,
): Promise<Result<PlanRecord>> {
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  const plan = loaded.value;
  if (plan.probationEnd === null) return err(failure('NO_PROBATION', 'This hire has no probation'));
  const me = ctx.viewer.personId ?? ctx.caller.accountId;
  const decided = decideProbation(
    {
      end: plan.probationEnd,
      managerId: plan.managerId,
      allowedExtensionMonths: plan.allowedExtensionMonths,
    },
    me,
    ctx.viewer.hr,
    outcome,
    extendMonths,
  );
  if (!decided.ok) return decided;
  await ctx.tx.reviews.save({
    planId,
    outcome,
    probationEnd: decided.value.probationEnd,
    by: me,
    at: ctx.at,
  });
  let next: PlanRecord =
    decided.value.probationEnd === null
      ? plan
      : { ...plan, probationEnd: decided.value.probationEnd };
  await ctx.tx.plans.save(next);
  // The review was the task: ticked, with its own event, as any other.
  const review = next.tasks.find((t) => t.key === 'probation_review' && t.state === 'open');
  if (review !== undefined) {
    const done = await finish(ctx, next, review.id, me);
    if (done.ok) next = done.value;
  }
  await publish(
    ctx,
    event(
      ctx,
      ProbationReviewed.name,
      { type: 'plan', id: plan.id },
      {
        planId: plan.id,
        personId: plan.personId,
        outcome,
        probationEnd: decided.value.probationEnd,
        by: me,
      },
    ),
  );
  return ok(next);
}

/* -------------------------------------------------------------- welcome -- */

/** The plan a welcome token opens, or nothing: a wrong token learns nothing. */
export async function planByWelcome(ctx: Ctx, token: string): Promise<PlanRecord | null> {
  if (token.length < 20 || token.length > 200) return null;
  const plan = await ctx.tx.plans.byWelcomeHash(sha256(token));
  return plan === null || plan.state === 'cancelled' ? null : plan;
}

/** O5: what the new hire sees before they have an account. */
export async function welcomePage(ctx: Ctx, token: string): Promise<Result<unknown>> {
  const plan = await planByWelcome(ctx, token);
  if (plan === null) return err(notFound('page'));
  const name = async (id: string | null) =>
    id === null ? null : ((await ctx.tx.members.get(id))?.displayName ?? null);
  return ok({
    name: plan.name.split(' ')[0] ?? plan.name,
    startDate: plan.startDate,
    location: plan.location,
    workMode: plan.workMode,
    manager: await name(plan.managerId),
    buddy: await name(plan.buddyId),
    firstWeek: plan.tasks
      .filter((t) => t.phase === 'day_one' || t.phase === 'first_week')
      .map((t) => ({ title: t.title, dueOn: t.dueOn, mine: t.ownerRole === 'new_hire' })),
    tasks: plan.tasks
      .filter((t) => t.ownerRole === 'new_hire')
      .map((t) => ({
        id: t.id,
        title: t.title,
        kind: t.kind,
        dueOn: t.dueOn,
        done: t.state === 'done',
        link: t.link,
      })),
  });
}

/** The new hire ticks their own task from the welcome page. */
export async function completeByWelcome(
  ctx: Ctx,
  token: string,
  taskId: string,
): Promise<Result<{ ok: true }>> {
  const plan = await planByWelcome(ctx, token);
  if (plan === null) return err(notFound('page'));
  const task = plan.tasks.find((t) => t.id === taskId);
  if (task?.ownerRole !== 'new_hire') return err(notFound('task'));
  const done = await finish(ctx, plan, taskId, plan.personId ?? 'new_hire');
  return done.ok ? ok({ ok: true }) : done;
}
