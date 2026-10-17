import { err, ok, type Result } from '@kithena/domain-kit';

import { isSubmitted, scoreOf, type Review } from '../domain/review.js';
import { forbidden, names, notFound, type Ctx } from './context.js';
import { people } from './members.js';
import { settingsOf } from './settings.js';

/**
 * Analytics (PRD §18, PRF-047, PRF-113): every number computed here from the
 * stored answers, groups under the cohort minimum hidden, for HR and the
 * people who calibrate. Asking for a chart in words is `ai.ts`'s, over the
 * metrics below.
 */

export const COHORT = 5;

const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
const round2 = (x: number | null): number | null => (x === null ? null : Math.round(x * 100) / 100);

function mayRead(ctx: Ctx): boolean {
  return ctx.viewer.hr;
}

/** A metric by a breakdown, the shape every chart here and every asked-for chart is drawn from. */
export async function metric(
  ctx: Ctx,
  input: {
    metric: 'completion' | 'score' | 'onTime' | 'submitted';
    by: 'department' | 'manager' | 'kind' | 'none';
    cycleId: string | null;
    kind?: string;
  },
): Promise<{ label: string; value: number | null; n: number }[]> {
  const all = await people(ctx);
  const byId = new Map(all.map((p) => [p.personId, p]));
  const name = await names(ctx);
  const reviews = (
    input.cycleId === null
      ? await ctx.tx.reviews.find()
      : await ctx.tx.reviews.find({ cycleId: input.cycleId })
  ).filter(
    (r) =>
      !r.hidden &&
      r.detached === null &&
      r.status !== 'cancelled' &&
      (input.kind === undefined || r.kind === input.kind),
  );
  const keyOf = (r: Review): string =>
    input.by === 'department'
      ? (byId.get(r.subjectId)?.department ?? 'No department')
      : input.by === 'manager'
        ? name(r.authorId)
        : input.by === 'kind'
          ? r.kind
          : 'All';
  const groups = new Map<string, Review[]>();
  for (const r of reviews) groups.set(keyOf(r), [...(groups.get(keyOf(r)) ?? []), r]);
  return [...groups].map(([label, rs]) => {
    const subjects = new Set(rs.map((r) => r.subjectId)).size;
    const hidden = subjects < COHORT && input.by !== 'none' && input.by !== 'kind';
    const submitted = rs.filter(isSubmitted);
    const value =
      input.metric === 'completion'
        ? (submitted.length / Math.max(1, rs.length)) * 100
        : input.metric === 'submitted'
          ? submitted.length
          : input.metric === 'onTime'
            ? (submitted.filter((r) => (r.submitted[0]?.at.slice(0, 10) ?? '') <= r.due).length /
                Math.max(1, submitted.length)) *
              100
            : mean(
                submitted
                  .map(scoreOf)
                  .filter((s): s is number => s !== null)
                  .map((s) => s / 100),
              );
    return {
      label,
      value: hidden || value === null ? null : Math.round(value * 100) / 100,
      n: subjects,
    };
  });
}

export async function analyticsScreen(
  ctx: Ctx,
  opts: { tab?: string; cycleId?: string; personId?: string },
): Promise<Result<unknown>> {
  if (!mayRead(ctx)) return err(forbidden('Analytics are for HR and calibrators'));
  const cycles = (await ctx.tx.cycles.find())
    .filter((c) => c.state !== 'draft')
    .toSorted((a, b) => b.start.date.localeCompare(a.start.date));
  const cycle = cycles.find((c) => c.id === opts.cycleId) ?? cycles[0] ?? null;
  const scale = (await settingsOf(ctx)).general.scale;
  const tab = opts.tab ?? 'cycle';
  const base = {
    tab,
    cycles: cycles.map((c) => ({ id: c.id, name: c.name })),
    cycleId: cycle?.id ?? null,
    cohort: COHORT,
  };
  if (cycle === null) return ok({ ...base, empty: true });
  const reviews = (await ctx.tx.reviews.find({ cycleId: cycle.id })).filter(
    (r) => !r.hidden && r.detached === null && r.status !== 'cancelled',
  );
  const submitted = reviews.filter(isSubmitted);
  const manager = submitted.filter((r) => r.kind === 'manager');
  const scores = manager.map(scoreOf).filter((s): s is number => s !== null);
  if (tab === 'cycle') {
    const perDay = new Map<string, number>();
    for (const r of submitted) {
      const d = r.submitted[0]?.at.slice(0, 10);
      if (d !== undefined) perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const kinds = ['self', 'peer', 'manager', 'upward'];
    return ok({
      ...base,
      tiles: {
        completion:
          reviews.length === 0 ? 0 : Math.round((submitted.length / reviews.length) * 100),
        byKind: Object.fromEntries(
          kinds.map((k) => [
            k,
            Math.round(
              (submitted.filter((r) => r.kind === k).length /
                Math.max(1, reviews.filter((r) => r.kind === k).length)) *
                100,
            ),
          ]),
        ),
        onTime:
          submitted.length === 0
            ? null
            : Math.round(
                (submitted.filter((r) => (r.submitted[0]?.at.slice(0, 10) ?? '') <= r.due).length /
                  submitted.length) *
                  100,
              ),
        average: round2(mean(scores.map((s) => s / 100))),
        acknowledged: manager.filter((r) => r.acknowledged !== null).length,
        released: manager.filter((r) => r.released !== null).length,
      },
      byDepartment: await metric(ctx, {
        metric: 'completion',
        by: 'department',
        cycleId: cycle.id,
        kind: 'self',
      }),
      distribution: scale.map((o) => ({
        label: o.label,
        value: o.value,
        count: scores.filter((s) => Math.round(s / 100) === o.value).length,
      })),
      perDay: [...perDay]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([day, count]) => ({ day, count })),
    });
  }
  if (tab === 'raters') {
    const name = await names(ctx);
    const company = mean(scores.map((s) => s / 100));
    const byRater = new Map<string, number[]>();
    for (const r of manager) {
      const s = scoreOf(r);
      if (s !== null) byRater.set(r.authorId, [...(byRater.get(r.authorId) ?? []), s / 100]);
    }
    const raters = [...byRater]
      .filter(([, xs]) => xs.length >= COHORT)
      .map(([id, xs]) => ({
        name: name(id),
        average: round2(mean(xs)),
        count: xs.length,
        spread: scale.map((o) => xs.filter((x) => Math.round(x) === o.value).length),
      }));
    const notes = raters
      .filter((r) => company !== null && r.average !== null && Math.abs(r.average - company) >= 0.5)
      .map((r) => ({
        tone: 'warning',
        title: `${r.name} rates ${String(round2(Math.abs((r.average ?? 0) - (company ?? 0))))} ${(r.average ?? 0) > (company ?? 0) ? 'above' : 'below'} the average`,
        detail: `${String(r.count)} reviews.`,
      }));
    return ok({
      ...base,
      company: round2(company),
      raters,
      notes,
      hiddenRaters: [...byRater].filter(([, xs]) => xs.length < COHORT).length,
    });
  }
  if (tab === 'trends') {
    const trend = [];
    for (const c of cycles.toReversed()) {
      const rs = (await ctx.tx.reviews.find({ cycleId: c.id })).filter(
        (r) => r.kind === 'manager' && isSubmitted(r),
      );
      const sub = (await ctx.tx.reviews.find({ cycleId: c.id })).filter(isSubmitted);
      trend.push({
        cycle: c.name,
        average: round2(
          mean(
            rs
              .map(scoreOf)
              .filter((s): s is number => s !== null)
              .map((s) => s / 100),
          ),
        ),
        onTime:
          sub.length === 0
            ? null
            : Math.round(
                (sub.filter((r) => (r.submitted[0]?.at.slice(0, 10) ?? '') <= r.due).length /
                  sub.length) *
                  100,
              ),
      });
    }
    return ok({
      ...base,
      trend,
      timeline: opts.personId === undefined ? null : await timeline(ctx, opts.personId),
      people: (await people(ctx)).map((p) => ({ personId: p.personId, name: p.name })),
    });
  }
  if (tab === 'fairness') {
    // Special-category data only from voluntary self-ID, which Performance does not hold yet.
    const withAi = manager.filter(
      (r) => r.drafted.length > 0 || Object.keys(r.suggestions).length > 0,
    );
    const without = manager.filter((r) => !withAi.includes(r));
    const avg = (rs: Review[]) =>
      rs.length < COHORT
        ? null
        : round2(
            mean(
              rs
                .map(scoreOf)
                .filter((s): s is number => s !== null)
                .map((s) => s / 100),
            ),
          );
    return ok({
      ...base,
      prefill: [
        { label: 'Prefill used', value: avg(withAi), n: withAi.length },
        { label: 'Written without', value: avg(without), n: without.length },
      ],
      byDepartment: await metric(ctx, {
        metric: 'score',
        by: 'department',
        cycleId: cycle.id,
        kind: 'manager',
      }),
      hidden: [
        {
          title: 'Gender, age and ethnicity: not collected',
          detail:
            'Performance holds no self-ID answers. Groups appear here once People shares them with consent.',
        },
      ],
    });
  }
  return ok({
    ...base,
    saved: (await ctx.tx.charts.find({ ownerId: ctx.viewer.personId ?? ctx.viewer.accountId })).map(
      (c) => ({ id: c.id, title: c.title, plan: c.plan }),
    ),
  });
}

/** PF7c: everything performance about one person, in order. */
export interface Timeline {
  readonly personId: string;
  readonly name: string;
  readonly events: readonly { at: string; title: string; detail: string; icon: string }[];
}

export async function timeline(ctx: Ctx, personId: string): Promise<Timeline | null> {
  if (!ctx.viewer.hr && !ctx.viewer.org.has(personId) && ctx.viewer.personId !== personId)
    return null;
  const name = await names(ctx);
  const out: { at: string; title: string; detail: string; icon: string }[] = [];
  const cycles = new Map((await ctx.tx.cycles.find()).map((c) => [c.id, c.name]));
  for (const r of await ctx.tx.reviews.find({ subjectId: personId })) {
    if (r.kind === 'manager' && r.released !== null)
      out.push({
        at: r.released.at,
        title: 'Manager review released',
        detail: `${cycles.get(r.cycleId ?? '') ?? ''} · ${String((scoreOf(r) ?? 0) / 100)}`,
        icon: 'file-check',
      });
    if (r.acknowledged !== null)
      out.push({
        at: r.acknowledged.at,
        title: 'Acknowledged a review',
        detail: cycles.get(r.cycleId ?? '') ?? '',
        icon: 'circle-check',
      });
  }
  for (const f of await ctx.tx.feedback.find({ subjectId: personId }))
    if (f.kind === 'praise' && !f.undone)
      out.push({
        at: f.at,
        title: `Praise from ${name(f.from)}`,
        detail: f.value ?? '',
        icon: 'party-popper',
      });
  for (const a of await ctx.tx.assignments.find({ ownerId: personId }))
    if (a.completedAt !== null)
      out.push({
        at: a.completedAt,
        title: `${(await ctx.tx.items.get(a.itemId))?.title ?? 'Learning'} completed`,
        detail: a.expiresOn === null ? '' : `Expires ${a.expiresOn}`,
        icon: 'graduation-cap',
      });
  for (const g of await ctx.tx.goals.find({ ownerId: personId }))
    out.push({
      at: g.createdAt,
      title: `Goal set: ${g.title}`,
      detail: g.periodId,
      icon: 'target',
    });
  const p = (await people(ctx)).find((x) => x.personId === personId);
  if (p?.hiredOn)
    out.push({
      at: `${p.hiredOn}T00:00:00.000Z`,
      title: 'Joined',
      detail: 'From People',
      icon: 'user-plus',
    });
  return {
    personId,
    name: name(personId),
    events: out.toSorted((a, b) => b.at.localeCompare(a.at)),
  };
}

export async function personSummary(ctx: Ctx, personId: string): Promise<Result<unknown>> {
  if (!ctx.viewer.hr && !ctx.viewer.org.has(personId) && ctx.viewer.personId !== personId)
    return err(notFound('person'));
  const reviews = (await ctx.tx.reviews.find({ subjectId: personId })).filter(
    (r) => !r.hidden && r.status !== 'cancelled',
  );
  const cycles = await ctx.tx.cycles.find();
  const running = cycles.find(
    (c) => c.state === 'in_progress' && reviews.some((r) => r.cycleId === c.id),
  );
  const self =
    running === undefined
      ? undefined
      : reviews.find((r) => r.cycleId === running.id && r.kind === 'self');
  const last = reviews
    .filter((r) => r.kind === 'manager' && isSubmitted(r) && r.released !== null)
    .toSorted((a, b) => (b.released?.at ?? '').localeCompare(a.released?.at ?? ''))[0];
  const goals = (await ctx.tx.goals.find({ ownerId: personId })).filter(
    (g) => g.status === 'active',
  );
  const learning = (await ctx.tx.assignments.find({ ownerId: personId })).filter(
    (a) => a.completedAt === null,
  );
  return ok({
    current:
      running === undefined
        ? null
        : `${running.name} · self review ${self === undefined ? 'not asked' : isSubmitted(self) ? 'submitted' : 'not submitted'}`,
    lastScore:
      last === undefined
        ? null
        : `${String((scoreOf(last) ?? 0) / 100)} · ${cycles.find((c) => c.id === last.cycleId)?.name ?? ''}`,
    goals: goals.length,
    learning: learning.length,
  });
}
