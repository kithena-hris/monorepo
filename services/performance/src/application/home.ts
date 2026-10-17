import { PERFORMANCE_INBOX_KINDS, type InboxItem } from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { label } from '../domain/cycle.js';
import { confidence, progress } from '../domain/goals.js';
import { stateOf } from '../domain/learning.js';
import { isSubmitted } from '../domain/review.js';
import { adminOnly, audit, hrOnly, me, names, type Ctx } from './context.js';
import { countsOf } from './cycles.js';
import { stateFor } from './reviews.js';
import { people, search, subtitle } from './members.js';
import { EVIDENCE_SOURCES, settingsOf } from './settings.js';
import { ensureSeeded } from './templates.js';

/**
 * Performance's home (PF1, PF1b), the Inbox items it answers (§5.3, PRF-059),
 * who the viewer is to the shell, the people pickers search, a person's
 * connected-tool grants (S12), the audit log (S11) and settings (S1–S10).
 */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** For the shell's sidebar: which of Performance's places this viewer opens. */
export interface PerformanceViewer {
  readonly hr: boolean;
  readonly admin: boolean;
  readonly manager: boolean;
  readonly calibrator: boolean;
  readonly member: boolean;
}

export async function viewer(ctx: Ctx): Promise<PerformanceViewer> {
  const me_ = ctx.viewer.personId;
  const calibrator =
    me_ !== null &&
    (await ctx.tx.calibrations.find()).some(
      (s) => s.calibrators.includes(me_) && s.state !== 'finalised',
    );
  return {
    hr: ctx.viewer.hr,
    admin: ctx.viewer.admin,
    manager: ctx.viewer.reports.size > 0,
    calibrator: calibrator || ctx.viewer.hr,
    member: me_ !== null,
  };
}

export async function homeScreen(ctx: Ctx): Promise<Result<unknown>> {
  await ensureSeeded(ctx);
  const name = await names(ctx);
  const tasks = (await inbox(ctx)).filter((i) => i.lane === 'task').slice(0, 8);
  const personId = ctx.viewer.personId;
  const cycles = await ctx.tx.cycles.find();
  const running = [];
  for (const c of cycles.filter((x) =>
    ['in_progress', 'scheduled', 'launching', 'launch_failed', 'scheduling'].includes(x.state),
  )) {
    if (!ctx.viewer.hr) continue;
    const counts = countsOf(await ctx.tx.reviews.find({ cycleId: c.id }), ctx.today);
    running.push({
      id: c.id,
      name: c.name,
      state: c.state,
      who: `${String(c.snapshot?.subjects.length ?? 0)} people`,
      start: c.start.date,
      progress: counts.reviews === 0 ? 0 : Math.round((counts.submitted / counts.reviews) * 100),
      version: c.version,
    });
  }
  let stats: { label: string; value: string; detail: string; warning?: boolean }[] = [];
  if (ctx.viewer.hr) {
    const live = cycles.filter((c) => c.state === 'in_progress');
    const all = (await Promise.all(live.map((c) => ctx.tx.reviews.find({ cycleId: c.id }))))
      .flat()
      .filter((r) => !r.hidden && r.detached === null && r.status !== 'cancelled');
    const kind = (k: string) => all.filter((r) => r.kind === k);
    const counts = countsOf(all, ctx.today);
    const month = ctx.today.slice(0, 7);
    const feedback = (await ctx.tx.feedback.find()).filter(
      (f) => f.at.slice(0, 7) === month && !f.undone,
    ).length;
    stats = [
      {
        label: 'Self reviews submitted',
        value: String(kind('self').filter(isSubmitted).length),
        detail: `of ${String(kind('self').length)}`,
      },
      {
        label: 'Manager reviews',
        value: String(kind('manager').filter(isSubmitted).length),
        detail: `of ${String(kind('manager').length)}`,
      },
      {
        label: 'Overdue',
        value: String(counts.overdue),
        detail: 'Across running cycles',
        warning: counts.overdue > 0,
      },
      { label: 'Feedback this month', value: String(feedback), detail: 'Given at the company' },
    ];
  }
  const goals =
    personId === null
      ? []
      : (await ctx.tx.goals.find({ ownerId: personId }))
          .filter((g) => g.status === 'active')
          .slice(0, 4)
          .map((g) => ({
            id: g.id,
            title: g.title,
            progress: progress(g),
            confidence: confidence(g),
          }));
  const praise =
    personId === null
      ? []
      : (await ctx.tx.feedback.find({ subjectId: personId }))
          .filter((f) => f.kind === 'praise' && !f.undone)
          .toSorted((a, b) => b.at.localeCompare(a.at))
          .slice(0, 3)
          .map((f) => ({ id: f.id, from: name(f.from), text: f.body, at: f.at }));
  // PF1 v2, "Owed to you": who is writing about me in a running cycle, and when I see it.
  const live = new Map(cycles.filter((c) => c.state === 'in_progress').map((c) => [c.id, c]));
  const owed =
    personId === null
      ? []
      : (await ctx.tx.reviews.find({ subjectId: personId }))
          .filter(
            (r) =>
              r.cycleId !== null &&
              live.has(r.cycleId) &&
              r.kind !== 'self' &&
              !r.hidden &&
              r.status !== 'cancelled',
          )
          .map((r) => ({
            id: r.id,
            kind: r.kind,
            from: r.kind === 'peer' || r.kind === 'upward' ? null : name(r.authorId),
            state: stateFor(r, ctx.today),
            cycle: live.get(r.cycleId ?? '')?.name ?? '',
            released: r.released?.at ?? null,
          }));
  return ok({
    hr: ctx.viewer.hr,
    name: ctx.viewer.name,
    owed,
    stats,
    tasks,
    running,
    goals,
    praise,
    member: personId !== null,
  });
}

/** Everything Performance asks of this person, and what happened to them, as Inbox items. */
export async function inbox(ctx: Ctx): Promise<InboxItem[]> {
  const personId = ctx.viewer.personId;
  const name = await names(ctx);
  const items: InboxItem[] = [];
  const cycles = new Map((await ctx.tx.cycles.find()).map((c) => [c.id, c]));
  const base = {
    module: 'performance',
    area: 'Performance',
    from: null,
    due: null,
    dueVerb: 'due' as const,
    status: null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    openIn: 'Performance',
    message: null,
    detail: null,
  };
  if (personId !== null) {
    for (const r of await ctx.tx.reviews.find({ ownerId: personId })) {
      const c = r.cycleId === null ? undefined : cycles.get(r.cycleId);
      if (
        r.hidden ||
        r.detached !== null ||
        isSubmitted(r) ||
        r.declined !== null ||
        !['not_started', 'in_progress', 'unlocked'].includes(r.status) ||
        c?.state !== 'in_progress'
      )
        continue;
      items.push({
        ...base,
        id: `performance:review:${r.id}`,
        lane: 'task',
        kind: PERFORMANCE_INBOX_KINDS.review,
        icon: 'edit',
        tone: r.due < ctx.today ? 'danger' : 'accent',
        title:
          r.kind === 'self'
            ? 'Write your self review'
            : `${cap(label(r.kind))}: ${name(r.subjectId)}`,
        summary: `${c.name}${r.status === 'in_progress' ? ' · draft saved' : ''}`,
        at: r.createdAt as InboxItem['at'],
        due: r.due,
        link: `/performance/reviews/${r.id}`,
      });
    }
    for (const n of await ctx.tx.nominations.find()) {
      const c = cycles.get(n.cycleId);
      if (c === undefined || !['scheduled', 'in_progress'].includes(c.state)) continue;
      if (n.state === 'draft' && n.by === personId)
        items.push({
          ...base,
          id: `performance:nominate:${n.id}`,
          lane: 'task',
          kind: PERFORMANCE_INBOX_KINDS.nominate,
          icon: 'people',
          tone: 'accent',
          title:
            n.subjectId === personId
              ? 'Pick your peer reviewers'
              : `Pick peers for ${name(n.subjectId)}`,
          summary: c.name,
          at: n.at as InboxItem['at'],
          due: c.snapshot?.due.nominations ?? null,
          link: `/performance/nominations/${n.id}`,
        });
      if (n.state === 'waiting' && n.approverId === personId)
        items.push({
          ...base,
          id: `performance:approve:${n.id}`,
          lane: 'task',
          kind: PERFORMANCE_INBOX_KINDS.approveNominations,
          icon: 'people',
          tone: 'warning',
          title: `Approve ${name(n.subjectId)}’s peers`,
          summary: `${String(n.nominees.length)} nominated · ${c.name}`,
          at: n.at as InboxItem['at'],
          dueVerb: 'decide',
          link: `/performance/nominations/${n.id}`,
        });
    }
    for (const q of await ctx.tx.requests.find())
      if (q.to.includes(personId) && !q.answered.some((a) => a.personId === personId))
        items.push({
          ...base,
          id: `performance:feedback-request:${q.id}`,
          lane: 'task',
          kind: PERFORMANCE_INBOX_KINDS.feedbackRequest,
          icon: 'message',
          tone: null,
          title: `${name(q.from)} asked for feedback`,
          summary: q.topic ?? q.question,
          from: { name: name(q.from), personId: q.from },
          at: q.at as InboxItem['at'],
          due: q.due,
          message: q.question,
          link: `/performance/feedback/requests`,
        });
    for (const a of await ctx.tx.assignments.find({ ownerId: personId })) {
      const i = await ctx.tx.items.get(a.itemId);
      if (i === null || a.completedAt !== null) continue;
      items.push({
        ...base,
        id: `performance:learning:${a.id}`,
        lane: 'task',
        kind: PERFORMANCE_INBOX_KINDS.learning,
        icon: 'review',
        tone: a.due !== null && a.due < ctx.today ? 'danger' : 'warning',
        title: i.title,
        summary: `${a.why} · ${stateOf(a, i).replace('_', ' ')}`,
        at: a.at as InboxItem['at'],
        due: a.due,
        link: `/performance/learning/items/${i.id}`,
      });
    }
    for (const r of await ctx.tx.reviews.find({ subjectId: personId }))
      if (r.kind === 'manager' && r.released !== null)
        items.push({
          ...base,
          id: `performance:released:${r.id}`,
          lane: r.acknowledged === null ? 'update' : 'done',
          kind: PERFORMANCE_INBOX_KINDS.released,
          icon: 'document',
          tone: 'accent',
          title: 'Your review was released',
          summary: cycles.get(r.cycleId ?? '')?.name ?? null,
          at: r.released.at as InboxItem['at'],
          link: `/performance/released/${r.id}`,
        });
  }
  if (ctx.viewer.hr)
    for (const r of await ctx.tx.reviews.find({ state: 'unlock_requested' }))
      items.push({
        ...base,
        id: `performance:unlock:${r.id}`,
        lane: 'task',
        kind: PERFORMANCE_INBOX_KINDS.unlock,
        icon: 'locked',
        tone: 'warning',
        title: `Unlock request from ${name(r.authorId)}`,
        summary: `${cap(label(r.kind))} · ${name(r.subjectId)}`,
        from: { name: name(r.authorId), personId: r.authorId },
        at: (r.unlock?.at ?? r.createdAt) as InboxItem['at'],
        dueVerb: 'decide',
        message: r.unlock?.reason ?? null,
        link: '/performance/unlocks',
      });
  return items.toSorted((a, b) => b.at.localeCompare(a.at));
}

export async function directory(
  ctx: Ctx,
  q: string,
): Promise<{
  rows: { personId: string; name: string; title: string; managerId: string | null }[];
}> {
  const all = await people(ctx);
  return {
    rows: search(all, q, 30).map((p) => ({
      personId: p.personId,
      name: p.name,
      title: subtitle(p),
      managerId: p.managerId,
    })),
  };
}

/* ------------------------------------------------- connected tools, S12 -- */

export async function connectedTools(ctx: Ctx): Promise<Result<unknown>> {
  const who = me(ctx);
  if (!who.ok) return who;
  const grant = await ctx.tx.grants.get(who.value);
  const offered = (await settingsOf(ctx)).integrations.evidence;
  return ok({
    sources: EVIDENCE_SOURCES.filter((s) => offered[s] !== false).map((s) => ({
      source: s,
      on: grant?.sources[s]?.on ?? false,
      at: grant?.sources[s]?.at ?? null,
    })),
    reads: (grant?.reads ?? []).toReversed().slice(0, 20),
  });
}

/** One source, on or off, for this person alone (§22.3). Off stops reading at once and drops what was cached. */
export async function setGrant(
  ctx: Ctx,
  source: string,
  on: boolean,
): Promise<Result<{ ok: true }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(source))
    return err({ code: 'BAD_REQUEST', message: `No source ${source}` });
  const grant = (await ctx.tx.grants.get(who.value)) ?? { id: who.value, sources: {}, reads: [] };
  await ctx.tx.grants.save({
    ...grant,
    sources: { ...grant.sources, [source]: { on, at: ctx.at } },
    reads: on ? grant.reads : grant.reads.filter((r) => r.source !== source),
  });
  await audit(ctx, {
    action: on ? 'Granted a connected tool' : 'Revoked a connected tool',
    target: source,
    fields: ['grant'],
  });
  return ok({ ok: true });
}

/* ------------------------------------------------------- audit, S11 -- */

export async function auditScreen(
  ctx: Ctx,
  filter: { q?: string; refused?: boolean; ai?: boolean },
): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const rows = await ctx.tx.audit.list({
    ...(filter.q === undefined ? {} : { q: filter.q }),
    ...(filter.refused === true ? { refused: true } : {}),
    ...(filter.ai === true ? { ai: true } : {}),
    limit: 300,
  });
  return ok({ rows });
}

/* ---------------------------------------------------- settings, S1–S10 -- */

export async function settingsScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = adminOnly(ctx);
  const settings = await settingsOf(ctx);
  const members = await people(ctx);
  const templates = (await ctx.tx.templates.find())
    .filter((t) => !t.archived)
    .map((t) => ({ id: t.id, name: t.name, purpose: t.purpose }));
  return ok({
    settings,
    admin: may.ok,
    hr: ctx.viewer.hr,
    model: ctx.deps.model !== undefined,
    templates,
    hrPeople: settings.roles.hr.map((id) => ({
      personId: id,
      name: members.find((m) => m.personId === id)?.name ?? 'Someone',
    })),
    legalEntities: [
      ...new Set(members.map((m) => m.legalEntityId).filter((x): x is string => x !== null)),
    ],
  });
}
