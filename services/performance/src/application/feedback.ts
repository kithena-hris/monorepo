import type { CalendarDate, FormAnswers } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { plainText, validateAnswers } from '@kithena/form-kit';

import {
  audiences,
  checkGive,
  readerOf,
  undo,
  UNDO_MS,
  type Audience,
} from '../domain/feedback.js';
import { published } from '../domain/template.js';
import { audit, event, forbidden, me, names, notFound, publish, type Ctx } from './context.js';
import { people, subtitle } from './members.js';
import { settingsOf } from './settings.js';

/**
 * Feedback, requests, praise and notes (PRD §12, §13.8, PRF-045). Outside any
 * cycle, from anyone to anyone the company allows, with exactly who sees it
 * said before sending, and ten minutes to undo.
 */

export async function feedbackScreen(ctx: Ctx, tab: string): Promise<Result<unknown>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const name = await names(ctx);
  const settings = await settingsOf(ctx);
  const all = await ctx.tx.feedback.find();
  const received = all
    .filter(
      (f) =>
        f.to === who.value &&
        !f.undone &&
        readerOf(f, { personId: who.value, hr: false, managerOfRecipient: false }).sees,
    )
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map(async (f) => ({
      id: f.id,
      from: f.showName || f.kind === 'praise' ? name(f.from) : null,
      fromId: f.showName || f.kind === 'praise' ? f.from : null,
      kind: f.kind,
      body: f.body,
      value: f.value,
      at: f.at,
      audience: f.audience,
      template:
        f.templateId === null ? null : ((await ctx.tx.templates.get(f.templateId))?.name ?? null),
    }));
  const sent = all
    .filter((f) => f.from === who.value)
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .map((f) => ({
      id: f.id,
      to: name(f.to),
      toId: f.to,
      kind: f.kind,
      body: f.body,
      value: f.value,
      at: f.at,
      audience: f.audience,
      undone: f.undone,
      undoUntil: f.undone ? null : new Date(Date.parse(f.at) + UNDO_MS).toISOString(),
    }));
  const requests = await ctx.tx.requests.find();
  const open = requests
    .filter((r) => r.to.includes(who.value) && !r.answered.some((a) => a.personId === who.value))
    .map((r) => ({
      id: r.id,
      from: name(r.from),
      about: name(r.about),
      aboutId: r.about,
      question: r.question,
      topic: r.topic,
      due: r.due,
      templateId: r.templateId,
    }));
  const asked = requests
    .filter((r) => r.from === who.value)
    .map((r) => ({
      id: r.id,
      to: r.to.map(name),
      about: name(r.about),
      topic: r.topic,
      answered: r.answered.filter((a) => !a.declined).length,
      of: r.to.length,
    }));
  const praise = all
    .filter((f) => f.kind === 'praise' && f.audience === 'everyone' && !f.undone)
    .toSorted((a, b) => b.at.localeCompare(a.at))
    .slice(0, 60)
    .map((f) => ({
      id: f.id,
      from: name(f.from),
      fromId: f.from,
      to: name(f.to),
      toId: f.to,
      body: f.body,
      value: f.value,
      at: f.at,
    }));
  const templates = (await ctx.tx.templates.find())
    .filter((t) => !t.archived && t.purpose.includes('feedback') && published(t) !== undefined)
    .map((t) => ({ id: t.id, name: t.name, definition: published(t)?.definition ?? null }));
  return ok({
    tab,
    received: await Promise.all(received),
    sent,
    open,
    asked,
    praise,
    templates,
    settings: {
      names: settings.feedback.names,
      sees: settings.feedback.sees,
      audiences: audiences(settings.feedback, false),
      praiseAudiences: audiences(settings.feedback, true),
      values: settings.feedback.praise.values,
      toneCheck:
        settings.feedback.toneCheck &&
        settings.ai.features['toneCheck'] !== false &&
        ctx.deps.model !== undefined,
      on: settings.feedback.who !== 'nobody',
    },
  });
}

/** The receiver's manager, for "Omar and Marco" (design PF14c). */
export async function recipientScreen(ctx: Ctx, personId: string): Promise<Result<unknown>> {
  const all = await people(ctx);
  const p = all.find((x) => x.personId === personId);
  if (p === undefined) return err(notFound('person'));
  const manager = p.managerId === null ? undefined : all.find((x) => x.personId === p.managerId);
  return ok({
    personId,
    name: p.name,
    title: subtitle(p),
    manager: manager === undefined ? null : { personId: manager.personId, name: manager.name },
  });
}

export async function giveFeedback(
  ctx: Ctx,
  input: {
    to: string;
    kind: 'feedback' | 'praise';
    body: string;
    audience: Audience;
    showName: boolean;
    value: string | null;
    templateId: string | null;
    answers: FormAnswers | null;
    requestId: string | null;
  },
): Promise<Result<{ id: string; undoUntil: string }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const settings = await settingsOf(ctx);
  const checked = checkGive(settings.feedback, {
    from: who.value,
    to: input.to,
    praise: input.kind === 'praise',
    audience: input.audience,
    showName: input.showName,
  });
  if (!checked.ok) return checked;
  if (!(await ctx.members()).some((m) => m.personId === input.to)) return err(notFound('person'));
  let version: number | null = null;
  if (input.templateId !== null) {
    const t = await ctx.tx.templates.get(input.templateId);
    const p = t === null ? undefined : published(t);
    if (t === null || p === undefined || !t.purpose.includes('feedback'))
      return err(notFound('feedback template'));
    const valid = validateAnswers(p.definition, input.answers ?? {}, { submitting: true });
    if (!valid.ok) return valid;
    version = p.version;
  } else if (plainText(input.body) === '') return err(failure('EMPTY', 'Write something first'));
  const id = ctx.deps.newId();
  await ctx.tx.feedback.save({
    id,
    from: who.value,
    to: input.to,
    kind: input.requestId !== null ? 'answer' : input.kind,
    body: input.body,
    templateId: input.templateId,
    version,
    answers: input.answers,
    value: input.kind === 'praise' ? input.value : null,
    audience: checked.value.audience,
    showName: checked.value.showName,
    requestId: input.requestId,
    at: ctx.at,
    undone: false,
  });
  if (input.requestId !== null) {
    const r = await ctx.tx.requests.get(input.requestId);
    if (r !== null)
      await ctx.tx.requests.save({
        ...r,
        answered: [
          ...r.answered.filter((a) => a.personId !== who.value),
          { personId: who.value, feedbackId: id, declined: false },
        ],
      });
  }
  await publish(
    ctx,
    event(
      ctx,
      'performance.feedback.given',
      { type: 'feedback', id },
      { feedbackId: id, to: input.to, praise: input.kind === 'praise' },
    ),
  );
  await audit(ctx, { kind: 'feedback',
    action: input.kind === 'praise' ? 'Gave praise' : 'Gave feedback',
    target: (await names(ctx))(input.to),
    targetId: id,
    fields: ['body', 'audience'],
  });
  return ok({ id, undoUntil: new Date(Date.parse(ctx.at) + UNDO_MS).toISOString() });
}

export async function undoFeedback(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const f = await ctx.tx.feedback.get(id);
  if (f === null) return err(notFound('feedback'));
  const done = undo(f, ctx.viewer.personId ?? '', Date.parse(ctx.at));
  if (!done.ok) return done;
  await ctx.tx.feedback.save(done.value);
  await audit(ctx, { kind: 'feedback', action: 'Undid feedback', target: 'Feedback', targetId: id });
  return ok({ ok: true });
}

export async function requestFeedback(
  ctx: Ctx,
  input: {
    to: string[];
    about: string | null;
    question: string | null;
    templateId: string | null;
    topic: string | null;
    due: CalendarDate | null;
  },
): Promise<Result<{ id: string }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const about = input.about ?? who.value;
  if (about !== who.value && !ctx.viewer.reports.has(about))
    return err(forbidden('You can ask about yourself or your reports'));
  const to = [...new Set(input.to)].filter((p) => p !== about);
  if (to.length === 0 || to.length > 10) return err(failure('COUNT', 'Ask 1 to 10 people'));
  if (input.question === null && input.templateId === null)
    return err(failure('EMPTY', 'Ask a question or pick a template'));
  const id = ctx.deps.newId();
  await ctx.tx.requests.save({
    id,
    from: who.value,
    about,
    to,
    question: input.question,
    templateId: input.templateId,
    topic: input.topic,
    due: input.due,
    answered: [],
    at: ctx.at,
  });
  const name = await names(ctx);
  const members = await ctx.members();
  for (const p of to) {
    const email = members.find((m) => m.personId === p)?.workEmail;
    if (email)
      ctx.mail.push({
        to: email,
        subject: `${name(who.value)} asked for your feedback`,
        text: `${name(who.value)} would like your feedback${input.topic === null ? '' : ` on ${input.topic}`}. Answer in Kithena, under Performance › Feedback.`,
        dedupeKey: `request:${id}:${p}`,
      });
  }
  await audit(ctx, { kind: 'request',
    action: 'Requested feedback',
    target: `${String(to.length)} people`,
    targetId: id,
  });
  return ok({ id });
}

export async function declineRequest(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const r = await ctx.tx.requests.get(id);
  if (r === null || !r.to.includes(who.value)) return err(notFound('request'));
  await ctx.tx.requests.save({
    ...r,
    answered: [
      ...r.answered.filter((a) => a.personId !== who.value),
      { personId: who.value, feedbackId: null, declined: true },
    ],
  });
  await audit(ctx, { kind: 'request',
    action: 'Declined a feedback request',
    target: 'Feedback request',
    targetId: id,
  });
  return ok({ ok: true });
}

/* --------------------------------------------------------------- notes -- */

/** PF21: the writer's own notes about the people they work with, private unless shared. */
export async function notesScreen(ctx: Ctx, about: string | null): Promise<Result<unknown>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const name = await names(ctx);
  const notes = await ctx.tx.notes.find({ ownerId: who.value });
  const all = await people(ctx);
  const subjects = new Set([...ctx.viewer.reports, ...notes.map((n) => n.about)]);
  const list = [...subjects]
    .map((p) => ({
      personId: p,
      name: name(p),
      title: subtitle(all.find((x) => x.personId === p)),
      notes: notes.filter((n) => n.about === p).length,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const chosen = about ?? list[0]?.personId ?? null;
  const shared = (await ctx.tx.notes.find({ subjectId: who.value })).filter(
    (n) => n.shared && n.author !== who.value,
  );
  return ok({
    people: list,
    about: chosen,
    aboutName: chosen === null ? null : name(chosen),
    notes: notes.filter((n) => n.about === chosen).toSorted((a, b) => b.at.localeCompare(a.at)),
    sharedWithMe: shared.map((n) => ({ ...n, authorName: name(n.author) })),
  });
}

export async function saveNote(
  ctx: Ctx,
  input: { id: string | null; about: string; title: string; body: string; shared: boolean },
): Promise<Result<{ id: string }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  if (plainText(input.body) === '') return err(failure('EMPTY', 'Write something first'));
  const id = input.id ?? ctx.deps.newId();
  if (input.id !== null) {
    const old = await ctx.tx.notes.get(input.id);
    if (old === null || old.author !== who.value) return err(notFound('note'));
  }
  await ctx.tx.notes.save({
    id,
    author: who.value,
    about: input.about,
    title: input.title || ctx.today,
    body: input.body,
    shared: input.shared,
    at: ctx.at,
  });
  await audit(ctx, { kind: 'note',
    action: input.id === null ? 'Wrote a note' : 'Edited a note',
    target: 'Note',
    targetId: id,
    fields: input.shared ? ['shared'] : [],
  });
  return ok({ id });
}

export async function deleteNote(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const n = await ctx.tx.notes.get(id);
  if (n === null || n.author !== ctx.viewer.personId) return err(notFound('note'));
  await ctx.tx.notes.remove(id);
  await audit(ctx, { kind: 'note', action: 'Deleted a note', target: 'Note', targetId: id });
  return ok({ ok: true });
}
