import { ok, type Result } from '@kithena/domain-kit';
import {
  ASSISTANT_LIMITS,
  PERFORMANCE_INBOX_KINDS,
  PerformanceCycles,
  PerformanceFeedbackAsked,
  PerformanceGoals,
  PerformanceLearningDue,
  PerformanceOwed,
  PerformanceTeamReviews,
  performanceCapabilities,
  type CapabilityInput,
  type ItemsResult,
  type RuntimeCatalogue,
} from '@kithena/contracts';

import { confidence, progress } from '../domain/goals.js';
import { isSubmitted } from '../domain/review.js';
import { names, type Ctx } from './context.js';
import { countsOf } from './cycles.js';
import { inbox } from './home.js';

/**
 * Performance's capabilities for the assistant (PRD §22.10, PRF-194), each a
 * read of what the asker's own Performance screens show them, so it says no
 * more than they could see: what is due, by whom, how far it has got. Never
 * what a review, a piece of feedback or a note says, and never a score.
 */

export const capabilityCatalogue = (): RuntimeCatalogue => ({
  module: 'performance',
  serves: performanceCapabilities.map((c) => ({ name: c.name, version: c.version })),
  fields: {},
  metrics: [],
  leaveTypes: [],
  chatNamesPrivateLeave: false,
  denied: [],
});

const CONFIDENCE: Readonly<Record<string, string>> = {
  on_track: 'on track',
  at_risk: 'at risk',
  off_track: 'off track',
};

type Item = ItemsResult['items'][number];
const line = (text: string): string => text.slice(0, 200);
const dueOn = (due: string | null): string => (due === null ? '' : ` · due ${due}`);

/** One capability, as the asker: items and how many there are in all. */
export async function answer(
  ctx: Ctx,
  name: string,
  input: CapabilityInput,
): Promise<Result<ItemsResult>> {
  const limit = input.limit ?? ASSISTANT_LIMITS.listed;
  const me = ctx.viewer.name;
  const who = await names(ctx);
  let items: Item[] = [];
  switch (name) {
    case PerformanceOwed.name:
    case PerformanceFeedbackAsked.name:
    case PerformanceLearningDue.name: {
      const kinds: readonly string[] =
        name === PerformanceOwed.name
          ? [
              PERFORMANCE_INBOX_KINDS.review,
              PERFORMANCE_INBOX_KINDS.nominate,
              PERFORMANCE_INBOX_KINDS.approveNominations,
            ]
          : name === PerformanceFeedbackAsked.name
            ? [PERFORMANCE_INBOX_KINDS.feedbackRequest]
            : [PERFORMANCE_INBOX_KINDS.learning];
      items = (await inbox(ctx))
        .filter((i) => i.lane === 'task' && kinds.includes(i.kind))
        .map((i) => ({ name: me, label: line(`${i.title}${dueOn(i.due)}`) }));
      // A manager's team's training due, after their own.
      if (name === PerformanceLearningDue.name)
        for (const a of await ctx.tx.assignments.find())
          if (ctx.viewer.reports.has(a.personId) && a.completedAt === null) {
            const item = await ctx.tx.items.get(a.itemId);
            if (item !== null)
              items.push({ name: who(a.personId), label: line(`${item.title}${dueOn(a.due)}`) });
          }
      break;
    }
    case PerformanceGoals.name: {
      const goals = await ctx.tx.goals.find();
      const live = goals.filter((g) => g.status === 'active');
      items = [
        ...live
          .filter((g) => g.ownerId !== null && g.ownerId === ctx.viewer.personId)
          .map((g) => ({
            name: me,
            label: line(
              `${g.title} · ${String(progress(g))}% · ${CONFIDENCE[confidence(g)] ?? ''}`,
            ),
          })),
        ...live
          .filter(
            (g) =>
              g.ownerId !== null && ctx.viewer.org.has(g.ownerId) && confidence(g) !== 'on_track',
          )
          .map((g) => ({
            name: who(g.ownerId),
            label: line(
              `${g.title} · ${String(progress(g))}% · ${CONFIDENCE[confidence(g)] ?? ''}`,
            ),
          })),
      ];
      break;
    }
    case PerformanceTeamReviews.name: {
      const running = (await ctx.tx.cycles.find()).filter((c) => c.state === 'in_progress');
      for (const c of running) {
        const reviews = await ctx.tx.reviews.find({ cycleId: c.id });
        for (const report of ctx.viewer.reports) {
          const about = reviews.filter(
            (r) =>
              r.subjectId === report &&
              r.detached === null &&
              !r.hidden &&
              r.status !== 'cancelled',
          );
          if (about.length === 0) continue;
          const late = about.filter((r) => !isSubmitted(r) && r.due < ctx.today).length;
          items.push({
            name: who(report),
            label: line(
              `${c.name} · ${String(about.filter(isSubmitted).length)} of ${String(about.length)} reviews in${late === 0 ? '' : ` · ${String(late)} late`}`,
            ),
          });
        }
      }
      break;
    }
    case PerformanceCycles.name: {
      const running = (await ctx.tx.cycles.find()).filter((c) => c.state === 'in_progress');
      for (const c of running) {
        const all = await ctx.tx.reviews.find({ cycleId: c.id });
        // HR sees every cycle; a manager, the part about their organisation.
        const mine = ctx.viewer.hr ? all : all.filter((r) => ctx.viewer.org.has(r.subjectId));
        if (mine.length === 0) continue;
        const counts = countsOf(mine, ctx.today);
        items.push({
          name: me,
          label: line(
            `${c.name} · ${String(counts.submitted)} of ${String(counts.reviews)} reviews in${counts.overdue === 0 ? '' : ` · ${String(counts.overdue)} late`}`,
          ),
        });
      }
      break;
    }
    default:
      items = [];
  }
  return ok({
    kind: 'items',
    items: items.slice(0, Math.min(limit, ASSISTANT_LIMITS.listed)),
    total: items.length,
  });
}
