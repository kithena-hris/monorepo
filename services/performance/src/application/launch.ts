import { dateFormat } from '@kithena/domain-kit';
import type { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import { move, type Cycle } from '../domain/cycle.js';
import { isSubmitted } from '../domain/review.js';
import {
  contextOf,
  deliver,
  event,
  names,
  publish,
  SYSTEM,
  type Ctx,
  type Outgoing,
} from './context.js';
import { beginLaunch, liveOf, reviewsFor } from './cycles.js';
import type { Caller, Deps } from './ports.js';
import { runAutomations } from './automations.js';

/**
 * The launch engine and the sweep (PRD §8.7, PRF-042). A launch creates its
 * reviews in batches, one transaction each, idempotent per (cycle, activity,
 * subject, reviewer), hidden until the last batch shows them together; a
 * failure leaves the cycle at `launch_failed` with the reason, and a retry
 * continues from the subject it stopped at. The sweep starts scheduled
 * cycles on time, resumes a launch a restart interrupted, releases on a date,
 * sends the day's reminders and runs automations.
 *
 * ponytail: in-process, one instance; Temporal's `CycleWorkflow` when
 * Performance runs on more than one.
 */

const BATCH = 25;
const running = new Set<string>();

const system = (tenantId: TenantId, deps: Deps): Caller => ({
  tenantId,
  accountId: SYSTEM,
  personId: null,
  correlationId: deps.newId(),
  via: 'Kithena',
});

async function asSystem<T>(
  deps: Deps,
  tenantId: TenantId,
  fn: (ctx: Ctx) => Promise<T>,
): Promise<T> {
  const mail: Outgoing[] = [];
  let touched: string[] = [];
  const answer = await deps.uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, system(tenantId, deps), mail);
    const out = await fn(ctx);
    touched = [...ctx.touched];
    return out;
  });
  await deliver(deps, tenantId, mail);
  await tell(deps, tenantId, touched);
  return answer;
}

/** Tell the live stream about the cycles a transaction changed, once it committed. */
export async function tell(
  deps: Deps,
  tenantId: TenantId,
  cycleIds: readonly string[],
): Promise<void> {
  if (cycleIds.length === 0) return;
  await deps.uow.run(tenantId, async (tx) => {
    const ctx = await contextOf(deps, tx, system(tenantId, deps));
    for (const id of cycleIds) {
      const change = await liveOf(ctx, id);
      if (change !== null) deps.live.publish(tenantId, change);
    }
  });
}

/** Run a launch to the end, unless one is already running here. */
export function startLaunch(deps: Deps, tenantId: TenantId, cycleId: string): void {
  const key = `${tenantId}:${cycleId}`;
  if (running.has(key)) return;
  running.add(key);
  void runLaunch(deps, tenantId, cycleId)
    .catch((e: unknown) => {
      logger.error({ module: 'performance', cycleId, err: e }, 'launch failed');
    })
    .finally(() => running.delete(key));
}

export async function runLaunch(deps: Deps, tenantId: TenantId, cycleId: string): Promise<void> {
  for (;;) {
    let more = false;
    try {
      more = await asSystem(deps, tenantId, async (ctx) => {
        const c = await ctx.tx.cycles.get(cycleId);
        if (c?.state !== 'launching' || c.snapshot === null) return false;
        const subjects = c.snapshot.subjects;
        const slice = subjects.slice(c.launch.done, c.launch.done + BATCH);
        let created = 0;
        for (const s of slice) created += await reviewsFor(ctx, c, s, { hidden: true });
        const done = c.launch.done + slice.length;
        const next: Cycle = {
          ...c,
          version: c.version + 1,
          launch: { ...c.launch, done, created: c.launch.created + created },
        };
        ctx.touched.add(c.id);
        if (done < subjects.length) {
          await ctx.tx.cycles.save(next);
          return true;
        }
        await reveal(ctx, next);
        return false;
      });
    } catch (e) {
      await asSystem(deps, tenantId, async (ctx) => {
        const c = await ctx.tx.cycles.get(cycleId);
        if (c?.state !== 'launching') return;
        const failed = move(c, 'launch_failed');
        if (!failed.ok) return;
        await ctx.tx.cycles.save({
          ...failed.value,
          launch: {
            ...c.launch,
            error: e instanceof Error ? e.message : 'The launch stopped',
            at: ctx.at,
          },
        });
        await publish(
          ctx,
          event(
            ctx,
            'performance.cycle.state_changed',
            { type: 'cycle', id: c.id },
            { cycleId: c.id, from: 'launching', to: 'launch_failed', reviews: c.launch.created },
          ),
        );
        ctx.touched.add(c.id);
      });
      return;
    }
    if (!more) return;
  }
}

/** The last batch: every review shown at once, the cycle in progress, the writers told. */
async function reveal(ctx: Ctx, c: Cycle): Promise<void> {
  const reviews = await ctx.tx.reviews.find({ cycleId: c.id });
  for (const r of reviews) if (r.hidden) await ctx.tx.reviews.save({ ...r, hidden: false });
  const live = move(c, 'in_progress');
  if (!live.ok) return;
  await ctx.tx.cycles.save({ ...live.value, launch: { ...c.launch, error: null } });
  await publish(
    ctx,
    event(
      ctx,
      'performance.cycle.state_changed',
      { type: 'cycle', id: c.id },
      { cycleId: c.id, from: 'launching', to: 'in_progress', reviews: reviews.length },
    ),
  );
  const name = await names(ctx);
  const members = await ctx.members();
  for (const author of new Set(reviews.map((r) => r.authorId))) {
    const email = members.find((m) => m.personId === author)?.workEmail;
    if (email)
      ctx.mail.push({
        to: email,
        subject: `You have reviews to write: ${c.name}`,
        text: `Hi ${name(author)}, ${c.name} has started. Your reviews are in Kithena, under Performance › My reviews.`,
        dedupeKey: `launch:${c.id}:${author}`,
        ...(c.reminders.chat ? {} : { chat: false as const }),
      });
  }
}

const clockTime = (deps: Deps, zone: string): string =>
  dateFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(deps.clock.now());

/** One pass over every company (`startSweep` runs it every minute). */
export async function sweep(deps: Deps): Promise<void> {
  for (const tenantId of await deps.uow.tenants()) {
    try {
      const toResume: string[] = await asSystem(deps, tenantId, async (ctx) => {
        const resume: string[] = [];
        for (const c of await ctx.tx.cycles.find()) {
          if (c.state === 'scheduled') {
            const today = deps.clock.date(c.start.zone);
            if (
              c.start.date < today ||
              (c.start.date === today && clockTime(deps, c.start.zone) >= c.start.time)
            ) {
              const begun = await beginLaunch(ctx, c);
              if (begun.ok) resume.push(c.id);
            }
          } else if (c.state === 'launching') resume.push(c.id);
          else if (
            c.state === 'in_progress' &&
            c.visibility.release.mode === 'hr_date' &&
            c.visibility.release.date !== null &&
            c.visibility.release.date <= ctx.today
          )
            await releaseOnDate(ctx, c);
        }
        return resume;
      });
      for (const id of toResume) startLaunch(deps, tenantId, id);
      await asSystem(deps, tenantId, async (ctx) => {
        await dailyReminders(ctx);
        await runAutomations(ctx);
      });
    } catch (e) {
      logger.error({ module: 'performance', tenantId, err: e }, 'sweep failed for a company');
    }
  }
}

async function releaseOnDate(ctx: Ctx, c: Cycle): Promise<void> {
  for (const r of await ctx.tx.reviews.find({ cycleId: c.id })) {
    if (r.kind === 'self' || r.released !== null || !isSubmitted(r)) continue;
    await ctx.tx.reviews.save({ ...r, released: { at: ctx.at, by: 'Kithena' } });
    await publish(
      ctx,
      event(
        ctx,
        'performance.review.released',
        { type: 'review', id: r.id },
        { reviewId: r.id, cycleId: c.id, subjectId: r.subjectId },
      ),
    );
  }
  ctx.touched.add(c.id);
}

/** The day's reminders (§8.4), once a day: before, on and after the deadline, by each cycle's rules. */
async function dailyReminders(ctx: Ctx): Promise<void> {
  const last = (await ctx.tx.settings.get('reminders')) as { day?: string } | null;
  if (last?.day === ctx.today) return;
  await ctx.tx.settings.set('reminders', { day: ctx.today });
  const name = await names(ctx);
  const members = await ctx.members();
  for (const c of await ctx.tx.cycles.find({ state: 'in_progress' })) {
    if (!c.reminders.email) continue;
    for (const r of await ctx.tx.reviews.find({ cycleId: c.id })) {
      if (
        isSubmitted(r) ||
        r.hidden ||
        r.detached !== null ||
        !['not_started', 'in_progress', 'unlocked'].includes(r.status)
      )
        continue;
      const days = Math.round((Date.parse(r.due) - Date.parse(ctx.today)) / 86_400_000);
      const due = c.reminders.rules.some((rule) => {
        const [kind, n] = rule.split(':');
        if (kind === 'before') return days === Number(n);
        if (kind === 'on_day') return days === 0;
        if (kind === 'late')
          return (
            days < 0 && -days % Math.max(1, Number(n)) === 0 && -days <= Math.max(1, Number(n)) * 3
          );
        return false;
      });
      const email = members.find((m) => m.personId === r.authorId)?.workEmail;
      if (due && email)
        ctx.mail.push({
          to: email,
          subject:
            days < 0 ? `Overdue: a review in ${c.name}` : `Due ${r.due}: a review in ${c.name}`,
          text: `Hi ${name(r.authorId)}, your review about ${name(r.subjectId)} in ${c.name} is due ${r.due}.`,
          dedupeKey: `reminder:${r.id}:${ctx.today}`,
          ...(c.reminders.chat ? {} : { chat: false as const }),
        });
    }
  }
}

/** Every minute, for the life of the process. */
export function startSweep(deps: Deps): () => void {
  const timer = setInterval(() => {
    void sweep(deps);
  }, 60_000);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
