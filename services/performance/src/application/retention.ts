import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { plainText, subjectView } from '@kithena/form-kit';

import {
  dueNow,
  dueOn,
  ownNotesDueOn,
  RETENTION_KINDS,
  type Due,
  type RetentionKind,
} from '../domain/retention.js';
import { isSubmitted, standing } from '../domain/review.js';
import { progress } from '../domain/goals.js';
import { label } from '../domain/cycle.js';
import { audit, hrOnly, names, notFound, type Ctx } from './context.js';
import { formOf } from './forms.js';
import { answerText } from './pdf.js';
import { settingsOf } from './settings.js';

/**
 * Retention, legal holds and a person's data (PRD §30, PRF-046), for HR.
 *
 * Nothing is deleted on a timer: the screen lists whose records are due, by
 * kind, and HR confirms the batch, as in Documents. A legal hold keeps
 * everything of the person it names until HR lifts it, with a reason both
 * ways. The export is everything about one person except the private
 * questions about them and the names of those who wrote in confidence
 * (GDPR art. 15(4)), as JSON a person can take elsewhere.
 */

const KIND_WORDS: Readonly<Record<RetentionKind, string>> = {
  reviews: 'Reviews, ratings and goals',
  feedback: 'Feedback and requests',
  notes: 'Notes about them',
  learning: 'Learning and attendance',
  ai: 'What AI wrote for them',
};

/** Everything of one leaver's that a kind covers, ready to count or remove. */
async function recordsOf(
  ctx: Ctx,
  personId: string,
  kinds: readonly RetentionKind[],
  ownNotes: boolean,
): Promise<{ readonly count: Readonly<Record<string, number>>; remove(): Promise<void> }> {
  const has = (k: RetentionKind) => kinds.includes(k);
  const tx = ctx.tx;
  const sets = {
    reviews: has('reviews') ? await tx.reviews.find({ subjectId: personId }) : [],
    nominations: has('reviews') ? await tx.nominations.find({ subjectId: personId }) : [],
    goals: has('reviews') ? await tx.goals.find({ ownerId: personId }) : [],
    feedback: has('feedback') ? await tx.feedback.find({ subjectId: personId }) : [],
    requests: has('feedback') ? await tx.requests.find({ subjectId: personId }) : [],
    notes: [
      ...(has('notes') ? await tx.notes.find({ subjectId: personId }) : []),
      ...(ownNotes ? await tx.notes.find({ ownerId: personId }) : []),
    ],
    assignments: has('learning') ? await tx.assignments.find({ ownerId: personId }) : [],
    ai: has('ai') ? await tx.aiLog.find({ ownerId: personId }) : [],
  };
  const notes = [...new Map(sets.notes.map((n) => [n.id, n])).values()];
  return {
    count: {
      reviews: sets.reviews.length + sets.nominations.length + sets.goals.length,
      feedback: sets.feedback.length + sets.requests.length,
      notes: notes.length,
      learning: sets.assignments.length,
      ai: sets.ai.length,
    },
    async remove() {
      for (const r of sets.reviews) await tx.reviews.remove(r.id);
      for (const n of sets.nominations) await tx.nominations.remove(n.id);
      for (const g of sets.goals) await tx.goals.remove(g.id);
      for (const f of sets.feedback) await tx.feedback.remove(f.id);
      for (const q of sets.requests) await tx.requests.remove(q.id);
      for (const n of notes) await tx.notes.remove(n.id);
      for (const a of sets.assignments) await tx.assignments.remove(a.id);
      for (const a of sets.ai) await tx.aiLog.remove(a.id);
    },
  };
}

async function due(ctx: Ctx): Promise<readonly Due[]> {
  const settings = await settingsOf(ctx);
  const leavers = (await ctx.members())
    .filter((m) => m.status === 'terminated')
    .map((m) => ({ personId: m.personId as string, leftOn: m.leftOn ?? null }));
  return dueNow(
    leavers,
    new Set(settings.privacy.holds.map((h) => h.personId)),
    settings.privacy.retention,
    ctx.today,
  );
}

/** S10: the rule, the holds, what is due now and what comes next. */
export async function retentionScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const settings = await settingsOf(ctx);
  const rule = settings.privacy.retention;
  const name = await names(ctx);
  const held = new Set(settings.privacy.holds.map((h) => h.personId));
  const rows = [];
  for (const d of await due(ctx)) {
    const records = await recordsOf(ctx, d.personId, d.kinds, d.ownNotes);
    const what = Object.entries(records.count).filter(([, n]) => n > 0);
    if (what.length === 0) continue;
    rows.push({
      personId: d.personId,
      name: name(d.personId),
      leftOn: d.leftOn,
      what: what.map(([k, n]) => ({ kind: k, label: KIND_WORDS[k as RetentionKind], count: n })),
    });
  }
  const upcoming = (await ctx.members())
    .filter((m) => m.status === 'terminated' && m.leftOn != null && !held.has(m.personId))
    .map((m) => {
      const leftOn = m.leftOn ?? ctx.today;
      const next = [
        ownNotesDueOn(leftOn),
        ...RETENTION_KINDS.map((k) => dueOn(leftOn, k, rule)),
      ]
        .filter((d) => d > ctx.today)
        .toSorted()[0];
      return { personId: m.personId as string, name: m.displayName, leftOn, next: next ?? null };
    })
    .filter((u) => u.next !== null)
    .toSorted((a, b) => (a.next ?? '').localeCompare(b.next ?? ''))
    .slice(0, 20);
  return ok({
    rule,
    // The whole section, for an administrator to save the periods back over it.
    privacy: settings.privacy,
    admin: ctx.viewer.admin,
    kinds: RETENTION_KINDS.map((k) => ({ kind: k, label: KIND_WORDS[k] })),
    holds: settings.privacy.holds.map((h) => ({ ...h, name: name(h.personId) })),
    due: rows,
    upcoming,
  });
}

/** HR confirms the batch: each person's due records go, a line of the log each. Held or not due, nothing. */
export async function confirmRetention(
  ctx: Ctx,
  personIds: readonly string[],
): Promise<Result<{ deleted: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const chosen = new Set(personIds);
  const name = await names(ctx);
  let deleted = 0;
  for (const d of await due(ctx)) {
    if (!chosen.has(d.personId)) continue;
    const records = await recordsOf(ctx, d.personId, d.kinds, d.ownNotes);
    const what = Object.entries(records.count).filter(([, n]) => n > 0);
    if (what.length === 0) continue;
    await records.remove();
    deleted += what.reduce((n, [, c]) => n + c, 0);
    await audit(ctx, {
      kind: 'person',
      action: 'Deleted records at the end of retention',
      target: name(d.personId),
      targetId: d.personId,
      fields: what.map(([k, n]) => `${k} ${String(n)}`),
      area: 'records',
    });
  }
  return ok({ deleted });
}

/** A legal hold: nothing of this person's goes until HR lifts it. */
export async function placeHold(
  ctx: Ctx,
  personId: string,
  reason: string,
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  if ((await ctx.tx.members.get(personId)) === null) return err(notFound('person'));
  if (reason.trim() === '') return err(failure('REASON', 'Say why the records are held'));
  const settings = await settingsOf(ctx);
  const holds = settings.privacy.holds.filter((h) => h.personId !== personId);
  // HR's to place, not only an administrator's: written as the section, without its settings check.
  await ctx.tx.settings.set('privacy', {
    ...settings.privacy,
    holds: [...holds, { personId, reason: reason.trim(), at: ctx.at }],
  });
  await audit(ctx, {
    kind: 'person',
    action: 'Placed a legal hold',
    target: (await names(ctx))(personId),
    targetId: personId,
    reason: reason.trim(),
    area: 'records',
  });
  return ok({ ok: true });
}

export async function liftHold(
  ctx: Ctx,
  personId: string,
  reason: string | null,
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const settings = await settingsOf(ctx);
  if (!settings.privacy.holds.some((h) => h.personId === personId))
    return err(notFound('legal hold'));
  await ctx.tx.settings.set('privacy', {
    ...settings.privacy,
    holds: settings.privacy.holds.filter((h) => h.personId !== personId),
  });
  await audit(ctx, {
    kind: 'person',
    action: 'Lifted a legal hold',
    target: (await names(ctx))(personId),
    targetId: personId,
    reason,
    area: 'records',
  });
  return ok({ ok: true });
}

/**
 * A person's data (§30): everything about them except the private questions
 * about them and the names of whoever wrote in confidence, and what they wrote
 * about others named but not quoted, since that is the others' as much as
 * theirs. Logged as a sensitive read.
 */
export async function personExport(
  ctx: Ctx,
  personId: string,
): Promise<Result<{ filename: string; base64: string; mediaType: string }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const member = await ctx.tx.members.get(personId);
  if (member === null) return err(notFound('person'));
  const name = await names(ctx);
  const tx = ctx.tx;
  const cycles = new Map((await tx.cycles.find()).map((c) => [c.id, c.name]));
  const someone = 'Someone at the company';

  const reviewsAbout = [];
  for (const r of await tx.reviews.find({ subjectId: personId })) {
    if (!isSubmitted(r)) continue;
    const form = await formOf(ctx, r);
    if (form === null) continue;
    const view = subjectView(form, standing(r));
    reviewsAbout.push({
      cycle: r.cycleId === null ? null : (cycles.get(r.cycleId) ?? null),
      review: label(r.kind),
      by: r.confidential ? someone : name(r.authorId),
      submitted: r.submitted.at(-1)?.at ?? null,
      answers: view.definition.sections.flatMap((s) =>
        s.questions.map((q) => ({
          section: s.title,
          question: q.prompt,
          answer: answerText(view.definition, q.id, view.answers),
        })),
      ),
    });
  }
  const data = {
    person: {
      name: member.displayName,
      title: member.title,
      hiredOn: member.hiredOn,
      leftOn: member.leftOn ?? null,
    },
    exportedAt: ctx.at,
    reviewsAbout,
    reviewsWritten: (await tx.reviews.find({ ownerId: personId }))
      .filter((r) => r.subjectId !== personId)
      .map((r) => ({
        about: name(r.subjectId),
        review: label(r.kind),
        cycle: r.cycleId === null ? null : (cycles.get(r.cycleId) ?? null),
        submitted: r.submitted.at(-1)?.at ?? null,
      })),
    feedbackReceived: (await tx.feedback.find({ subjectId: personId }))
      .filter((f) => !f.undone)
      .map((f) => ({
        from: f.showName ? name(f.from) : someone,
        kind: f.kind,
        text: plainText(f.body),
        value: f.value,
        at: f.at,
      })),
    feedbackGiven: (await tx.feedback.find({ ownerId: personId }))
      .filter((f) => !f.undone)
      .map((f) => ({ to: name(f.to), kind: f.kind, text: plainText(f.body), at: f.at })),
    goals: (await tx.goals.find({ ownerId: personId })).map((g) => ({
      title: g.title,
      status: g.status,
      progress: progress(g),
      keyResults: g.keyResults.map((k) => ({
        title: k.title,
        start: k.start,
        target: k.target,
        current: k.current,
        unit: k.unit,
      })),
      checkIns: g.checkIns.map((c) => ({ at: c.at, confidence: c.confidence, note: c.note })),
    })),
    learning: await Promise.all(
      (await tx.assignments.find({ ownerId: personId })).map(async (a) => ({
        item: (await tx.items.get(a.itemId))?.title ?? null,
        due: a.due,
        acknowledgedAt: a.acknowledgedAt,
        completedAt: a.completedAt,
      })),
    ),
    notesAbout: (await tx.notes.find({ subjectId: personId })).map((n) => ({
      title: n.title,
      text: plainText(n.body),
      at: n.at,
    })),
    notesWritten: (await tx.notes.find({ ownerId: personId })).map((n) => ({
      about: name(n.about),
      title: n.title,
      text: plainText(n.body),
      at: n.at,
    })),
    ai: (await tx.aiLog.find({ ownerId: personId })).map((a) => ({
      feature: a.feature,
      on: a.on,
      model: a.model,
      at: a.at,
    })),
  };
  await audit(ctx, {
    kind: 'person',
    action: 'Exported a person’s data (sensitive read)',
    target: member.displayName,
    targetId: personId,
    area: 'access',
  });
  return ok({
    filename: `${member.displayName.replaceAll(/[^\p{L}\p{N} ._-]+/gu, '').trim() || 'Person'} - Performance data.json`,
    base64: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
    mediaType: 'application/json',
  });
}
