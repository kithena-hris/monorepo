import { randomBytes } from 'node:crypto';
import { FormDefinition, type CalendarDate, type FormAnswers } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import { grade, validateAnswers } from '@kithena/form-kit';

import { invitation } from '../domain/calendar.js';
import { addDays, matches, type Condition } from '../domain/cycle.js';
import {
  complete,
  markPart,
  scan,
  stateOf,
  type Assignment,
  type LearningItem,
  type Session,
} from '../domain/learning.js';
import {
  audit,
  emailOf,
  event,
  forbidden,
  hrOnly,
  me,
  names,
  notFound,
  publish,
  type Ctx,
  mailWords,
} from './context.js';
import { filterable } from './cycles.js';
import { people } from './members.js';
import { settingsOf } from './settings.js';

/**
 * Learning (PRD §15, PRF-105 to PRF-107): the catalogue, assignments by
 * person, filter or cycle, courses with acknowledgement, quizzes on the form
 * kit, sessions with attendance by QR or by hand, and completions imported
 * from a CSV. Providers sync through `LearningProvider` adapters once a
 * company connects one (settings).
 */

const code = (): string => randomBytes(9).toString('base64url');

/**
 * A session's calendar invitation to each of these learners (PRD §15.4): an
 * `.ics` beside the email, sent once the change commits, so their calendar
 * holds the session, moves it when it moves, and drops it when it is
 * cancelled. Only for a session still to come; a learner without a work
 * address gets the Inbox alone.
 */
async function invite(
  ctx: Ctx,
  item: LearningItem,
  session: Session,
  personIds: readonly string[],
  method: 'REQUEST' | 'CANCEL',
): Promise<void> {
  if (session.start <= ctx.at || personIds.length === 0) return;
  const { t, language } = await mailWords(ctx);
  const name = await names(ctx);
  // Rises with every change, so a calendar keeps the newest copy.
  const sequence = Math.floor(Date.parse(ctx.at) / 1000);
  const when = new Intl.DateTimeFormat(language, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(session.start));
  const where = session.place ?? session.online;
  for (const personId of personIds) {
    const email = await emailOf(ctx, personId);
    if (email === null) continue;
    const ics = invitation({
      uid: `${session.id}@performance.kithena.com`,
      sequence,
      method,
      start: session.start,
      end: session.end,
      title: item.title,
      description:
        method === 'CANCEL'
          ? 'This session is cancelled.'
          : `${item.title}. Accepting adds it to your calendar; Kithena marks you present when you scan the code at the door.`,
      location: where,
      url: session.online,
      organizer: { name: 'Kithena', email: 'no-reply@kithena.com' },
      attendee: { name: name(personId), email },
      stamp: ctx.at,
    });
    ctx.mail.push({
      to: email,
      subject: t('email.learning.utc', '{{value}}: {{title}}, {{when}} UTC', {
        value:
          method === 'CANCEL'
            ? t('email.learning.cancelled', 'Cancelled')
            : t('email.learning.invitation', 'Invitation'),
        title: item.title,
        when,
      }),
      text:
        method === 'CANCEL'
          ? t('email.learning.on_utc_is_cancelled', '{{title}} on {{when}} (UTC) is cancelled.', {
              title: item.title,
              when,
            })
          : t(
              'email.learning.you_are_invited_to_on_utc',
              'You are invited to {{title}} on {{when}} (UTC){{value}}. The invitation is attached for your calendar.',
              { title: item.title, when, value: where === null ? '' : `, ${where}` },
            ),
      dedupeKey: `performance-invite:${session.id}:${personId}:${String(sequence)}:${method}`,
      attachments: [
        { filename: 'invite.ics', base64: Buffer.from(ics, 'utf8').toString('base64') },
      ],
    });
  }
}

/** A new company's first items, so the catalogue is not empty on day one. */
async function ensureCatalogue(ctx: Ctx): Promise<void> {
  if ((await ctx.tx.settings.get('learningSeeded')) !== null) return;
  await ctx.tx.settings.set('learningSeeded', { at: ctx.at });
  const quiz = FormDefinition.parse({
    title: 'Security awareness quiz',
    sections: [
      {
        id: 'quiz',
        title: 'Quiz',
        questions: [
          {
            id: 'q1',
            type: 'choice',
            prompt:
              'A customer emails asking for another customer’s payout status. What do you do?',
            options: [
              { id: 'a', label: 'Reply with the status if they know the payout ID' },
              { id: 'b', label: 'Decline, and point them to the account owner' },
              { id: 'c', label: 'Forward it to Support' },
            ],
            correct: ['b'],
          },
          {
            id: 'q2',
            type: 'choice',
            prompt: 'Which of these is the strongest way to sign in?',
            options: [
              { id: 'a', label: 'A long password' },
              { id: 'b', label: 'A passkey' },
              { id: 'c', label: 'A code by text message' },
            ],
            correct: ['b'],
          },
          {
            id: 'q3',
            type: 'choice',
            prompt: 'You get an urgent email from “the CEO” asking for gift cards. What is it?',
            options: [
              { id: 'a', label: 'Phishing' },
              { id: 'b', label: 'A real request' },
            ],
            correct: ['a'],
          },
        ],
      },
    ],
  });
  const items: LearningItem[] = [
    {
      id: ctx.deps.newId(),
      title: `Security awareness ${ctx.today.slice(0, 4)}`,
      kind: 'course',
      provider: 'Your company',
      minutes: 25,
      parts: [
        { id: 'phishing', title: 'Phishing', minutes: 8 },
        { id: 'passkeys', title: 'Passwords and passkeys', minutes: 7 },
        { id: 'data', title: 'Handling customer data', minutes: 8 },
      ],
      acknowledgement: 'I’ve read and understood the security policy',
      quiz: { definition: quiz, passMark: 2 },
      recursMonths: 12,
      certificateYears: 1,
      sessions: [],
      skills: ['Security'],
      url: null,
      createdAt: ctx.at,
    },
    {
      id: ctx.deps.newId(),
      title: 'Giving feedback that lands',
      kind: 'path',
      provider: 'Your company',
      minutes: 70,
      parts: [
        { id: 'why', title: 'Why feedback matters', minutes: 20 },
        { id: 'how', title: 'Specific, about behaviour', minutes: 25 },
        { id: 'practice', title: 'Practice conversations', minutes: 25 },
      ],
      acknowledgement: null,
      quiz: null,
      recursMonths: null,
      certificateYears: null,
      sessions: [],
      skills: ['Feedback', 'Management'],
      url: null,
      createdAt: ctx.at,
    },
    {
      id: ctx.deps.newId(),
      title: 'Incident command',
      kind: 'session',
      provider: 'Your company',
      minutes: 90,
      parts: [],
      acknowledgement: null,
      quiz: null,
      recursMonths: null,
      certificateYears: 2,
      sessions: [
        {
          id: ctx.deps.newId(),
          start: `${addDays(ctx.today, 12)}T15:00:00.000Z`,
          end: `${addDays(ctx.today, 12)}T16:30:00.000Z`,
          place: 'Main office',
          online: null,
          qr: code(),
        },
      ],
      skills: ['Operations'],
      url: null,
      createdAt: ctx.at,
    },
  ];
  for (const i of items) await ctx.tx.items.save(i);
}

const kindLabel = (i: LearningItem): string =>
  i.kind === 'session'
    ? `Live session · ${i.sessions[0]?.start.slice(0, 16).replace('T', ' ') ?? ''}`
    : i.kind === 'path'
      ? `Path · ${String(i.parts.length)} items`
      : `${i.kind.charAt(0).toUpperCase()}${i.kind.slice(1)} · ${i.provider === 'Your company' ? `${String(i.minutes)} min` : i.provider}`;

export async function learningScreen(ctx: Ctx, tab: string): Promise<Result<unknown>> {
  await ensureCatalogue(ctx);
  const items = await ctx.tx.items.find();
  const byId = new Map(items.map((i) => [i.id, i]));
  const mineId = ctx.viewer.personId;
  const all = await ctx.tx.assignments.find();
  const mine = all.filter((a) => a.personId === mineId);
  const settings = await settingsOf(ctx);
  return ok({
    tab,
    assigned: mine
      .map((a) => ({ a, i: byId.get(a.itemId) }))
      .filter((x): x is { a: Assignment; i: LearningItem } => x.i !== undefined)
      .map(({ a, i }) => ({
        id: a.id,
        itemId: i.id,
        title: i.title,
        kind: kindLabel(i),
        why: a.why,
        due: a.due,
        recurs:
          i.recursMonths === null
            ? null
            : `Every ${i.recursMonths === 12 ? 'year' : `${String(i.recursMonths)} months`}`,
        expires: a.expiresOn,
        state: stateOf(a, i),
        progress:
          i.parts.length === 0 ? null : `${String(a.done.length)} of ${String(i.parts.length)}`,
        completedAt: a.completedAt,
      })),
    catalogue: items.map((i) => ({
      id: i.id,
      title: i.title,
      kind: i.kind,
      provider: i.provider,
      minutes: i.minutes,
      assigned: all.filter((a) => a.itemId === i.id).length,
      skills: i.skills,
    })),
    sessions: items
      .filter((i) => i.kind === 'session')
      .flatMap((i) =>
        i.sessions.map((s) => ({
          itemId: i.id,
          sessionId: s.id,
          title: i.title,
          start: s.start,
          end: s.end,
          place: s.place,
          online: s.online,
          going: all.filter(
            (a) =>
              a.itemId === i.id &&
              a.attendance.some((x) => x.sessionId === s.id && x.invitation === 'accepted'),
          ).length,
        })),
      ),
    providers: settings.learning.providers,
    hr: ctx.viewer.hr,
    manager: ctx.viewer.reports.size > 0,
  });
}

export async function itemScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const i = await ctx.tx.items.get(id);
  if (i === null) return err(notFound('learning item'));
  const mine =
    ctx.viewer.personId === null
      ? undefined
      : (await ctx.tx.assignments.find({ ownerId: ctx.viewer.personId })).find(
          (a) => a.itemId === id,
        );
  return ok({
    item: {
      ...i,
      quiz:
        i.quiz === null
          ? null
          : {
              definition: stripCorrect(i.quiz.definition),
              passMark: i.quiz.passMark,
              questions: i.quiz.definition.sections.reduce((n, s) => n + s.questions.length, 0),
            },
      sessions: i.sessions.map(({ qr: _qr, ...s }) => s),
    },
    assignment: mine === undefined ? null : { ...mine, state: stateOf(mine, i) },
    hr: ctx.viewer.hr,
  });
}

/** Whoever answers a quiz never sees its right answers. */
function stripCorrect(def: FormDefinition): FormDefinition {
  return {
    ...def,
    sections: def.sections.map((s) => ({
      ...s,
      questions: s.questions.map((q) => {
        if (q.type !== 'choice') return q;
        const { correct: _c, ...rest } = q;
        return rest;
      }),
    })),
  };
}

/** PF15d: a session's invitations and attendance, and its door code, for HR or the trainer. */
export async function sessionScreen(
  ctx: Ctx,
  itemId: string,
  sessionId: string,
): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const i = await ctx.tx.items.get(itemId);
  const s = i?.sessions.find((x) => x.id === sessionId);
  if (i === null || s === undefined) return err(notFound('session'));
  const name = await names(ctx);
  const rows = (await ctx.tx.assignments.find())
    .filter((a) => a.itemId === itemId)
    .map((a) => {
      const att = a.attendance.find((x) => x.sessionId === sessionId);
      return {
        assignmentId: a.id,
        personId: a.personId,
        name: name(a.personId),
        invitation: att?.invitation ?? 'invited',
        attended: att?.attended ?? null,
      };
    });
  return ok({ item: { id: i.id, title: i.title }, session: s, rows });
}

export async function saveItem(
  ctx: Ctx,
  id: string | null,
  input: Omit<LearningItem, 'id' | 'createdAt' | 'sessions'> & {
    sessions: {
      id: string | null;
      start: string;
      end: string;
      place: string | null;
      online: string | null;
    }[];
  },
): Promise<Result<{ id: string }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const old = id === null ? null : await ctx.tx.items.get(id);
  if (id !== null && old === null) return err(notFound('learning item'));
  if (input.quiz !== null) {
    const parsed = FormDefinition.safeParse(input.quiz.definition);
    if (!parsed.success) return err(failure('BAD_QUIZ', 'The quiz is not a valid form'));
  }
  const item: LearningItem = {
    ...input,
    id: id ?? ctx.deps.newId(),
    createdAt: old?.createdAt ?? ctx.at,
    sessions: input.sessions.map((s) => ({
      ...s,
      id: s.id ?? ctx.deps.newId(),
      qr: old?.sessions.find((x) => x.id === s.id)?.qr ?? code(),
    })),
  };
  await ctx.tx.items.save(item);
  // Sessions added, moved or dropped reach the people already assigned, in their calendars.
  if (old !== null) {
    const learners = (await ctx.tx.assignments.find()).filter(
      (a) => a.itemId === item.id && a.completedAt === null,
    );
    const same = (a: Session, b: Session) =>
      a.start === b.start && a.end === b.end && a.place === b.place && a.online === b.online;
    for (const s of item.sessions) {
      const before = old.sessions.find((x) => x.id === s.id);
      if (before === undefined) {
        for (const a of learners)
          await ctx.tx.assignments.save({
            ...a,
            attendance: [
              ...a.attendance,
              { sessionId: s.id, invitation: 'invited', attended: null },
            ],
          });
        await invite(
          ctx,
          item,
          s,
          learners.map((a) => a.personId),
          'REQUEST',
        );
      } else if (!same(before, s)) {
        await invite(
          ctx,
          item,
          s,
          learners.map((a) => a.personId),
          'REQUEST',
        );
      }
    }
    for (const gone of old.sessions.filter((x) => !item.sessions.some((s) => s.id === x.id)))
      await invite(
        ctx,
        item,
        gone,
        learners.map((a) => a.personId),
        'CANCEL',
      );
  }
  await audit(ctx, {
    kind: 'learning',
    action: id === null ? 'Added a learning item' : 'Edited a learning item',
    target: item.title,
    targetId: item.id,
  });
  return ok({ id: item.id });
}

/** PF15c: by name, by filter (kept in step as people change), or everyone in a cycle. */
export async function assign(
  ctx: Ctx,
  itemId: string,
  input: {
    people: string[];
    filter: Condition[];
    cycleId: string | null;
    due: CalendarDate | null;
    why: string;
  },
): Promise<Result<{ assigned: number }>> {
  const i = await ctx.tx.items.get(itemId);
  if (i === null) return err(notFound('learning item'));
  const all = await people(ctx);
  let targets = new Set(input.people);
  if (input.filter.length > 0)
    for (const p of all)
      if (p.status !== 'terminated' && matches(filterable(p), input.filter))
        targets.add(p.personId);
  if (input.cycleId !== null) {
    const c = await ctx.tx.cycles.get(input.cycleId);
    for (const s of c?.snapshot?.subjects ?? []) targets.add(s);
  }
  if (!ctx.viewer.hr) {
    if (![...targets].every((p) => ctx.viewer.org.has(p)))
      return err(forbidden('You assign learning to your reports'));
  }
  targets = new Set([...targets].filter((p) => all.some((x) => x.personId === p)));
  const existing = new Set(
    (await ctx.tx.assignments.find())
      .filter((a) => a.itemId === itemId && a.completedAt === null)
      .map((a) => a.personId),
  );
  let assigned = 0;
  const fresh: string[] = [];
  for (const p of targets) {
    if (existing.has(p)) continue;
    await ctx.tx.assignments.save({
      id: ctx.deps.newId(),
      itemId,
      personId: p,
      by: ctx.viewer.name,
      why: input.why || (ctx.viewer.hr ? 'Required' : 'From your manager'),
      due: input.due,
      cycleId: input.cycleId,
      done: [],
      acknowledgedAt: null,
      quiz: null,
      attendance: i.sessions.map((s) => ({
        sessionId: s.id,
        invitation: 'invited' as const,
        attended: null,
      })),
      completedAt: null,
      expiresOn: null,
      at: ctx.at,
    });
    assigned += 1;
    fresh.push(p);
  }
  for (const session of i.sessions) await invite(ctx, i, session, fresh, 'REQUEST');
  await audit(ctx, {
    kind: 'learning',
    action: 'Assigned learning',
    target: `${i.title} · ${String(assigned)} people`,
    targetId: itemId,
  });
  return ok({ assigned });
}

async function own(
  ctx: Ctx,
  assignmentId: string,
): Promise<Result<{ a: Assignment; i: LearningItem }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const a = await ctx.tx.assignments.get(assignmentId);
  if (a?.personId !== who.value) return err(notFound('assignment'));
  const i = await ctx.tx.items.get(a.itemId);
  if (i === null) return err(notFound('learning item'));
  return ok({ a, i });
}

async function saveDone(
  ctx: Ctx,
  before: Assignment,
  after: Assignment,
  title: string,
): Promise<void> {
  await ctx.tx.assignments.save(after);
  if (before.completedAt === null && after.completedAt !== null)
    await publish(
      ctx,
      event(
        ctx,
        'performance.learning.completed',
        { type: 'learning', id: after.itemId },
        { itemId: after.itemId, personId: after.personId },
      ),
    );
  await audit(ctx, {
    kind: 'assignment',
    action:
      after.completedAt !== null && before.completedAt === null
        ? 'Completed learning'
        : 'Made progress on learning',
    target: title,
    targetId: after.id,
  });
}

export async function markLearningPart(
  ctx: Ctx,
  assignmentId: string,
  partId: string,
): Promise<Result<{ state: string }>> {
  const got = await own(ctx, assignmentId);
  if (!got.ok) return got;
  const next = markPart(got.value.a, got.value.i, partId, ctx.at);
  if (!next.ok) return next;
  await saveDone(ctx, got.value.a, next.value, got.value.i.title);
  return ok({ state: stateOf(next.value, got.value.i) });
}

export async function acknowledgeLearning(
  ctx: Ctx,
  assignmentId: string,
): Promise<Result<{ state: string }>> {
  const got = await own(ctx, assignmentId);
  if (!got.ok) return got;
  const next = complete({ ...got.value.a, acknowledgedAt: ctx.at }, got.value.i, ctx.at);
  await saveDone(ctx, got.value.a, next, got.value.i.title);
  return ok({ state: stateOf(next, got.value.i) });
}

export async function submitQuiz(
  ctx: Ctx,
  assignmentId: string,
  answers: FormAnswers,
): Promise<Result<{ correct: number; of: number; passed: boolean }>> {
  const got = await own(ctx, assignmentId);
  if (!got.ok) return got;
  const quiz = got.value.i.quiz;
  if (quiz === null) return err(notFound('quiz'));
  const valid = validateAnswers(quiz.definition, answers, { submitting: true });
  if (!valid.ok) return valid;
  const marks = grade(quiz.definition, answers);
  const passed = marks.correct >= quiz.passMark;
  const next = complete(
    { ...got.value.a, quiz: { ...marks, passed, at: ctx.at } },
    got.value.i,
    ctx.at,
  );
  await saveDone(ctx, got.value.a, next, got.value.i.title);
  return ok({ ...marks, passed });
}

/** PFM8b: a learner scans the door's code. */
export async function scanSession(
  ctx: Ctx,
  code: string,
): Promise<Result<{ title: string; at: string }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  for (const a of await ctx.tx.assignments.find({ ownerId: who.value })) {
    const i = await ctx.tx.items.get(a.itemId);
    if (i === null || !i.sessions.some((s) => s.qr === code)) continue;
    const next = scan(a, i, code, ctx.at);
    if (!next.ok) return next;
    await saveDone(ctx, a, next.value, i.title);
    return ok({ title: i.title, at: ctx.at });
  }
  return err(failure('BAD_CODE', 'That code is not for a session you are on'));
}

export async function respondSession(
  ctx: Ctx,
  assignmentId: string,
  sessionId: string,
  invitation: 'accepted' | 'tentative' | 'declined',
): Promise<Result<{ ok: true }>> {
  const got = await own(ctx, assignmentId);
  if (!got.ok) return got;
  const a = got.value.a;
  await ctx.tx.assignments.save({
    ...a,
    attendance: [
      ...a.attendance.filter((x) => x.sessionId !== sessionId),
      {
        sessionId,
        invitation,
        attended: a.attendance.find((x) => x.sessionId === sessionId)?.attended ?? null,
      },
    ],
  });
  await audit(ctx, {
    kind: 'assignment',
    action: 'Answered a session invitation',
    target: got.value.i.title,
    targetId: assignmentId,
    fields: ['invitation'],
  });
  return ok({ ok: true });
}

/** The trainer's tick, or a correction, with the reason audited (§15.5). */
export async function markAttendance(
  ctx: Ctx,
  assignmentId: string,
  sessionId: string,
  attended: boolean,
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const a = await ctx.tx.assignments.get(assignmentId);
  if (a === null) return err(notFound('assignment'));
  const i = await ctx.tx.items.get(a.itemId);
  if (i === null) return err(notFound('learning item'));
  const prior = a.attendance.find((x) => x.sessionId === sessionId);
  const next = complete(
    {
      ...a,
      attendance: [
        ...a.attendance.filter((x) => x.sessionId !== sessionId),
        {
          sessionId,
          invitation: prior?.invitation ?? 'accepted',
          attended: attended ? { how: 'hand', at: ctx.at, minutes: null } : null,
        },
      ],
    },
    i,
    ctx.at,
  );
  await saveDone(ctx, a, next, i.title);
  return ok({ ok: true });
}

/** Completions from a CSV (§15.7): email and item title per row; unmatched rows are listed, never guessed. */
export async function importCompletions(
  ctx: Ctx,
  csv: string,
): Promise<Result<{ matched: number; unmatched: string[] }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const members = await ctx.members();
  const items = await ctx.tx.items.find();
  const assignments = await ctx.tx.assignments.find();
  const unmatched: string[] = [];
  let matched = 0;
  for (const line of csv.split(/\r?\n/u).slice(1)) {
    const [email, title, date] = line.split(',').map((x) => x.trim());
    if (email === undefined || email === '' || title === undefined) continue;
    const m = members.find((x) => x.workEmail?.toLowerCase() === email.toLowerCase());
    const i = items.find((x) => x.title.toLowerCase() === title.toLowerCase());
    const a = assignments.find((x) => x.personId === m?.personId && x.itemId === i?.id);
    if (m === undefined || i === undefined || a === undefined) {
      unmatched.push(line);
      continue;
    }
    const at =
      date !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? `${date}T00:00:00.000Z` : ctx.at;
    await saveDone(ctx, a, { ...a, completedAt: at, done: i.parts.map((p) => p.id) }, i.title);
    matched += 1;
  }
  return ok({ matched, unmatched });
}
