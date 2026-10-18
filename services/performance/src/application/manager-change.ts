import type { CalendarDate } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { addDays, type Cycle } from '../domain/cycle.js';
import { newReview, onManagerChange, reattach } from '../domain/review.js';
import { audit, hrOnly, names, type Ctx, type Outgoing } from './context.js';
import type { Member, Tx } from './ports.js';

/**
 * A change of manager and the manager reviews it touches (§8.8).
 *
 * People only moves the reporting line; whether a running cycle's manager
 * reviews follow it is HR's choice, made when they make the change (People
 * asks, through the shell). The choice is kept here per person and carried
 * out when the change reaches Performance (`people.person.manager_changed`):
 * at once for an ordinary save, on the day for a dated one, on approval for
 * one held for it; never for one rejected. A manager who has left cannot
 * write theirs, so their reports' reviews follow the new manager without a
 * question, whichever of the two arrives first.
 */

/** What a manager change did, cycle by cycle, for whoever has to be told. */
export interface ManagerChangeDone {
  /** The new manager's review in each cycle, made or given back. */
  readonly given: readonly { readonly cycleId: string; readonly reviewId: string }[];
  /** An old manager's review that is theirs no more: removed, or kept to read. */
  readonly taken: readonly {
    readonly cycleId: string;
    readonly reviewId: string;
    readonly authorId: string;
    readonly change: 'remove' | 'outdate';
  }[];
}

/** The running cycles a manager change can touch: the subject is in it, and it has manager reviews. */
async function cyclesWithManagerReviews(tx: Tx, personId: string): Promise<Cycle[]> {
  return (await tx.cycles.find()).filter(
    (c) =>
      c.state === 'in_progress' &&
      c.activities.manager.on &&
      c.snapshot?.subjects.includes(personId) === true,
  );
}

const HANDED_OVER = 'Their manager changed, so you write their manager review now.';

/**
 * The handover itself. In every running cycle the subject is in, the manager
 * review becomes the new manager's: the old one stays beside it once
 * submitted, goes if it was not started, and stays its writer's to read or
 * delete if it was in progress, no longer to be submitted. Both are marked,
 * so each manager's Inbox can say what changed. The new manager's is due when
 * the old one was, never sooner than a week from today; one they had before
 * (they were the manager once already) comes back rather than a second one.
 * Without a new manager, only the old reviews change.
 */
export async function managerChanged(
  tx: Tx,
  newId: () => string,
  input: {
    readonly personId: string;
    readonly managerId: string | null;
    readonly at: string;
    readonly today: CalendarDate;
  },
): Promise<ManagerChangeDone> {
  const given: ManagerChangeDone['given'][number][] = [];
  const taken: ManagerChangeDone['taken'][number][] = [];
  for (const c of await cyclesWithManagerReviews(tx, input.personId)) {
    const theirs = (await tx.reviews.find({ cycleId: c.id, subjectId: input.personId })).filter(
      (r) => r.kind === 'manager',
    );
    const mark = { at: input.at, to: input.managerId };
    for (const r of theirs) {
      const change = onManagerChange(r, input.managerId);
      if (change === 'keep') continue;
      await tx.reviews.save({
        ...r,
        ...(change === 'remove' ? { status: 'cancelled' as const } : {}),
        formerManager: mark,
      });
      taken.push({ cycleId: c.id, reviewId: r.id, authorId: r.authorId, change });
    }
    // Nobody to write it, or someone who has left and never will.
    if (input.managerId === null || isLeaver(await tx.members.get(input.managerId))) continue;
    const pin = c.snapshot?.pinned.manager;
    if (pin === undefined) continue;
    const before = theirs.find((r) => r.authorId === input.managerId);
    // Whose it was: one still standing, else one a leaver's departure cancelled.
    const others = theirs.filter((r) => r.authorId !== input.managerId);
    const old = others.find((r) => r.status !== 'cancelled') ?? others[0];
    const handover = old === undefined ? null : { from: old.authorId, note: HANDED_OVER };
    if (before !== undefined) {
      // Theirs again: back as it was, and theirs to submit.
      await tx.reviews.save({ ...reattach(before), formerManager: null, handover });
      given.push({ cycleId: c.id, reviewId: before.id });
      continue;
    }
    const due0 = old?.due ?? c.snapshot?.due.manager ?? addDays(c.start.date, 14);
    const floor = addDays(input.today, 7);
    const id = newId();
    await tx.reviews.save({
      ...newReview({
        id,
        cycleId: c.id,
        kind: 'manager',
        subjectId: input.personId,
        authorId: input.managerId,
        templateId: old?.templateId ?? pin.templateId,
        version: old?.version ?? pin.version,
        due: due0 < floor ? floor : due0,
        confidential: false,
        hidden: false,
        goals: old?.goals ?? [],
        at: input.at,
      }),
      handover,
    });
    given.push({ cycleId: c.id, reviewId: id });
  }
  return { given, taken };
}

/** Who is told what about a handover: the new manager, and an old one who had something still to write. */
export async function toldOf(
  tx: Tx,
  done: ManagerChangeDone,
  input: { readonly personId: string; readonly managerId: string | null; readonly at: string },
): Promise<Outgoing[]> {
  const members = await tx.members.list();
  const byId = new Map(members.map((m) => [m.personId as string, m]));
  const name = (id: string): string => byId.get(id)?.displayName ?? 'Someone';
  const email = (id: string): string | null => byId.get(id)?.workEmail ?? null;
  const cycleName = new Map((await tx.cycles.find()).map((c) => [c.id, c.name] as const));
  const who = name(input.personId);
  const to = input.managerId === null ? null : name(input.managerId);
  const day = input.at.slice(0, 10);
  const out: Outgoing[] = [];
  if (input.managerId !== null && done.given.length > 0) {
    const address = email(input.managerId);
    const where = done.given.map((g) => cycleName.get(g.cycleId) ?? 'a cycle').join(', ');
    if (address !== null)
      out.push({
        to: address,
        subject: `You write ${who}’s manager review`,
        text: `Hi ${name(input.managerId)}, ${who} reports to you now, so their manager review in ${where} is yours to write. Open Kithena to start it.`,
        dedupeKey: `manager-change:given:${input.personId}:${input.managerId}:${day}`,
      });
  }
  for (const authorId of new Set(done.taken.map((t) => t.authorId))) {
    const address = email(authorId);
    if (address === null || byId.get(authorId)?.status === 'terminated') continue;
    const mine = done.taken.filter((t) => t.authorId === authorId);
    const where = [...new Set(mine.map((t) => cycleName.get(t.cycleId) ?? 'a cycle'))].join(', ');
    const draft = mine.some((t) => t.change === 'outdate');
    out.push({
      to: address,
      subject: `You no longer write ${who}’s manager review`,
      text: `Hi ${name(authorId)}, ${who} ${to === null ? 'no longer reports to you' : `reports to ${to} now`}, so you are no longer a manager reviewer for them in ${where} and do not have to submit it.${draft ? ' Your draft stays in Kithena for you to read until you delete it.' : ''}`,
      dedupeKey: `manager-change:taken:${input.personId}:${authorId}:${day}`,
    });
  }
  return out;
}

/** HR's choice, kept until the change reaches Performance; forgotten after this long. */
const KEPT_DAYS = 180;
const choiceKey = (personId: string): string => `manager-handover:${personId}`;
interface Choice {
  readonly managerId: string | null;
  readonly at: string;
}

const isLeaver = (m: Member | null | undefined): boolean => m?.status === 'terminated';

/**
 * §8.8: what changing these people's manager would do to their manager
 * reviews, asked before the change is made (People's confirm, through the
 * shell): one question for them all, where a running cycle has a manager
 * review someone still with the company is writing or has written; null
 * otherwise. A leaver's are not asked about: they follow the new manager.
 */
export async function managerChangeImpact(
  ctx: Ctx,
  personIds: readonly string[],
  managerId: string | null,
): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const name = await names(ctx);
  const members = new Map((await ctx.members()).map((m) => [m.personId as string, m]));
  const cycles = new Map<string, string>();
  const from = new Set<string>();
  const about = new Set<string>();
  let pending = 0;
  for (const personId of personIds)
    for (const c of await cyclesWithManagerReviews(ctx.tx, personId)) {
      const others = (await ctx.tx.reviews.find({ cycleId: c.id, subjectId: personId })).filter(
        (r) =>
          r.kind === 'manager' &&
          r.authorId !== managerId &&
          r.status !== 'cancelled' &&
          !isLeaver(members.get(r.authorId)),
      );
      if (others.length === 0) continue;
      cycles.set(c.id, c.name);
      about.add(personId);
      for (const r of others) from.add(name(r.authorId));
      pending += others.filter((r) => onManagerChange(r, managerId) !== 'keep').length;
    }
  if (cycles.size === 0) return ok({ question: null });
  const to = managerId === null ? null : name(managerId);
  const whose =
    about.size === 1
      ? `${name([...about][0] ?? null)}’s manager review`
      : `Manager reviews of ${String(about.size)} people`;
  const writers = [...from].join(' and ');
  return ok({
    question: {
      id: 'performance.manager-reviews',
      title: `${whose} in ${[...cycles.values()].join(', ')}`,
      description:
        pending === 0
          ? `${writers} ${from.size === 1 ? 'has' : 'have'} already submitted ${about.size === 1 ? 'it' : 'them'}.`
          : `${writers} still ${from.size === 1 ? 'has' : 'have'} ${pending === 1 ? 'one' : String(pending)} to write.`,
      options: [
        {
          id: 'reassign',
          label: to === null ? `Take them from ${writers}` : `Give them to ${to}`,
          description:
            to === null
              ? 'An unstarted one is removed; a draft stays to read, and cannot be submitted.'
              : `${to} writes their own. A submitted one stays, an unstarted one goes, and a draft is kept to read but cannot be submitted. Both are told, when the change takes effect.`,
        },
        {
          id: 'keep',
          label: `Leave them with ${writers}`,
          description: `${writers} ${from.size === 1 ? 'writes' : 'write'} them as planned.`,
        },
      ],
      value: 'reassign',
    },
  });
}

/**
 * The handover and who is told, once the change is Performance's: from HR's
 * kept choice, or because the old manager has left.
 */
async function handOver(
  tx: Tx,
  newId: () => string,
  input: {
    readonly personId: string;
    readonly managerId: string | null;
    readonly at: string;
    readonly today: CalendarDate;
  },
): Promise<Outgoing[]> {
  const done = await managerChanged(tx, newId, input);
  return toldOf(tx, done, input);
}

/**
 * §8.8: HR's answer for these people's manager reviews. Handed over, the
 * choice is kept and carried out when the change reaches Performance, at
 * once where it already has; left with the old manager, any earlier choice
 * for them is forgotten.
 */
export async function chooseManagerHandover(
  ctx: Ctx,
  input: {
    readonly personIds: readonly string[];
    readonly managerId: string | null;
    readonly handOver: boolean;
  },
): Promise<Result<{ now: number; later: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  if (input.personIds.length === 0) return err(failure('EMPTY', 'Nobody was chosen'));
  let now = 0;
  let later = 0;
  const name = await names(ctx);
  for (const personId of input.personIds) {
    if (!input.handOver) {
      await ctx.tx.settings.set(choiceKey(personId), null);
      continue;
    }
    const member = await ctx.tx.members.get(personId);
    if ((member?.managerPersonId ?? null) === input.managerId) {
      // Already Performance's: carried out now.
      ctx.mail.push(
        ...(await handOver(ctx.tx, ctx.deps.newId, {
          personId,
          managerId: input.managerId,
          at: ctx.at,
          today: ctx.today,
        })),
      );
      await ctx.tx.settings.set(choiceKey(personId), null);
      now += 1;
    } else {
      const choice: Choice = { managerId: input.managerId, at: ctx.at };
      await ctx.tx.settings.set(choiceKey(personId), choice);
      later += 1;
    }
  }
  await audit(ctx, {
    kind: 'review',
    action: input.handOver
      ? 'Chose to hand manager reviews to a new manager'
      : 'Chose to leave manager reviews with the old manager',
    target: `${input.personIds.map((p) => name(p)).join(', ')}${input.managerId === null ? '' : ` · to ${name(input.managerId)}`}`,
    targetId: input.personIds[0] ?? null,
  });
  return ok({ now, later });
}

/**
 * People's `manager_changed`, once Performance's projection has moved: the
 * reviews follow the new manager where HR chose that for this very change,
 * or where the old manager has left. Anything else stays with the old one.
 */
export async function onReportingLineMoved(
  tx: Tx,
  newId: () => string,
  input: {
    readonly personId: string;
    readonly previousManagerId: string | null;
    readonly managerId: string | null;
    readonly at: string;
    readonly today: CalendarDate;
  },
): Promise<Outgoing[]> {
  const raw = await tx.settings.get(choiceKey(input.personId));
  const choice = raw === null || typeof raw !== 'object' ? null : (raw as Choice);
  const chosen =
    choice !== null &&
    choice.managerId === input.managerId &&
    Date.parse(input.at) - Date.parse(choice.at) < KEPT_DAYS * 86_400_000;
  const previous =
    input.previousManagerId === null ? null : await tx.members.get(input.previousManagerId);
  if (!chosen && !isLeaver(previous)) return [];
  if (chosen) await tx.settings.set(choiceKey(input.personId), null);
  return handOver(tx, newId, input);
}

/**
 * A leaver's own manager reviews, cancelled as they leave: each report already
 * moved to someone else gets a review from that manager, who is told.
 */
export async function leaverManagerReviews(
  tx: Tx,
  newId: () => string,
  input: {
    readonly leaverId: string;
    readonly cancelled: readonly { readonly subjectId: string; readonly cycleId: string | null }[];
    readonly at: string;
    readonly today: CalendarDate;
  },
): Promise<Outgoing[]> {
  const out: Outgoing[] = [];
  for (const subjectId of new Set(
    input.cancelled.filter((c) => c.cycleId !== null).map((c) => c.subjectId),
  )) {
    const managerId = (await tx.members.get(subjectId))?.managerPersonId ?? null;
    if (managerId === null || managerId === input.leaverId) continue;
    out.push(
      ...(await handOver(tx, newId, {
        personId: subjectId,
        managerId,
        at: input.at,
        today: input.today,
      })),
    );
  }
  return out;
}
