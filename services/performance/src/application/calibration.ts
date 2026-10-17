import type { CalendarDate } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { labelOf } from '@kithena/form-kit';

import {
  band,
  changeScore,
  hold,
  isSubmitted,
  releaseHold,
  scoreOf,
  standing,
  type Review,
} from '../domain/review.js';
import { audit, event, forbidden, hrOnly, names, notFound, publish, type Ctx } from './context.js';
import { formOf } from './forms.js';
import { people } from './members.js';
import { settingsOf } from './settings.js';

/**
 * Calibration (PRD §17, PRF-111, PRF-112): sessions over a cycle's scored
 * reviews, which move to `in_review` while they are compared; changes with a
 * required reason, beside the reviewer's answers; a 9-box grid of the
 * computed score against potential; a guide distribution shown, never
 * enforced; and on finalising, `performance.rating.finalized` per person.
 */

export const BOXES = [
  { key: 'lowPotential', label: 'Low perf, high pot' },
  { key: 'corePotential', label: 'Core, high potential' },
  { key: 'star', label: 'Star' },
  { key: 'inconsistent', label: 'Inconsistent' },
  { key: 'core', label: 'Core' },
  { key: 'high', label: 'High performer' },
  { key: 'under', label: 'Under-performer' },
  { key: 'effective', label: 'Effective' },
  { key: 'trusted', label: 'Trusted pro' },
] as const;

const may = (ctx: Ctx, calibrators: readonly string[]): boolean =>
  ctx.viewer.hr || (ctx.viewer.personId !== null && calibrators.includes(ctx.viewer.personId));

export async function sessionsScreen(ctx: Ctx): Promise<Result<unknown>> {
  const name = await names(ctx);
  const cycles = new Map((await ctx.tx.cycles.find()).map((c) => [c.id, c]));
  const rows = (await ctx.tx.calibrations.find())
    .filter((s) => may(ctx, s.calibrators))
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map((s) => ({
      id: s.id,
      name: s.name,
      cycle: cycles.get(s.cycleId)?.name ?? '',
      cycleId: s.cycleId,
      calibrators: s.calibrators.map(name),
      people: s.subjects.length,
      meetsOn: s.meetsOn,
      state: s.state,
    }));
  return ok({
    rows,
    cycles: [...cycles.values()]
      .filter((c) => ['in_progress', 'closed'].includes(c.state))
      .map((c) => ({ id: c.id, name: c.name })),
    hr: ctx.viewer.hr,
  });
}

/** The manager review that carries a subject's score in a cycle. */
async function scored(ctx: Ctx, cycleId: string, subjectId: string): Promise<Review | undefined> {
  return (await ctx.tx.reviews.find({ cycleId, subjectId })).find(
    (r) => r.kind === 'manager' && isSubmitted(r) && r.detached === null,
  );
}

export async function sessionScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const s = await ctx.tx.calibrations.get(id);
  if (s === null || !may(ctx, s.calibrators)) return err(notFound('calibration session'));
  const settings = await settingsOf(ctx);
  const scale = settings.general.scale;
  const lo = scale[0]?.value ?? 1;
  const hi = scale.at(-1)?.value ?? 5;
  const name = await names(ctx);
  const all = await people(ctx);
  const cells: {
    label: string;
    key: string;
    people: { personId: string; name: string }[];
    guide: number;
  }[] = BOXES.map((b) => ({ ...b, people: [], guide: settings.calibration.guide[b.key] ?? 0 }));
  const rows = [];
  for (const p of s.subjects) {
    const r = await scored(ctx, s.cycleId, p);
    const change = s.changes.find((c) => c.personId === p);
    const was = r?.submitted.at(-1)?.scoreHundredths ?? null;
    const now = change?.now ?? was;
    let potential: number | null = null;
    if (r !== undefined) {
      const form = await formOf(ctx, r);
      const qid = settings.calibration.potentialQuestionId ?? 'potential';
      const q = form?.sections.flatMap((x) => x.questions).find((x) => x.id === qid);
      const v = standing(r)[qid]?.value;
      if (q?.type === 'scale' && typeof v === 'number') {
        const qlo = q.options[0]?.value ?? 1;
        const qhi = q.options.at(-1)?.value ?? 5;
        potential = qhi === qlo ? null : lo + ((v - qlo) * (hi - lo)) / (qhi - qlo);
      }
    }
    if (now !== null) {
      const col = band(now / 100, lo, hi);
      const row = potential === null ? 1 : band(potential, lo, hi);
      cells[(2 - row) * 3 + col]?.people.push({ personId: p, name: name(p) });
    }
    const person = all.find((x) => x.personId === p);
    rows.push({
      personId: p,
      name: name(p),
      manager: name(person?.managerId ?? null),
      reviewId: r?.id ?? null,
      was,
      now,
      label: now === null ? null : labelOf(scale, now / 100),
      reason: change?.reason ?? null,
      state: r?.status ?? null,
    });
  }
  const total = rows.filter((r) => r.now !== null).length;
  return ok({
    session: { ...s, calibrators: s.calibrators.map((c) => ({ personId: c, name: name(c) })) },
    cycle: (await ctx.tx.cycles.get(s.cycleId))?.name ?? '',
    cells: cells.map((c) => ({
      ...c,
      share: total === 0 ? 0 : Math.round((c.people.length / total) * 100),
    })),
    rows: rows.toSorted(
      (a, b) => Math.abs((b.now ?? 0) - (b.was ?? 0)) - Math.abs((a.now ?? 0) - (a.was ?? 0)),
    ),
    scale,
    may: { change: s.state !== 'finalised', finalise: ctx.viewer.hr && s.state !== 'finalised' },
  });
}

export async function createSession(
  ctx: Ctx,
  input: {
    name: string;
    cycleId: string;
    calibrators: string[];
    subjects: string[];
    department: string | null;
    meetsOn: CalendarDate | null;
  },
): Promise<Result<{ id: string; held: number }>> {
  const h = hrOnly(ctx);
  if (!h.ok) return h;
  const c = await ctx.tx.cycles.get(input.cycleId);
  if (c === null) return err(notFound('cycle'));
  const all = await people(ctx);
  const pool = c.snapshot?.subjects ?? [];
  const subjects =
    input.subjects.length > 0
      ? input.subjects.filter((s) => pool.includes(s))
      : pool.filter(
          (s) =>
            input.department === null ||
            all.find((p) => p.personId === s)?.department === input.department,
        );
  const id = ctx.deps.newId();
  let held = 0;
  for (const p of subjects) {
    const r = await scored(ctx, c.id, p);
    if (r === undefined || r.status !== 'locked') continue;
    const next = hold(r);
    if (next.ok) {
      await ctx.tx.reviews.save(next.value);
      held += 1;
    }
  }
  await ctx.tx.calibrations.save({
    id,
    name: input.name,
    cycleId: c.id,
    calibrators: input.calibrators,
    subjects,
    meetsOn: input.meetsOn,
    state: 'not_started',
    changes: [],
    potentialQuestionId: null,
    at: ctx.at,
  });
  await audit(ctx, { action: 'Opened a calibration session', target: input.name, targetId: id });
  ctx.touched.add(c.id);
  return ok({ id, held });
}

export async function changeCalibratedScore(
  ctx: Ctx,
  id: string,
  input: { personId: string; now: number; reason: string },
): Promise<Result<{ ok: true }>> {
  const s = await ctx.tx.calibrations.get(id);
  if (s === null || !may(ctx, s.calibrators)) return err(notFound('calibration session'));
  const r = await scored(ctx, s.cycleId, input.personId);
  if (r === undefined)
    return err(failure('NO_SCORE', 'That person has no submitted score to calibrate'));
  const scale = (await settingsOf(ctx)).general.scale;
  const lo = (scale[0]?.value ?? 1) * 100;
  const hi = (scale.at(-1)?.value ?? 5) * 100;
  if (input.now < lo || input.now > hi) return err(failure('RANGE', 'That score is off the scale'));
  const next = changeScore(s, {
    personId: input.personId,
    reviewId: r.id,
    was: r.submitted.at(-1)?.scoreHundredths ?? null,
    now: input.now,
    reason: input.reason,
    by: ctx.viewer.name,
    at: ctx.at,
  });
  if (!next.ok) return next;
  await ctx.tx.calibrations.save(next.value);
  await audit(ctx, {
    action: 'Changed a score in calibration',
    target: `${s.name} · ${(await names(ctx))(input.personId)}`,
    targetId: id,
    fields: ['score', 'reason'],
  });
  return ok({ ok: true });
}

/** Finalise (§17): reviews back to locked with their final scores, and one event each for Compensation. */
export async function finaliseSession(
  ctx: Ctx,
  id: string,
): Promise<Result<{ finalised: number }>> {
  const h = hrOnly(ctx);
  if (!h.ok) return h;
  const s = await ctx.tx.calibrations.get(id);
  if (s === null) return err(notFound('calibration session'));
  if (s.state === 'finalised')
    return err(failure('FINALISED', 'This session is already finalised'));
  const c = await ctx.tx.cycles.get(s.cycleId);
  if (c === null) return err(notFound('cycle'));
  const scale = (await settingsOf(ctx)).general.scale;
  let finalised = 0;
  for (const p of s.subjects) {
    const r = await scored(ctx, s.cycleId, p);
    if (r === undefined) continue;
    const change = s.changes.find((x) => x.personId === p);
    const back = releaseHold(r);
    const next: Review =
      change === undefined
        ? back
        : {
            ...back,
            calibrated: {
              hundredths: change.now,
              was: change.was,
              reason: change.reason,
              by: change.by,
              at: change.at,
              sessionId: s.id,
            },
          };
    await ctx.tx.reviews.save(next);
    const final = scoreOf(next);
    if (final === null) continue;
    await publish(
      ctx,
      event(
        ctx,
        'performance.rating.finalized',
        { type: 'rating', id: `${c.id}:${p}` },
        {
          cycleId: c.id,
          sessionId: s.id,
          personId: p,
          scoreHundredths: final,
          scaleMin: scale[0]?.value ?? 1,
          scaleMax: scale.at(-1)?.value ?? 5,
          periodTo: c.period.to,
          supersedes: null,
        },
        c.period.to,
      ),
    );
    finalised += 1;
  }
  await ctx.tx.calibrations.save({ ...s, state: 'finalised' });
  await audit(ctx, { action: 'Finalised a calibration session', target: s.name, targetId: id });
  ctx.touched.add(c.id);
  return ok({ finalised });
}

/** HR takes someone out of a session: their review goes back to locked (§10.1). */
export async function removeFromSession(
  ctx: Ctx,
  id: string,
  personId: string,
): Promise<Result<{ ok: true }>> {
  const h = hrOnly(ctx);
  if (!h.ok) return h;
  const s = await ctx.tx.calibrations.get(id);
  if (s === null) return err(notFound('calibration session'));
  if (s.state === 'finalised') return err(forbidden('A finalised session cannot change'));
  const r = await scored(ctx, s.cycleId, personId);
  if (r !== undefined) await ctx.tx.reviews.save(releaseHold(r));
  await ctx.tx.calibrations.save({
    ...s,
    subjects: s.subjects.filter((x) => x !== personId),
    changes: s.changes.filter((x) => x.personId !== personId),
  });
  await audit(ctx, { action: 'Took someone out of calibration', target: s.name, targetId: id });
  return ok({ ok: true });
}
