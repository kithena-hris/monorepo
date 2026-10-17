import type { FormAnswers, FormDefinition } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { missing, plainText, score, subjectView, validateAnswers } from '@kithena/form-kit';

import { label } from '../domain/cycle.js';
import { readerOf } from '../domain/feedback.js';
import { confidence, progress } from '../domain/goals.js';
import {
  access,
  decide,
  decideUnlock,
  isSubmitted,
  nominate,
  requestUnlock,
  save,
  standing,
  submit,
  unconfirmed,
  withdrawUnlock,
  type Reader,
  type Review,
} from '../domain/review.js';
import {
  audit,
  chatButton,
  event,
  forbidden,
  hrOnly,
  me,
  names,
  notFound,
  publish,
  type Ctx,
} from './context.js';
import { reviewsFor } from './cycles.js';
import { formOf } from './forms.js';
import { people, search, subtitle, team } from './members.js';
import { settingsOf } from './settings.js';

/**
 * Reviews (PRD §10, §13, PRF-044): what a person writes and what is written
 * about them, the writing page with its detail panel, autosave against a
 * revision, submit with every suggested number confirmed, unlocks HR decides,
 * reading and releasing, acknowledgement, nominations.
 */

const title = (kind: string) => {
  const t = label(kind);
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** The reader a review's access rule asks about: the viewer, and the sessions they calibrate. */
export async function readerOfCtx(ctx: Ctx): Promise<Reader> {
  const me = ctx.viewer.personId;
  const calibrating = new Set<string>();
  if (me !== null)
    for (const s of await ctx.tx.calibrations.find())
      if (s.state !== 'finalised' && s.calibrators.includes(me))
        for (const p of s.subjects) calibrating.add(p);
  return { personId: me, hr: ctx.viewer.hr, reports: ctx.viewer.reports, calibrating };
}

/** Whether enough of a confidential kind are in for the subject to see them (§8.5). */
async function enough(ctx: Ctx, r: Review): Promise<boolean> {
  if (r.kind !== 'peer' && r.kind !== 'upward') return true;
  if (r.cycleId === null) return false;
  const c = await ctx.tx.cycles.get(r.cycleId);
  const min = c?.visibility.minimum ?? 3;
  const same = (await ctx.tx.reviews.find({ cycleId: r.cycleId, subjectId: r.subjectId })).filter(
    (x) => x.kind === r.kind && isSubmitted(x) && x.detached === null,
  );
  return same.length >= min;
}

export async function load(
  ctx: Ctx,
  id: string,
): Promise<Result<{ review: Review; access: 'full' | 'subject' }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null || r.hidden) return err(notFound('review'));
  const a = access(r, await readerOfCtx(ctx), await enough(ctx, r));
  if (a === null) {
    await audit(ctx, { kind: 'review',
      action: 'Tried to read a review',
      target: title(r.kind),
      targetId: id,
      outcome: 'refused',
    });
    return err(notFound('review'));
  }
  return ok({ review: r, access: a });
}

/* ---------------------------------------------------------- my reviews -- */

export const stateFor = (r: Review, today: string): string => {
  if (r.detached !== null) return 'detached';
  if (r.released !== null && r.acknowledged !== null) return 'ack';
  if (r.status === 'unlock_requested') return 'unlock';
  if (r.status === 'unlocked') return 'unlocked';
  if (isSubmitted(r)) return 'submitted';
  if (r.declined !== null) return 'declined';
  if (r.due < today && ['not_started', 'in_progress'].includes(r.status)) return 'overdue';
  return r.status === 'in_progress' ? 'draft' : 'not_started';
};

/** PF13: to write, about me, written; and what is waiting on nominations. */
export async function myReviews(ctx: Ctx, tab: string): Promise<Result<unknown>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const name = await names(ctx);
  const all = await people(ctx);
  const cycles = new Map((await ctx.tx.cycles.find()).map((c) => [c.id, c]));
  const mine = (await ctx.tx.reviews.find({ ownerId: who.value })).filter(
    (r) => !r.hidden && r.status !== 'cancelled',
  );
  const row = (r: Review) => ({
    id: r.id,
    kind: r.kind,
    title: title(r.kind),
    subjectId: r.subjectId,
    about: name(r.subjectId),
    aboutTitle: subtitle(all.find((p) => p.personId === r.subjectId)),
    cycle: r.cycleId === null ? null : (cycles.get(r.cycleId)?.name ?? null),
    cycleId: r.cycleId,
    due: r.due,
    state: stateFor(r, ctx.today),
    savedAt: r.savedAt,
  });
  const toWrite = mine.filter(
    (r) =>
      !isSubmitted(r) &&
      r.declined === null &&
      !['abandoned', 'withdrawn', 'completed'].includes(r.status) &&
      r.detached === null,
  );
  const written = mine.filter((r) => isSubmitted(r) || r.detached !== null);
  const nominations = [];
  for (const n of await ctx.tx.nominations.find()) {
    const c = cycles.get(n.cycleId);
    if (c === undefined || !['scheduled', 'in_progress', 'launching'].includes(c.state)) continue;
    if (n.state === 'draft' && n.by === who.value)
      nominations.push({
        id: n.id,
        kind: 'nominate',
        cycle: c.name,
        cycleId: c.id,
        subjectId: n.subjectId,
        subject: name(n.subjectId),
        min: c.peer.min,
        max: c.peer.max,
        due: c.snapshot?.due.nominations ?? null,
      });
    if (n.state === 'waiting' && n.approverId === who.value)
      nominations.push({
        id: n.id,
        kind: 'approve',
        cycle: c.name,
        cycleId: c.id,
        subjectId: n.subjectId,
        subject: name(n.subjectId),
        min: c.peer.min,
        max: c.peer.max,
        due: c.snapshot?.due.nominations ?? null,
      });
  }
  return ok({
    tab,
    counts: { toWrite: toWrite.length, written: written.length },
    rows: tab === 'nominations' ? [] : (tab === 'written' ? written : toWrite).map(row),
    nominations,
    about: tab === 'about' ? await aboutMe(ctx, who.value) : null,
  });
}

/** PF13b: what the person can see about themselves, cycle by cycle. */
async function aboutMe(ctx: Ctx, personId: string) {
  const name = await names(ctx);
  const scale = (await settingsOf(ctx)).general.scale;
  const out = [];
  const about = (await ctx.tx.reviews.find({ subjectId: personId })).filter(
    (r) => !r.hidden && r.status !== 'cancelled',
  );
  const cycleIds = [...new Set(about.map((r) => r.cycleId).filter((c): c is string => c !== null))];
  for (const id of cycleIds) {
    const c = await ctx.tx.cycles.get(id);
    if (c === null) continue;
    const here = about.filter((r) => r.cycleId === id);
    const self = here.find((r) => r.kind === 'self');
    const mgr = here.find((r) => r.kind === 'manager');
    const nom = (await ctx.tx.nominations.find({ cycleId: id, subjectId: personId }))[0];
    const peers = here.filter((r) => r.kind === 'peer' && r.released !== null);
    const minimum = c.visibility.minimum;
    const finalised = (await ctx.tx.calibrations.find({ cycleId: id })).some(
      (s) => s.state === 'finalised' && s.subjects.includes(personId),
    );
    const scoreH = mgr?.released
      ? (mgr.calibrated?.hundredths ?? mgr.submitted.at(-1)?.scoreHundredths ?? null)
      : null;
    out.push({
      cycleId: id,
      cycle: c.name,
      state: c.state,
      self:
        self === undefined
          ? null
          : { id: self.id, state: stateFor(self, ctx.today), due: self.due },
      nominated:
        nom?.nominees.filter((x) => x.state !== 'declined').map((x) => name(x.personId)) ?? [],
      nomination: nom?.state ?? null,
      manager:
        mgr === undefined
          ? null
          : {
              id: mgr.id,
              by: name(mgr.authorId),
              released: mgr.released?.at ?? null,
              acknowledged: mgr.acknowledged?.at ?? null,
              comment: mgr.acknowledged?.comment ?? null,
              writing: !isSubmitted(mgr),
            },
      score:
        scoreH === null
          ? null
          : {
              display: (scoreH / 100).toFixed(1),
              label: labelFor(scale, scoreH),
              final: finalised,
            },
      peers:
        peers.length >= minimum
          ? { count: peers.length, ids: peers.map((p) => p.id) }
          : peers.length > 0
            ? { count: 0, ids: [] }
            : null,
    });
  }
  return out;
}

const labelFor = (
  scale: readonly { label: string; value: number }[],
  hundredths: number,
): string => {
  let best = scale[0];
  for (const o of scale)
    if (
      best === undefined ||
      Math.abs(o.value - hundredths / 100) <= Math.abs(best.value - hundredths / 100)
    )
      best = o;
  return best?.label ?? '';
};

/* ------------------------------------------------------------- writing -- */

/** PF10: the form, its answers and suggestions, and the detail panel beside it. */
export async function writeScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const loaded = await load(ctx, id);
  if (!loaded.ok) return loaded;
  const r = loaded.value.review;
  if (r.authorId !== ctx.viewer.personId && !ctx.viewer.hr) return err(notFound('review'));
  const form = await formOf(ctx, r);
  if (form === null) return err(notFound('form'));
  const settings = await settingsOf(ctx);
  const name = await names(ctx);
  const all = await people(ctx);
  const subject = all.find((p) => p.personId === r.subjectId);
  const c = r.cycleId === null ? null : await ctx.tx.cycles.get(r.cycleId);
  const writer = ctx.viewer.personId === r.authorId;
  return ok({
    review: {
      id: r.id,
      kind: r.kind,
      title: title(r.kind),
      status: r.status,
      revision: r.revision,
      savedAt: r.savedAt,
      due: r.due,
      confidential: r.confidential,
      subject: { personId: r.subjectId, name: name(r.subjectId), title: subtitle(subject) },
      author: name(r.authorId),
      cycle:
        c === null
          ? null
          : {
              id: c.id,
              name: c.name,
              names:
                r.kind === 'peer'
                  ? c.visibility.peerNames
                  : r.kind === 'upward'
                    ? c.visibility.upwardNames
                    : 'shown',
              minimum: c.visibility.minimum,
            },
      handover: r.handover === null ? null : { from: name(r.handover.from), note: r.handover.note },
      detached: r.detached,
      unlock: r.unlock,
    },
    form,
    answers: r.answers,
    standing: standing(r),
    suggestions: r.suggestions,
    drafted: r.drafted,
    missing: missing(form, r.answers),
    score: score(form, r.answers, settings.general.scale, { decimals: settings.general.decimals }),
    panel: await panel(ctx, r),
    may: {
      write:
        writer &&
        ['not_started', 'in_progress', 'unlocked'].includes(r.status) &&
        r.detached === null,
      unlock: writer && r.status === 'locked',
      withdraw: writer && r.status === 'unlock_requested',
      decline: writer && r.kind === 'peer' && !isSubmitted(r),
    },
    ai: Object.fromEntries(
      Object.entries(settings.ai.features).map(([k, v]) => [k, v && ctx.deps.model !== undefined]),
    ),
  });
}

/** The detail panel (§13.2): goals, reviews already in, feedback, the writer's notes, earlier reviews. */
async function panel(ctx: Ctx, r: Review) {
  const name = await names(ctx);
  const reader = await readerOfCtx(ctx);
  const goals = (await ctx.tx.goals.find({ ownerId: r.subjectId }))
    .filter((g) => g.status === 'active' || g.status === 'completed')
    .map((g) => ({ id: g.id, title: g.title, progress: progress(g), confidence: confidence(g) }));
  const around =
    r.cycleId === null
      ? []
      : await ctx.tx.reviews.find({ cycleId: r.cycleId, subjectId: r.subjectId });
  const forms = new Map<string, FormDefinition | null>();
  const formFor = async (x: Review) => {
    const key = `${x.templateId}:${String(x.version)}:${x.kind}`;
    if (!forms.has(key)) forms.set(key, await formOf(ctx, x));
    return forms.get(key) ?? null;
  };
  const reviews = [];
  for (const x of around) {
    if (x.id === r.id || !isSubmitted(x) || x.detached !== null) continue;
    if (access(x, reader, true) !== 'full') continue;
    const f = await formFor(x);
    const answers = standing(x);
    const first = f?.sections.flatMap((s) => s.questions).find((q) => q.type === 'text');
    const rated = f?.sections.flatMap((s) => s.questions).filter((q) => q.type === 'scale') ?? [];
    reviews.push({
      id: x.id,
      kind: x.kind,
      title: title(x.kind),
      by: name(x.authorId),
      at: x.submitted.at(-1)?.at ?? null,
      excerpt:
        first === undefined
          ? null
          : plainText(String(answers[first.id]?.value ?? '')).slice(0, 220),
      ratings: rated.map((q) => {
        const v = answers[q.id]?.value;
        const opt = q.options.find((o) => o.value === v);
        return {
          question: q.prompt,
          value: typeof v === 'number' ? v : null,
          label: opt?.label ?? null,
        };
      }),
    });
  }
  const managerOf = new Set(
    (await people(ctx)).filter((p) => p.managerId === ctx.viewer.personId).map((p) => p.personId),
  );
  const feedback = (await ctx.tx.feedback.find({ subjectId: r.subjectId }))
    .filter((f) => !f.undone)
    .map((f) => ({
      f,
      seen: readerOf(f, {
        personId: ctx.viewer.personId,
        hr: ctx.viewer.hr,
        managerOfRecipient: managerOf.has(r.subjectId),
      }),
    }))
    .filter(({ seen }) => seen.sees)
    .toSorted((a, b) => b.f.at.localeCompare(a.f.at))
    .slice(0, 20)
    .map(({ f, seen }) => ({
      id: f.id,
      kind: f.kind,
      from: seen.name ? name(f.from) : 'Someone',
      at: f.at,
      text: plainText(f.body).slice(0, 300),
    }));
  const notes = (await ctx.tx.notes.find({ ownerId: ctx.viewer.personId ?? '-' }))
    .filter((n) => n.about === r.subjectId)
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map((n) => ({ id: n.id, title: n.title, text: plainText(n.body).slice(0, 300), at: n.at }));
  const earlier = [];
  for (const x of await ctx.tx.reviews.find({ subjectId: r.subjectId })) {
    if (x.cycleId === r.cycleId || !isSubmitted(x) || x.kind !== 'manager') continue;
    const a = access(x, reader, true);
    if (a === null) continue;
    const c = x.cycleId === null ? null : await ctx.tx.cycles.get(x.cycleId);
    earlier.push({
      id: x.id,
      cycle: c?.name ?? null,
      by: name(x.authorId),
      score: x.calibrated?.hundredths ?? x.submitted.at(-1)?.scoreHundredths ?? null,
      at: x.submitted.at(-1)?.at ?? null,
    });
  }
  return { goals, reviews, feedback, notes, earlier };
}

const SaveInput = (form: FormDefinition, answers: FormAnswers) =>
  validateAnswers(form, answers, { submitting: false });

/** An autosave (§10.2): the changed answers over the revision the page had. */
export async function saveAnswers(
  ctx: Ctx,
  id: string,
  input: { revision: number; answers: FormAnswers },
): Promise<Result<unknown>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null || r.hidden) return err(notFound('review'));
  if (r.authorId !== ctx.viewer.personId)
    return err(forbidden('Only its writer can write this review'));
  const form = await formOf(ctx, r);
  if (form === null) return err(notFound('form'));
  const valid = SaveInput(form, { ...r.answers, ...input.answers });
  if (!valid.ok) return valid;
  const next = save(r, input.answers, input.revision, ctx.at);
  if (!next.ok) {
    if (next.error.code === 'STALE_REVISION')
      return err({
        ...next.error,
        message: `Revision ${String(r.revision)} was saved at ${r.savedAt?.slice(11, 16) ?? 'another time'}; your change wasn’t saved.`,
      });
    return next;
  }
  if (!(await ctx.tx.reviews.save(next.value, r.revision)))
    return err(failure('STALE_REVISION', 'Another save got there first'));
  if (r.status === 'not_started' && r.cycleId !== null) ctx.touched.add(r.cycleId);
  const settings = await settingsOf(ctx);
  return ok({
    revision: next.value.revision,
    savedAt: next.value.savedAt,
    missing: missing(form, next.value.answers),
    score: score(form, next.value.answers, settings.general.scale, {
      decimals: settings.general.decimals,
    }),
  });
}

/** PF12: every required answer in, every suggestion confirmed; the score is Kithena's. */
export async function submitReview(
  ctx: Ctx,
  id: string,
  input: { confidential: boolean | null; confirm: string[] },
): Promise<Result<unknown>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null || r.hidden) return err(notFound('review'));
  if (r.authorId !== ctx.viewer.personId)
    return err(forbidden('Only its writer can submit this review'));
  const form = await formOf(ctx, r);
  if (form === null) return err(notFound('form'));
  const valid = validateAnswers(form, r.answers, { submitting: true });
  if (!valid.ok) return valid;
  const confirmed: Review = {
    ...r,
    suggestions: Object.fromEntries(
      Object.entries(r.suggestions).map(([q, s]) => [
        q,
        input.confirm.includes(q) ? { ...s, confirmed: true } : s,
      ]),
    ),
  };
  const c = r.cycleId === null ? null : await ctx.tx.cycles.get(r.cycleId);
  const settings = await settingsOf(ctx);
  const s = score(form, r.answers, settings.general.scale);
  const done = submit(confirmed, ctx.at, s?.hundredths ?? null);
  if (!done.ok) return done;
  const names_ =
    r.kind === 'peer'
      ? c?.visibility.peerNames
      : r.kind === 'upward'
        ? c?.visibility.upwardNames
        : 'shown';
  const confidential = names_ === 'writer' ? (input.confidential ?? true) : names_ === 'hidden';
  // Released at once where each manager releases and nobody waits for the manager review.
  const auto =
    c !== null &&
    c.visibility.release.mode === 'manager' &&
    r.kind !== 'self' &&
    r.kind !== 'manager' &&
    !c.activities.manager.on;
  const next: Review = {
    ...done.value,
    confidential,
    released: auto ? { at: ctx.at, by: 'Kithena' } : done.value.released,
  };
  await ctx.tx.reviews.save(next);
  await publish(
    ctx,
    event(
      ctx,
      'performance.review.status_changed',
      { type: 'review', id },
      {
        reviewId: id,
        cycleId: r.cycleId,
        kind: r.kind,
        subjectId: r.subjectId,
        from: r.status,
        to: 'locked',
      },
    ),
  );
  await audit(ctx, { kind: 'review',
    action: 'Submitted a review',
    target: `${title(r.kind)} · ${(await names(ctx))(r.subjectId)}`,
    targetId: id,
    fields: Object.keys(r.answers),
  });
  if (r.cycleId !== null) ctx.touched.add(r.cycleId);
  return ok({ status: 'locked', score: s });
}

export async function requestUnlockOf(
  ctx: Ctx,
  id: string,
  reason: string,
): Promise<Result<{ ok: true }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null) return err(notFound('review'));
  if (r.authorId !== ctx.viewer.personId)
    return err(forbidden('Only its writer asks to unlock a review'));
  const c = r.cycleId === null ? null : await ctx.tx.cycles.get(r.cycleId);
  if (c !== null && ['closed', 'archived'].includes(c.state))
    return err(failure('CLOSED', 'Nothing can be unlocked after the cycle closes'));
  const next = requestUnlock(r, reason, ctx.at);
  if (!next.ok) return next;
  await ctx.tx.reviews.save(next.value);
  // HR hears it in the chat app with Approve and Decline, which decide as them (PRF-164).
  const name = await names(ctx);
  const hr = new Set(((await ctx.tx.settings.get('roles')) as { hr?: string[] } | null)?.hr ?? []);
  for (const m of await ctx.members()) {
    const isHr =
      hr.has(m.personId) || (m.accountId !== null && (await ctx.tx.admins.has(m.accountId)));
    if (!isHr || m.workEmail === null || m.personId === ctx.viewer.personId) continue;
    const decide = (approve: boolean) =>
      chatButton(ctx, m.accountId, {
        label: approve ? 'Approve' : 'Decline',
        route: 'decidePerformanceUnlock',
        params: { id },
        body: { approve, note: approve ? 'Approved in the chat app' : 'Declined in the chat app' },
        ...(approve ? { style: 'primary' as const } : {}),
      });
    const buttons = [decide(true), decide(false)].filter((b) => b !== null);
    ctx.mail.push({
      to: m.workEmail,
      subject: `${name(r.authorId)} asks to unlock a review`,
      text: `${title(r.kind)} about ${name(r.subjectId)}: “${reason}”`,
      dedupeKey: `unlock:${id}:${m.personId}:${ctx.at}`,
      chat: { buttons, only: true },
    });
  }
  await audit(ctx, { kind: 'review',
    action: 'Asked HR to unlock a review',
    target: title(r.kind),
    targetId: id,
    fields: ['reason'],
  });
  return ok({ ok: true });
}

export async function withdrawUnlockOf(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null) return err(notFound('review'));
  if (r.authorId !== ctx.viewer.personId) return err(forbidden());
  const next = withdrawUnlock(r);
  if (!next.ok) return next;
  await ctx.tx.reviews.save(next.value);
  await audit(ctx, { kind: 'review', action: 'Withdrew an unlock request', target: title(r.kind), targetId: id });
  return ok({ ok: true });
}

/** Only HR, always (§10.4). Also HR unlocking without a request, with a reason. */
export async function decideUnlockOf(
  ctx: Ctx,
  id: string,
  input: { approve: boolean; note: string },
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const r = await ctx.tx.reviews.get(id);
  if (r === null) return err(notFound('review'));
  const c = r.cycleId === null ? null : await ctx.tx.cycles.get(r.cycleId);
  if (c !== null && ['closed', 'archived'].includes(c.state))
    return err(failure('CLOSED', 'Nothing can be unlocked after the cycle closes'));
  const next = decideUnlock(r, {
    approved: input.approve,
    by: ctx.viewer.name,
    at: ctx.at,
    note: input.note,
  });
  if (!next.ok) return next;
  await ctx.tx.reviews.save(next.value);
  await publish(
    ctx,
    event(
      ctx,
      'performance.review.status_changed',
      { type: 'review', id },
      {
        reviewId: id,
        cycleId: r.cycleId,
        kind: r.kind,
        subjectId: r.subjectId,
        from: r.status,
        to: next.value.status,
      },
    ),
  );
  await audit(ctx, { kind: 'review',
    action: input.approve ? 'Unlocked a review' : 'Declined an unlock request',
    target: title(r.kind),
    targetId: id,
    fields: ['note'],
  });
  if (r.cycleId !== null) ctx.touched.add(r.cycleId);
  return ok({ ok: true });
}

/** A peer declines (design PF10d): the nominator is told and can replace them. */
export async function declineReview(
  ctx: Ctx,
  id: string,
  reason: string,
): Promise<Result<{ ok: true }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null) return err(notFound('review'));
  if (r.authorId !== ctx.viewer.personId || r.kind !== 'peer')
    return err(forbidden('Only a peer reviewer can decline'));
  if (isSubmitted(r)) return err(failure('SUBMITTED', 'A submitted review cannot be declined'));
  await ctx.tx.reviews.save({ ...r, status: 'cancelled', declined: { reason, at: ctx.at } });
  if (r.cycleId !== null) {
    for (const n of await ctx.tx.nominations.find({ cycleId: r.cycleId, subjectId: r.subjectId }))
      await ctx.tx.nominations.save({
        ...n,
        state: 'draft',
        nominees: n.nominees.map((x) =>
          x.personId === r.authorId ? { ...x, state: 'declined', reason } : x,
        ),
      });
    ctx.touched.add(r.cycleId);
  }
  await audit(ctx, { kind: 'review',
    action: 'Declined a peer review',
    target: 'Peer review',
    targetId: id,
    fields: ['reason'],
  });
  return ok({ ok: true });
}

/** The author keeps or deletes a detached review (§10.7). */
export async function detachedChoice(
  ctx: Ctx,
  id: string,
  keep: boolean,
): Promise<Result<{ ok: true }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null || r.detached === null) return err(notFound('detached review'));
  if (r.authorId !== ctx.viewer.personId) return err(forbidden());
  if (keep) await ctx.tx.reviews.save({ ...r, detached: { ...r.detached, keep: true } });
  else await ctx.tx.reviews.remove(id);
  await audit(ctx, { kind: 'review',
    action: keep ? 'Kept a detached review' : 'Deleted a detached review',
    target: title(r.kind),
    targetId: id,
  });
  return ok({ ok: true });
}

/** A suggestion confirmed as it stands, or replaced by the person's own value. */
export async function confirmSuggestion(
  ctx: Ctx,
  id: string,
  questionId: string,
): Promise<Result<{ ok: true }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null) return err(notFound('review'));
  if (r.authorId !== ctx.viewer.personId) return err(forbidden());
  const s = r.suggestions[questionId];
  if (s === undefined) return err(notFound('suggestion'));
  await ctx.tx.reviews.save({
    ...r,
    answers: {
      ...r.answers,
      [questionId]: { value: s.value, comment: r.answers[questionId]?.comment ?? null },
    },
    suggestions: { ...r.suggestions, [questionId]: { ...s, confirmed: true } },
    revision: r.revision + 1,
    savedAt: ctx.at,
    status: r.status === 'not_started' ? 'in_progress' : r.status,
  });
  await audit(ctx, { kind: 'review',
    action: 'Confirmed a suggestion',
    target: title(r.kind),
    targetId: id,
    fields: [questionId],
  });
  return ok({ ok: true });
}

/* ----------------------------------------------- reading and releasing -- */

/** PF11: everything about a subject in a cycle that the reader may see, with names where allowed. */
export async function aboutScreen(
  ctx: Ctx,
  cycleId: string,
  subjectId: string,
): Promise<Result<unknown>> {
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return err(notFound('cycle'));
  const reader = await readerOfCtx(ctx);
  if (!reader.hr && !reader.reports.has(subjectId) && !reader.calibrating.has(subjectId))
    return err(notFound('reviews'));
  const name = await names(ctx);
  const scale = (await settingsOf(ctx)).general.scale;
  const all = (await ctx.tx.reviews.find({ cycleId, subjectId })).filter(
    (r) => !r.hidden && r.status !== 'cancelled' && isSubmitted(r),
  );
  const out = [];
  for (const r of all) {
    const form = await formOf(ctx, r);
    if (form === null) continue;
    out.push({
      id: r.id,
      kind: r.kind,
      title: title(r.kind),
      by: name(r.authorId),
      at: r.submitted.at(-1)?.at ?? null,
      form,
      answers: standing(r),
      score: score(form, standing(r), scale),
      released: r.released?.at ?? null,
      acknowledged: r.acknowledged,
    });
  }
  await audit(ctx, { kind: 'cycle',
    action: 'Read reviews about someone',
    target: `${c.name} · ${name(subjectId)}`,
    targetId: cycleId,
  });
  const mgr = all.find((r) => r.kind === 'manager');
  const calibrating = (await ctx.tx.calibrations.find({ cycleId })).some(
    (s) => s.state !== 'finalised' && s.subjects.includes(subjectId),
  );
  return ok({
    cycle: {
      id: c.id,
      name: c.name,
      minimum: c.visibility.minimum,
      acknowledge: c.visibility.acknowledge,
    },
    subject: { personId: subjectId, name: name(subjectId) },
    reviews: out,
    peers: out.filter((r) => r.kind === 'peer').length,
    release: {
      manager:
        mgr === undefined
          ? null
          : {
              id: mgr.id,
              at: mgr.submitted.at(-1)?.at ?? null,
              released: mgr.released?.at ?? null,
            },
      peerSummary: out.filter((r) => r.kind === 'peer').length >= c.visibility.minimum,
      beforeCalibration:
        calibrating ||
        ((await ctx.tx.calibrations.find({ cycleId })).length > 0 &&
          !(await ctx.tx.calibrations.find({ cycleId })).some(
            (s) => s.state === 'finalised' && s.subjects.includes(subjectId),
          )),
      may:
        ctx.viewer.hr || (reader.reports.has(subjectId) && c.visibility.release.mode === 'manager'),
    },
  });
}

/** The manager (or HR) releases what is in about one person (§10.8). */
export async function releaseToSubject(
  ctx: Ctx,
  cycleId: string,
  subjectId: string,
  acknowledge: boolean,
): Promise<Result<{ released: number }>> {
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return err(notFound('cycle'));
  const manager = ctx.viewer.reports.has(subjectId) && c.visibility.release.mode === 'manager';
  if (!ctx.viewer.hr && !manager) return err(forbidden('This cycle is released by HR'));
  let released = 0;
  for (const r of await ctx.tx.reviews.find({ cycleId, subjectId })) {
    if (r.kind === 'self' || r.released !== null || !isSubmitted(r) || r.detached !== null)
      continue;
    await ctx.tx.reviews.save({
      ...r,
      released: { at: ctx.at, by: ctx.viewer.name },
      acknowledged: acknowledge ? null : r.acknowledged,
    });
    await publish(
      ctx,
      event(
        ctx,
        'performance.review.released',
        { type: 'review', id: r.id },
        { reviewId: r.id, cycleId, subjectId },
      ),
    );
    released += 1;
  }
  await audit(ctx, { kind: 'cycle',
    action: 'Released reviews to their subject',
    target: `${c.name} · ${(await names(ctx))(subjectId)}`,
    targetId: cycleId,
  });
  ctx.touched.add(cycleId);
  return ok({ released });
}

/** PF11b: a released review as its subject reads it, private questions absent. */
export async function releasedScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const loaded = await load(ctx, id);
  if (!loaded.ok) return loaded;
  const r = loaded.value.review;
  const form = await formOf(ctx, r);
  if (form === null) return err(notFound('form'));
  const name = await names(ctx);
  const scale = (await settingsOf(ctx)).general.scale;
  const c = r.cycleId === null ? null : await ctx.tx.cycles.get(r.cycleId);
  const group = [];
  if ((r.kind === 'peer' || r.kind === 'upward') && r.cycleId !== null) {
    // A confidential kind is read as a group, in no order that follows submission (§8.5).
    const same = (await ctx.tx.reviews.find({ cycleId: r.cycleId, subjectId: r.subjectId }))
      .filter(
        (x) => x.kind === r.kind && isSubmitted(x) && x.released !== null && x.detached === null,
      )
      .toSorted((a, b) => a.id.localeCompare(b.id));
    for (const [i, x] of same.entries()) {
      const f = await formOf(ctx, x);
      if (f === null) continue;
      const view =
        loaded.value.access === 'subject'
          ? subjectView(f, standing(x))
          : { definition: f, answers: standing(x) };
      group.push({
        id: x.id,
        by:
          loaded.value.access === 'subject' && x.confidential
            ? `${title(x.kind).split(' ')[0] ?? 'Peer'} ${String(i + 1)}`
            : name(x.authorId),
        ...view,
      });
    }
  }
  const view =
    loaded.value.access === 'subject'
      ? subjectView(form, standing(r))
      : { definition: form, answers: standing(r) };
  const finalised =
    r.cycleId !== null &&
    (await ctx.tx.calibrations.find({ cycleId: r.cycleId })).some(
      (s) => s.state === 'finalised' && s.subjects.includes(r.subjectId),
    );
  const scoreH = r.calibrated?.hundredths ?? r.submitted.at(-1)?.scoreHundredths ?? null;
  if (loaded.value.access === 'full' && ctx.viewer.personId !== r.authorId)
    await audit(ctx, { kind: 'review',
      action: 'Read a review',
      target: `${title(r.kind)} · ${name(r.subjectId)}`,
      targetId: id,
    });
  return ok({
    review: {
      id: r.id,
      kind: r.kind,
      title: title(r.kind),
      by: r.confidential && loaded.value.access === 'subject' ? null : name(r.authorId),
      released: r.released?.at ?? null,
      acknowledged: r.acknowledged,
      cycle: c?.name ?? null,
    },
    definition: view.definition,
    answers: view.answers,
    score:
      scoreH === null
        ? null
        : { display: (scoreH / 100).toFixed(1), label: labelFor(scale, scoreH), final: finalised },
    group,
    may: {
      acknowledge:
        r.subjectId === ctx.viewer.personId &&
        r.kind === 'manager' &&
        r.acknowledged === null &&
        (c?.visibility.acknowledge ?? true),
      comment: c?.visibility.subjectComment ?? true,
    },
  });
}

export async function acknowledge(
  ctx: Ctx,
  id: string,
  comment: string | null,
): Promise<Result<{ ok: true }>> {
  const r = await ctx.tx.reviews.get(id);
  if (r === null || r.released === null) return err(notFound('released review'));
  if (r.subjectId !== ctx.viewer.personId)
    return err(forbidden('Only its subject acknowledges a review'));
  await ctx.tx.reviews.save({
    ...r,
    acknowledged: { at: ctx.at, comment: comment?.trim() === '' ? null : comment },
  });
  await audit(ctx, { kind: 'review',
    action: 'Acknowledged a review',
    target: title(r.kind),
    targetId: id,
    fields: comment === null ? [] : ['comment'],
  });
  if (r.cycleId !== null) ctx.touched.add(r.cycleId);
  return ok({ ok: true });
}

/* --------------------------------------------------------- nominations -- */

/** PF9b: the team first, then people the subject works with, then anyone found (§9.3). */
export async function pickerScreen(
  ctx: Ctx,
  nominationId: string,
  q: string,
): Promise<Result<unknown>> {
  const n = await ctx.tx.nominations.get(nominationId);
  if (n === null) return err(notFound('nomination'));
  const may = n.by === ctx.viewer.personId || n.approverId === ctx.viewer.personId || ctx.viewer.hr;
  if (!may) return err(notFound('nomination'));
  const c = await ctx.tx.cycles.get(n.cycleId);
  if (c === null) return err(notFound('cycle'));
  const all = await people(ctx);
  const mine = team(all, n.subjectId);
  const worked = new Map<string, number>();
  for (const f of await ctx.tx.feedback.find()) {
    if (f.from === n.subjectId) worked.set(f.to, (worked.get(f.to) ?? 0) + 1);
    if (f.to === n.subjectId) worked.set(f.from, (worked.get(f.from) ?? 0) + 1);
  }
  const teamIds = new Set(mine.map((p) => p.personId));
  const withWork = all
    .filter((p) => worked.has(p.personId) && !teamIds.has(p.personId) && p.personId !== n.subjectId)
    .toSorted((a, b) => (worked.get(b.personId) ?? 0) - (worked.get(a.personId) ?? 0))
    .slice(0, 8);
  const found = q.trim() === '' ? [] : search(all, q).filter((p) => p.personId !== n.subjectId);
  const row = (p: (typeof all)[number], note?: string) => ({
    personId: p.personId,
    name: p.name,
    title: note ?? subtitle(p),
  });
  const name = await names(ctx);
  return ok({
    nomination: {
      id: n.id,
      state: n.state,
      subject: name(n.subjectId),
      subjectId: n.subjectId,
      picked: n.nominees.filter((x) => x.state !== 'declined').map((x) => x.personId),
      note: n.note,
      nominees: n.nominees.map((x) => ({ ...x, name: name(x.personId) })),
    },
    bounds: { min: c.peer.min, max: c.peer.max, perReviewer: c.peer.perReviewerMax },
    approver: n.approverId === null ? 'HR' : name(n.approverId),
    team: mine.map((p) => row(p)),
    worksWith: withWork.map((p) =>
      row(p, `${subtitle(p)} · ${String(worked.get(p.personId) ?? 0)} feedback together`),
    ),
    found: found.map((p) => row(p)),
    cycle: c.name,
  });
}

export async function nominatePeers(
  ctx: Ctx,
  id: string,
  input: { people: string[]; note: string | null },
): Promise<Result<{ state: string }>> {
  const n = await ctx.tx.nominations.get(id);
  if (n === null) return err(notFound('nomination'));
  if (n.by !== ctx.viewer.personId && !(n.by === 'hr' && ctx.viewer.hr))
    return err(forbidden('You don’t nominate for this person'));
  const c = await ctx.tx.cycles.get(n.cycleId);
  if (c === null) return err(notFound('cycle'));
  const done = nominate(
    n,
    input.people,
    { min: c.peer.min, max: c.peer.max, approval: c.peer.approval && n.approverId !== null },
    input.note,
    ctx.at,
  );
  if (!done.ok) return done;
  await ctx.tx.nominations.save(done.value);
  if (done.value.state === 'approved' && c.state === 'in_progress')
    await reviewsFor(ctx, c, n.subjectId, { hidden: false });
  // The approver hears it in the chat app, with Approve all (PRF-164).
  const approver =
    done.value.state === 'waiting' && done.value.approverId !== null
      ? await ctx.tx.members.get(done.value.approverId)
      : null;
  if (approver !== null && approver.workEmail !== null) {
    const name = await names(ctx);
    const all = chatButton(ctx, approver.accountId, {
      label: 'Approve all',
      route: 'decidePerformanceNominations',
      params: { id },
      body: {
        decisions: done.value.nominees.map((x) => ({
          personId: x.personId,
          approve: true,
          reason: null,
        })),
      },
      style: 'primary',
    });
    ctx.mail.push({
      to: approver.workEmail,
      subject: `${name(n.subjectId)}’s peer reviewers are waiting for you`,
      text: `${c.name}: ${done.value.nominees.map((x) => name(x.personId)).join(', ')}.`,
      dedupeKey: `nominations:${id}:${ctx.at}`,
      chat: { buttons: all === null ? [] : [all], only: true },
    });
  }
  await audit(ctx, { kind: 'nomination',
    action: 'Nominated peers',
    target: `${c.name} · ${(await names(ctx))(n.subjectId)}`,
    targetId: id,
    fields: ['nominees'],
  });
  ctx.touched.add(c.id);
  return ok({ state: done.value.state });
}

export async function decideNominations(
  ctx: Ctx,
  id: string,
  input: {
    decisions: { personId: string; approve: boolean; reason: string | null }[];
    replacements: string[];
  },
): Promise<Result<{ ok: true }>> {
  const n = await ctx.tx.nominations.get(id);
  if (n === null) return err(notFound('nomination'));
  if (n.approverId !== ctx.viewer.personId && !ctx.viewer.hr)
    return err(forbidden('Only the approver decides these nominations'));
  const done = decide(n, input.decisions, input.replacements);
  if (!done.ok) return done;
  await ctx.tx.nominations.save(done.value);
  const c = await ctx.tx.cycles.get(n.cycleId);
  if (c?.state === 'in_progress') await reviewsFor(ctx, c, n.subjectId, { hidden: false });
  await audit(ctx, { kind: 'nomination',
    action: 'Decided nominations',
    target: (await names(ctx))(n.subjectId),
    targetId: id,
    fields: ['nominees'],
  });
  ctx.touched.add(n.cycleId);
  return ok({ ok: true });
}

export { unconfirmed };
