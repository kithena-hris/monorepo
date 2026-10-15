import type { CalendarDate, InboxItem, Instant } from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { dueText, parseDue, progress, startIfDue, type Template } from '../domain/plan.js';
import { adminOnly, nameOf, rolesOf, type Ctx } from './context.js';
import { loadPlan, maySee, owns } from './plans.js';
import type { PlanRecord } from './ports.js';

/**
 * The read models Onboarding's screens are drawn from (Recruiting PRD §O10,
 * ONB-009), one per screen, each answering only what the viewer may see.
 */

const shown = (ctx: Ctx, plan: PlanRecord) => startIfDue(plan, ctx.today);

/** O1: every plan in flight the viewer may see, how far along, what is late. */
export async function boardScreen(ctx: Ctx, state: string | undefined): Promise<unknown> {
  const plans = (await ctx.tx.plans.list()).filter((p) => maySee(ctx, p)).map((p) => shown(ctx, p));
  const rows = await Promise.all(
    plans
      .filter((p) =>
        state === undefined
          ? p.state !== 'cancelled' && p.state !== 'completed'
          : p.state === state,
      )
      .map(async (p) => {
        const progressed = progress(p, ctx.today);
        return {
          id: p.id,
          name: p.name,
          state: p.state,
          startDate: p.startDate,
          department: p.department,
          country: p.country,
          manager: await nameOf(ctx, p.managerId),
          done: progressed.done,
          total: progressed.total,
          late: progressed.late,
          next:
            progressed.next === null
              ? null
              : { title: progressed.next.title, dueOn: progressed.next.dueOn },
        };
      }),
  );
  return {
    rows: rows.toSorted((a, b) => a.startDate.localeCompare(b.startDate)),
    hr: ctx.viewer.hr,
  };
}

/** O3: one plan, its tasks by phase, who owns each and whether this viewer may tick it. */
export async function planScreen(ctx: Ctx, planId: string): Promise<Result<unknown>> {
  const loaded = await loadPlan(ctx, planId);
  if (!loaded.ok) return loaded;
  const plan = shown(ctx, loaded.value);
  const members = await ctx.tx.members.list();
  return ok({
    plan: {
      id: plan.id,
      name: plan.name,
      state: plan.state,
      startDate: plan.startDate,
      probationEnd: plan.probationEnd,
      department: plan.department,
      location: plan.location,
      country: plan.country,
      workMode: plan.workMode,
      managerId: plan.managerId,
      buddyId: plan.buddyId,
      personId: plan.personId,
      allowedExtensionMonths: plan.allowedExtensionMonths,
    },
    manager: await nameOf(ctx, plan.managerId),
    buddy: await nameOf(ctx, plan.buddyId),
    progress: progress(plan, ctx.today),
    tasks: plan.tasks.map((t) => ({
      id: t.id,
      key: t.key,
      title: t.title,
      phase: t.phase,
      ownerRole: t.ownerRole,
      kind: t.kind,
      dueOn: t.dueOn,
      due: dueText(t.due),
      state: t.state,
      doneAt: t.doneAt,
      locked: t.locked,
      link: t.link,
      late: t.state === 'open' && t.dueOn < ctx.today,
      mine: owns(ctx, plan, t),
    })),
    checkIns: (await ctx.tx.checkIns.forPlan(plan.id)).map((c) => ({
      day: c.day,
      by: c.by,
      notes: c.notes,
      at: c.at,
    })),
    reviews: await ctx.tx.reviews.forPlan(plan.id),
    members:
      ctx.viewer.hr || ctx.viewer.personId === plan.managerId
        ? members
            .filter((m) => m.status !== 'terminated')
            .map((m) => ({ personId: m.personId, name: m.displayName }))
        : [],
    may: {
      setBuddy: ctx.viewer.hr || ctx.viewer.personId === plan.managerId,
      moveStart: ctx.viewer.hr,
      review:
        plan.probationEnd !== null && (ctx.viewer.hr || ctx.viewer.personId === plan.managerId),
      checkIn:
        ctx.viewer.personId !== null &&
        [plan.personId, plan.managerId].includes(ctx.viewer.personId),
    },
  });
}

/** O4: every open task the viewer owns, across plans, by date. */
export async function myTasks(ctx: Ctx): Promise<unknown> {
  // HR may tick any task; this list is what is theirs by role, so HR sees
  // HR's tasks here and everyone else's on the board.
  const strict = { ...ctx, viewer: { ...ctx.viewer, hr: false } };
  const rows = [];
  for (const plan of (await ctx.tx.plans.list()).filter(
    (p) => p.state !== 'cancelled' && p.state !== 'completed',
  )) {
    for (const t of plan.tasks) {
      if (t.state !== 'open') continue;
      if (!(t.ownerRole === 'hr' ? ctx.viewer.hr : owns(strict, plan, t))) continue;
      rows.push({
        planId: plan.id,
        taskId: t.id,
        name: plan.name,
        title: t.title,
        kind: t.kind,
        ownerRole: t.ownerRole,
        dueOn: t.dueOn,
        late: t.dueOn < ctx.today,
        link: t.link,
      });
    }
  }
  return { rows: rows.toSorted((a, b) => a.dueOn.localeCompare(b.dueOn)) };
}

/** O2: templates, for administrators. */
export async function templatesScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  return ok({
    templates: (await ctx.tx.templates.list()).map((t) => ({
      ...t,
      tasks: t.tasks.map((x) => ({ ...x, due: dueText(x.due) })),
    })),
  });
}

export interface TemplateInput {
  readonly name: string;
  readonly active: boolean;
  readonly conditions: Template['conditions'];
  readonly tasks: readonly (Omit<Template['tasks'][number], 'due'> & { readonly due: string })[];
}

export async function saveTemplate(
  ctx: Ctx,
  id: string,
  input: TemplateInput,
): Promise<Result<Template>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  let tasks: Template['tasks'];
  try {
    tasks = input.tasks.map((t) => ({ ...t, due: parseDue(t.due) }));
  } catch (e) {
    return err({
      code: 'BAD_DUE',
      message: e instanceof Error ? e.message : 'Check the due rules',
    });
  }
  if (new Set(tasks.map((t) => t.key)).size !== tasks.length)
    return err({ code: 'DUPLICATE_TASK', message: 'Each task in a template has its own key' });
  const template: Template = {
    id,
    name: input.name,
    active: input.active,
    conditions: input.conditions,
    tasks,
  };
  await ctx.tx.templates.save(template);
  return ok(template);
}

/** O7: who holds HR and IT, and the holidays plans skip. */
export async function settingsScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  return ok({
    roles: await rolesOf(ctx.tx),
    holidays: ((await ctx.tx.settings.get('holidays')) as Record<string, string[]> | null) ?? {},
    defaultCountry: ((await ctx.tx.settings.get('defaultCountry')) as string | null) ?? 'DE',
    members: (await ctx.tx.members.list()).map((m) => ({
      personId: m.personId,
      name: m.displayName,
    })),
  });
}

export async function saveSettings(
  ctx: Ctx,
  input: {
    readonly roles: { readonly hr: readonly string[]; readonly it: readonly string[] };
    readonly holidays: Readonly<Record<string, readonly string[]>>;
    readonly defaultCountry: string;
  },
): Promise<Result<{ ok: true }>> {
  const may = adminOnly(ctx);
  if (!may.ok) return may;
  await ctx.tx.settings.set('roles', input.roles);
  await ctx.tx.settings.set('holidays', input.holidays);
  await ctx.tx.settings.set('defaultCountry', input.defaultCountry);
  return ok({ ok: true });
}

/** O9: plans on time, late tasks by role, probation outcomes. Every number is a count here. */
export async function analyticsScreen(ctx: Ctx): Promise<Result<unknown>> {
  if (!ctx.viewer.hr)
    return err({ code: 'FORBIDDEN', message: 'Only HR sees onboarding analytics' });
  const plans = await ctx.tx.plans.list();
  const live = plans.filter((p) => p.state === 'scheduled' || p.state === 'in_progress');
  const lateByRole: Record<string, number> = {};
  for (const p of live)
    for (const t of p.tasks)
      if (t.state === 'open' && t.dueOn < ctx.today)
        lateByRole[t.ownerRole] = (lateByRole[t.ownerRole] ?? 0) + 1;
  const outcomes: Record<string, number> = { passed: 0, extended: 0, failed: 0 };
  for (const p of plans)
    for (const r of await ctx.tx.reviews.forPlan(p.id))
      outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  const completed = plans.filter((p) => p.state === 'completed');
  return ok({
    inFlight: live.length,
    completed: completed.length,
    onTrack: live.filter((p) => progress(p, ctx.today).late === 0).length,
    lateByRole: Object.entries(lateByRole).map(([role, count]) => ({ role, count })),
    probation: Object.entries(outcomes).map(([outcome, count]) => ({ outcome, count })),
  });
}

/** Onboarding's answer to the Inbox (ONB-012): my tasks due within two weeks, or late. */
export async function onboardingInbox(ctx: Ctx): Promise<{ items: InboxItem[] }> {
  const soon = new Date(Date.parse(`${ctx.today}T00:00:00Z`) + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const mine = (await myTasks(ctx)) as {
    rows: {
      planId: string;
      taskId: string;
      name: string;
      title: string;
      dueOn: CalendarDate;
      late: boolean;
    }[];
  };
  return {
    items: mine.rows
      .filter((r) => r.dueOn <= soon)
      .map((r) => ({
        id: `onboarding:task:${r.taskId}`,
        lane: 'task',
        kind: 'onboarding.task',
        module: 'onboarding',
        area: 'Onboarding',
        icon: 'hire',
        title: `${r.title}: ${r.name}`,
        at: `${r.dueOn}T00:00:00.000Z` as Instant,
        due: r.dueOn,
        dueVerb: 'due',
        link: `/onboarding/plans/${r.planId}`,
        openIn: 'Onboarding',
        tone: r.late ? 'danger' : null,
        summary: null,
        from: null,
        status: null,
        outcome: null,
        count: null,
        team: null,
        replies: 0,
        message: null,
        detail: null,
      })) as InboxItem[],
  };
}
