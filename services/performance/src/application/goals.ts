import { err, failure, ok, type Result } from '@kithena/domain-kit';

import {
  checkIn as addCheckIn,
  checkWeights,
  confidence,
  goalScore,
  nextCheckIn,
  progress,
  type Goal,
  type KeyResult,
} from '../domain/goals.js';
import { audit, event, forbidden, me, names, notFound, publish, type Ctx } from './context.js';
import { people, subtitle } from './members.js';
import { settingsOf } from './settings.js';

/**
 * Goals (PRD §14, PRF-100 to PRF-104): periods from settings, goals with key
 * results, check-ins on a cadence, alignment to one parent, and goals put
 * into a cycle. Every number is computed here.
 *
 * ponytail: every goal is visible to everyone at the company; per-goal
 * visibility (§14.2) when a company asks for private goals.
 */

const view = (g: Goal, name: (id: string | null) => string, parent: Goal | undefined) => ({
  id: g.id,
  title: g.title,
  owner: g.ownerKind === 'company' ? 'Company' : name(g.ownerId),
  ownerId: g.ownerId,
  ownerKind: g.ownerKind,
  periodId: g.periodId,
  progress: progress(g),
  confidence: g.status === 'completed' ? 'done' : confidence(g),
  status: g.status,
  weight: g.weight,
  commitment: g.commitment,
  parentId: g.parentId,
  alignedTo: parent?.title ?? null,
});

export async function goalsScreen(
  ctx: Ctx,
  opts: { tab?: string; period?: string; scope?: string; risk?: boolean },
): Promise<Result<unknown>> {
  const settings = await settingsOf(ctx);
  const periods = settings.goals.periods;
  const today = ctx.today;
  const period =
    periods.find((p) => p.id === opts.period) ??
    periods.find((p) => p.from <= today && p.to >= today && p.id.startsWith('h')) ??
    periods[0];
  const name = await names(ctx);
  const all = await ctx.tx.goals.find();
  const byId = new Map(all.map((g) => [g.id, g]));
  const mine = ctx.viewer.personId;
  const scope = opts.scope ?? (ctx.viewer.reports.size > 0 ? 'team' : 'mine');
  const inPeriod = all.filter((g) => period === undefined || g.periodId === period.id);
  const rows = inPeriod
    .filter((g) =>
      scope === 'company'
        ? true
        : scope === 'team'
          ? g.ownerId === mine ||
            (g.ownerId !== null && ctx.viewer.org.has(g.ownerId)) ||
            g.ownerKind === 'company'
          : g.ownerId === mine,
    )
    .filter((g) => opts.risk !== true || confidence(g) !== 'on_track')
    .map((g) => view(g, name, g.parentId === null ? undefined : byId.get(g.parentId)));
  const due = [];
  if (period !== undefined)
    for (const g of inPeriod.filter(
      (x) => x.ownerId === mine || (x.ownerId !== null && ctx.viewer.org.has(x.ownerId)),
    )) {
      const next = nextCheckIn(g, period);
      if (next !== null && next <= today) due.push({ ...view(g, name, undefined), dueOn: next });
    }
  return ok({
    tab: opts.tab ?? 'list',
    periods,
    period: period?.id ?? null,
    scope,
    rows,
    tree: inPeriod.map((g) =>
      view(g, name, g.parentId === null ? undefined : byId.get(g.parentId)),
    ),
    due,
    weighted: settings.goals.weighted,
    score: mine === null ? null : goalScore(inPeriod.filter((g) => g.ownerId === mine)),
    may: { create: mine !== null, company: ctx.viewer.hr },
  });
}

export async function goalScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const g = await ctx.tx.goals.get(id);
  if (g === null) return err(notFound('goal'));
  const name = await names(ctx);
  const parent = g.parentId === null ? null : await ctx.tx.goals.get(g.parentId);
  const settings = await settingsOf(ctx);
  const period = settings.goals.periods.find((p) => p.id === g.periodId);
  const children = (await ctx.tx.goals.find()).filter((x) => x.parentId === id);
  const owner =
    g.ownerId === ctx.viewer.personId ||
    ctx.viewer.hr ||
    (g.ownerId !== null && ctx.viewer.org.has(g.ownerId));
  return ok({
    goal: {
      ...view(g, name, parent ?? undefined),
      description: g.description,
      keyResults: g.keyResults.map((k) => ({ ...k, progress: progressOf(k) })),
      createdAt: g.createdAt,
    },
    checkIns: g.checkIns.toReversed().map((c) => ({ ...c, by: name(c.by) })),
    period: period ?? null,
    nextCheckIn: period === undefined ? null : nextCheckIn(g, period),
    score: goalScore([g]),
    children: children.map((c) => view(c, name, g)),
    may: { checkIn: owner && g.status === 'active', edit: owner },
  });
}

const progressOf = (k: KeyResult) => progress({ keyResults: [k] });

export interface GoalInput {
  readonly title: string;
  readonly description: string;
  readonly ownerId: string | null;
  readonly ownerKind: Goal['ownerKind'];
  readonly periodId: string;
  readonly parentId: string | null;
  readonly weight: number | null;
  readonly commitment: Goal['commitment'];
  readonly keyResults: readonly Omit<KeyResult, 'id'>[];
}

export async function saveGoal(
  ctx: Ctx,
  id: string | null,
  input: GoalInput,
): Promise<Result<{ id: string }>> {
  const who = me(ctx);
  if (input.ownerKind === 'company' && !ctx.viewer.hr)
    return err(forbidden('Only HR sets company goals'));
  const owner =
    input.ownerKind === 'person' ? (input.ownerId ?? (who.ok ? who.value : null)) : input.ownerId;
  if (
    input.ownerKind === 'person' &&
    owner !== ctx.viewer.personId &&
    !ctx.viewer.hr &&
    !(owner !== null && ctx.viewer.org.has(owner))
  )
    return err(forbidden('You set goals for yourself and your reports'));
  const settings = await settingsOf(ctx);
  if (!settings.goals.periods.some((p) => p.id === input.periodId))
    return err(notFound('goal period'));
  const old = id === null ? null : await ctx.tx.goals.get(id);
  if (id !== null && old === null) return err(notFound('goal'));
  const goal: Goal = {
    id: id ?? ctx.deps.newId(),
    title: input.title,
    description: input.description,
    ownerId: owner,
    ownerKind: input.ownerKind,
    periodId: input.periodId,
    parentId: input.parentId === id ? null : input.parentId,
    weight: settings.goals.weighted ? input.weight : null,
    commitment: input.commitment,
    status: old?.status ?? 'active',
    keyResults: input.keyResults.map((k, i) => ({
      ...k,
      id: old?.keyResults[i]?.id ?? ctx.deps.newId(),
    })),
    checkIns: old?.checkIns ?? [],
    createdAt: old?.createdAt ?? ctx.at,
  };
  if (goal.keyResults.length === 0)
    return err(failure('NO_KR', 'A goal needs at least one key result'));
  await ctx.tx.goals.save(goal);
  await audit(ctx, { kind: 'goal',
    action: id === null ? 'Created a goal' : 'Edited a goal',
    target: input.title,
    targetId: goal.id,
    fields: Object.keys(input),
  });
  return ok({ id: goal.id });
}

export async function setGoalStatus(
  ctx: Ctx,
  id: string,
  status: Goal['status'],
): Promise<Result<{ ok: true }>> {
  const g = await ctx.tx.goals.get(id);
  if (g === null) return err(notFound('goal'));
  if (
    g.ownerId !== ctx.viewer.personId &&
    !ctx.viewer.hr &&
    !(g.ownerId !== null && ctx.viewer.org.has(g.ownerId))
  )
    return err(forbidden());
  await ctx.tx.goals.save({ ...g, status });
  await audit(ctx, { kind: 'goal',
    action: 'Changed a goal’s status',
    target: g.title,
    targetId: id,
    fields: ['status'],
  });
  return ok({ ok: true });
}

export async function checkInGoal(
  ctx: Ctx,
  id: string,
  input: {
    values: Record<string, number>;
    confidence: 'on_track' | 'at_risk' | 'off_track';
    note: string | null;
  },
): Promise<Result<{ progress: number }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const g = await ctx.tx.goals.get(id);
  if (g === null) return err(notFound('goal'));
  if (g.ownerId !== who.value && !ctx.viewer.org.has(g.ownerId ?? '') && !ctx.viewer.hr)
    return err(forbidden('Only the owner and their managers check in'));
  const next = addCheckIn(g, {
    at: ctx.at,
    by: who.value,
    values: input.values,
    confidence: input.confidence,
    note: input.note,
  });
  if (!next.ok) return next;
  await ctx.tx.goals.save(next.value);
  const p = progress(next.value);
  await publish(
    ctx,
    event(
      ctx,
      'performance.goal.checked_in',
      { type: 'goal', id },
      { goalId: id, owner: g.ownerId ?? who.value, progress: p, confidence: input.confidence },
    ),
  );
  await audit(ctx, { kind: 'goal',
    action: 'Checked in on a goal',
    target: g.title,
    targetId: id,
    fields: Object.keys(input.values),
  });
  return ok({ progress: p });
}

/** PF18f: goals into a cycle (§14.6): scored in a generated section, for the people chosen. */
export async function attachGoals(
  ctx: Ctx,
  cycleId: string,
  input: { mode: 'none' | 'context' | 'scored'; people: string[] },
): Promise<Result<{ attached: number }>> {
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return err(notFound('cycle'));
  if (!ctx.viewer.hr && !input.people.every((p) => ctx.viewer.reports.has(p)))
    return err(forbidden('You attach goals for your reports'));
  if (ctx.viewer.hr && input.mode !== c.goals)
    await ctx.tx.cycles.save({ ...c, goals: input.mode, version: c.version + 1 });
  let attached = 0;
  if (input.mode === 'scored') {
    const periods = (await settingsOf(ctx)).goals.periods
      .filter((p) => p.from <= c.period.to && p.to >= c.period.from)
      .map((p) => p.id);
    for (const r of await ctx.tx.reviews.find({ cycleId })) {
      if (
        !(r.kind === 'manager' || r.kind === 'self') ||
        (input.people.length > 0 && !input.people.includes(r.subjectId))
      )
        continue;
      const goals = (await ctx.tx.goals.find({ ownerId: r.subjectId }))
        .filter((g) => periods.includes(g.periodId) && g.status === 'active')
        .map((g) => g.id);
      if (['not_started', 'in_progress', 'unlocked'].includes(r.status)) {
        await ctx.tx.reviews.save({ ...r, goals });
        attached += goals.length;
      }
    }
  }
  await audit(ctx, { kind: 'cycle',
    action: 'Attached goals to a cycle',
    target: c.name,
    targetId: cycleId,
    fields: ['goals'],
  });
  ctx.touched.add(cycleId);
  return ok({ attached });
}

/** The people a goal attachment dialog lists, with their goal counts. */
export async function attachScreen(ctx: Ctx, cycleId: string): Promise<Result<unknown>> {
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return err(notFound('cycle'));
  const all = await people(ctx);
  const goals = await ctx.tx.goals.find();
  const subjects = (c.snapshot?.subjects ?? []).filter(
    (s) => ctx.viewer.hr || ctx.viewer.reports.has(s),
  );
  return ok({
    cycle: { id: c.id, name: c.name, goals: c.goals },
    rows: subjects.map((s) => {
      const p = all.find((x) => x.personId === s);
      return {
        personId: s,
        name: p?.name ?? 'Someone',
        title: subtitle(p),
        goals: goals.filter((g) => g.ownerId === s && g.status === 'active').length,
      };
    }),
  });
}

export { checkWeights };
