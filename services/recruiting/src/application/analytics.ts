import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { StageCategory } from '@kithena/contracts';

import { effectiveHistory, furthestCategory } from '../domain/pipeline/application.js';
import {
  breakdown,
  funnel,
  percentile,
  timeToFill,
  timeToHire,
  validatePlan,
  type AppFacts,
  type Bucket,
  type ChartPlan,
  type Period,
} from '../domain/analytics/metrics.js';
import { adminOnly, type Ctx } from './context.js';
import { myJobs } from './jobs.js';

/**
 * Recruiting analytics (PRD §23, REC-057): every number computed by the
 * domain from the append-only history, offers and sources, with the period
 * deciding by the moves' times. Administrators see every job; the hiring
 * team sees theirs.
 */

const PERIOD_DAYS: Readonly<Record<Period, number>> = {
  last_30_days: 30,
  last_90_days: 90,
  this_quarter: 92,
  this_year: 365,
  last_year: 730,
};

export interface Filters {
  readonly period: Period;
  readonly jobId?: string | undefined;
  readonly department?: string | undefined;
  readonly source?: string | undefined;
}

async function facts(ctx: Ctx, filters: Filters): Promise<AppFacts[]> {
  const jobs = await myJobs(ctx);
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const since = new Date(
    Date.parse(ctx.at) - PERIOD_DAYS[filters.period] * 86_400_000,
  ).toISOString();
  const out: AppFacts[] = [];
  for (const app of await ctx.tx.applications.all()) {
    const job = byId.get(app.jobId);
    if (job === undefined || app.createdAt < since) continue;
    if (filters.jobId !== undefined && app.jobId !== filters.jobId) continue;
    if (filters.department !== undefined && job.department !== filters.department) continue;
    const source = app.source.kind === 'target' ? app.source.target : app.source.kind;
    if (filters.source !== undefined && source !== filters.source) continue;
    const stages = await ctx.tx.jobs.stages(app.jobId);
    const hiredMove = effectiveHistory(app).find(
      (m) => stages.find((s) => s.id === m.to)?.category === 'hired',
    );
    out.push({
      id: app.id,
      jobId: app.jobId,
      receivedAt: app.createdAt,
      hiredAt: hiredMove?.at ?? null,
      reached: furthestCategory(app, stages),
      outcome: app.outcome,
      rejectionReason: app.rejection?.reasonKey ?? null,
      source,
      department: job.department,
    });
  }
  return out;
}

export interface Overview {
  readonly openJobs: number;
  readonly applications: number;
  readonly hires: number;
  readonly offersOut: number;
  readonly funnel: ReturnType<typeof funnel>;
  readonly hiresByMonth: readonly { readonly month: string; readonly hires: number }[];
  readonly timeToHire: { readonly median: number | null; readonly p85: number | null };
  readonly sources: readonly Bucket[];
  readonly rejectionReasons: readonly Bucket[];
}

export async function overview(ctx: Ctx, filters: Filters): Promise<Overview> {
  const apps = await facts(ctx, filters);
  const jobs = await myJobs(ctx);
  const offers = await ctx.tx.offers.list();
  const visible = new Set(apps.map((a) => a.id));
  const hires = apps.filter((a) => a.hiredAt !== null);
  const months = new Map<string, number>();
  for (const h of hires)
    months.set((h.hiredAt ?? '').slice(0, 7), (months.get((h.hiredAt ?? '').slice(0, 7)) ?? 0) + 1);
  const days = hires.map(timeToHire).filter((d): d is number => d !== null);
  return {
    openJobs: jobs.filter((j) => j.state === 'open').length,
    applications: apps.length,
    hires: hires.length,
    offersOut: offers.filter((o) => o.state === 'sent' && visible.has(o.applicationId)).length,
    funnel: funnel(apps),
    hiresByMonth: [...months.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([month, n]) => ({ month, hires: n })),
    timeToHire: { median: percentile(days, 50), p85: percentile(days, 85) },
    sources: breakdown(
      apps,
      (a) => a.source,
      (g) => g.length,
      false,
    ),
    rejectionReasons: breakdown(
      apps.filter((a) => a.rejectionReason !== null),
      (a) => a.rejectionReason ?? '',
      (g) => g.length,
      false,
    ),
  };
}

/** Time to fill per job: opened to the last opening hired. */
export async function speed(
  ctx: Ctx,
  filters: Filters,
): Promise<
  readonly { readonly jobId: string; readonly title: string; readonly days: number | null }[]
> {
  const apps = await facts(ctx, filters);
  return (await myJobs(ctx))
    .filter((j) => j.openedAt !== null && (filters.jobId === undefined || j.id === filters.jobId))
    .map((j) => ({
      jobId: j.id,
      title: j.title,
      days: timeToFill(
        j.openedAt ?? '',
        apps.filter((a) => a.jobId === j.id && a.hiredAt !== null).map((a) => a.hiredAt ?? ''),
        j.openings,
      ),
    }));
}

/** Time in stage, days, by category: the funnel dashboard's heatmap rows. */
export async function timeInStage(
  ctx: Ctx,
  filters: Filters,
): Promise<readonly { readonly category: StageCategory; readonly median: number | null }[]> {
  const per = new Map<StageCategory, number[]>();
  for (const app of await ctx.tx.applications.all()) {
    if (filters.jobId !== undefined && app.jobId !== filters.jobId) continue;
    const stages = await ctx.tx.jobs.stages(app.jobId);
    const moves = effectiveHistory(app);
    for (const [i, move] of moves.entries()) {
      const next = moves[i + 1]?.at ?? (app.outcome === 'active' ? ctx.at : null);
      const category = stages.find((s) => s.id === move.to)?.category;
      if (next === null || category === undefined) continue;
      per.set(category, [
        ...(per.get(category) ?? []),
        (Date.parse(next) - Date.parse(move.at)) / 86_400_000,
      ]);
    }
  }
  return [...per.entries()].map(([category, values]) => ({
    category,
    median: percentile(values, 50),
  }));
}

/** Offer acceptance (PRD §23.2 Offers): accepted over decided. */
export async function offerAcceptance(ctx: Ctx): Promise<{
  readonly sent: number;
  readonly accepted: number;
  readonly declined: number;
  readonly rate: string | null;
}> {
  const offers = await ctx.tx.offers.list();
  const accepted = offers.filter((o) => o.state === 'accepted').length;
  const declined = offers.filter((o) => o.state === 'declined').length;
  const decided = accepted + declined;
  return {
    sent: offers.filter((o) => o.state !== 'draft').length,
    accepted,
    declined,
    rate: decided === 0 ? null : ((accepted / decided) * 100).toFixed(0),
  };
}

/** A chart plan (PRD §23.4), from chips or a model: validated whole, then computed. */
export async function chart(
  ctx: Ctx,
  plan: ChartPlan,
): Promise<Result<{ plan: ChartPlan; rows: readonly Bucket[] }>> {
  const valid = validatePlan(plan);
  if (!valid.ok) return err(failure('PLAN', valid.reason));
  const apps = await facts(ctx, { period: plan.period });
  const by = (a: AppFacts): string =>
    plan.breakdown === 'department'
      ? (a.department ?? 'None')
      : plan.breakdown === 'source'
        ? a.source
        : plan.breakdown === 'job'
          ? a.jobId
          : plan.breakdown === 'stage'
            ? a.reached
            : plan.breakdown === 'rejection_reason'
              ? (a.rejectionReason ?? 'None')
              : plan.breakdown === 'month'
                ? a.receivedAt.slice(0, 7)
                : 'All';
  const metric = valid.metric.key;
  const value = (group: readonly AppFacts[]): number | null =>
    metric === 'hires'
      ? group.filter((a) => a.hiredAt !== null).length
      : metric === 'time_to_hire'
        ? percentile(
            group.map(timeToHire).filter((d): d is number => d !== null),
            50,
          )
        : metric === 'rejection_reasons'
          ? group.filter((a) => a.rejectionReason !== null).length
          : group.length;
  return ok({ plan, rows: breakdown(apps, by, value, valid.metric.personal) });
}

export async function savedView(
  ctx: Ctx,
  dashboard: string,
  name: string,
  query: string,
): Promise<Result<true>> {
  const may = adminOnly(ctx);
  if (!may.ok && ctx.viewer.personId === null) return may;
  await ctx.tx.settings.set(`view:${ctx.caller.accountId}:${dashboard}:${name}`, {
    query,
    createdAt: ctx.at,
  });
  return ok(true);
}
