import * as z from 'zod';
import type { Result } from '@kithena/domain-kit';

import { METRICS, type ChartPlan } from '../domain/analytics/metrics.js';
import { write, type PromptSpec } from './ai.js';
import { chart } from './analytics.js';
import type { Ctx } from './context.js';

/**
 * R25, "ask for a chart" (PRD §23.4, REC-122): the model sees the question and
 * the metrics catalogue — names, never a value — and returns a plan. The
 * domain validates the plan whole and computes it, exactly as when a person
 * builds it from the chips; the plan comes back as chips anyone can change.
 */

const DIMENSIONS = [
  'department',
  'source',
  'job',
  'stage',
  'hiring_manager',
  'country',
  'month',
  'rejection_reason',
] as const;
const PERIODS = ['last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'last_year'] as const;
const CHARTS = [
  'funnel',
  'trend',
  'bar',
  'stacked_bar',
  'heatmap',
  'bullet',
  'combo',
  'donut',
  'cohort',
] as const;

const Plan = z.object({
  metric: z.string().max(60),
  breakdown: z.enum(DIMENSIONS).nullable(),
  filters: z.record(z.string(), z.array(z.string().max(120)).max(20)),
  period: z.enum(PERIODS),
  compare: z.enum(PERIODS).nullable(),
  chart: z.enum(CHARTS),
});

const PLAN: PromptSpec<z.infer<typeof Plan>> = {
  feature: 'charts',
  version: 'chart-plan@1',
  instruction: `You turn a question about hiring into a chart plan. Return a JSON object {"metric":"","breakdown":""|null,"filters":{},"period":"","compare":""|null,"chart":""} using only the names in "catalogue": a metric's key, one of its dimensions as the breakdown, filters keyed by its dimensions, a period from "periods", and one of its chart kinds. Choose; never compute or state a number.`,
  answer: Plan,
};

export async function askForChart(
  ctx: Ctx,
  question: string,
): Promise<Result<{ plan: ChartPlan; rows: readonly unknown[] }>> {
  const planned = await write(ctx, PLAN, {
    question: question.slice(0, 300),
    catalogue: METRICS.map((m) => ({
      key: m.key,
      label: m.label,
      dimensions: m.dimensions,
      charts: m.charts,
    })),
    periods: PERIODS,
  });
  if (!planned.ok) return planned;
  return chart(ctx, planned.value);
}
