import {
  PERFORMANCE_INBOX_KINDS,
  type InboxItem,
  type PerformanceInboxDetail,
} from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import { label } from '../domain/cycle.js';
import { confidence, progress } from '../domain/goals.js';
import { stateOf } from '../domain/learning.js';
import { isSubmitted } from '../domain/review.js';
import { adminOnly, audit, me, names, type Ctx } from './context.js';
import { countsOf } from './cycles.js';
import { stateFor } from './reviews.js';
import { people, search, subtitle } from './members.js';
import { EVIDENCE_SOURCES, settingsOf } from './settings.js';
import { ensureSeeded } from './templates.js';
import { t } from './reader-words.js';

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
  let stats: {
    label: string;
    value: string;
    detail: string;
    warning?: boolean;
    href: string;
  }[] = [];
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
        href: '/performance/cycles',
      },
      {
        label: 'Manager reviews',
        value: String(kind('manager').filter(isSubmitted).length),
        detail: `of ${String(kind('manager').length)}`,
        href: '/performance/cycles',
      },
      {
        label: 'Overdue',
        value: String(counts.overdue),
        detail: 'Across running cycles',
        warning: counts.overdue > 0,
        href: '/performance/cycles',
      },
      {
        label: 'Feedback this month',
        value: String(feedback),
        detail: 'Given at the company',
        href: '/performance/feedback',
      },
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
    area: t('inbox.home.performance', 'Performance'),
    from: null,
    due: null,
    dueVerb: 'due' as const,
    status: null,
    outcome: null,
    count: null,
    team: null,
    replies: 0,
    openIn: t('inbox.home.performance', 'Performance'),
    message: null,
    detail: null,
  };
  if (personId !== null) {
    for (const r of await ctx.tx.reviews.find({ ownerId: personId })) {
      const c = r.cycleId === null ? undefined : cycles.get(r.cycleId);
      // Theirs no more (§8.8): an update for a month, never a task.
      const former = r.formerManager ?? null;
      if (former !== null) {
        if (c?.state !== 'in_progress' || r.hidden || isSubmitted(r)) continue;
        if (Date.parse(ctx.at) - Date.parse(former.at) > 30 * 86_400_000) continue;
        items.push({
          ...base,
          id: `performance:manager-changed:${r.id}`,
          lane: 'update',
          kind: PERFORMANCE_INBOX_KINDS.managerChanged,
          icon: 'people',
          tone: 'neutral',
          title: t(
            'inbox.home.you_no_longer_write_s_manager',
            'You no longer write {{subjectId}}’s manager review',
            { subjectId: name(r.subjectId) },
          ),
          summary: `${c.name} · ${
            former.to === null
              ? t('inbox.home.they_no_longer_report_to_you', 'They no longer report to you')
              : t('inbox.home.they_report_to_now', 'They report to {{to}} now', {
                  to: name(former.to),
                })
          }${
            r.status === 'cancelled'
              ? t('inbox.home.nothing_to_submit', '; nothing to submit')
              : t(
                  'inbox.home.nothing_to_submit_draft_stays',
                  '; nothing to submit, your draft stays to read',
                )
          }`,
          at: former.at as InboxItem['at'],
          link: r.status === 'cancelled' ? '/performance/reviews' : `/performance/reviews/${r.id}`,
        });
        continue;
      }
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
            ? t('inbox.home.write_your_self_review', 'Write your self review')
            : `${cap(label(r.kind))}: ${name(r.subjectId)}`,
        summary: `${c.name}${r.status === 'in_progress' ? t('inbox.home.draft_saved', ' · draft saved') : ''}${r.handover === null ? '' : t('inbox.home.handed_to_you_from', ' · handed to you from {{from}}', { from: name(r.handover.from) })}`,
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
              ? t('inbox.home.pick_your_peer_reviewers', 'Pick your peer reviewers')
              : t('inbox.home.pick_peers_for', 'Pick peers for {{subjectId}}', {
                  subjectId: name(n.subjectId),
                }),
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
          title: t('inbox.home.approve_s_peers', 'Approve {{subjectId}}’s peers', {
            subjectId: name(n.subjectId),
          }),
          summary: `${String(n.nominees.length)} nominated · ${c.name}`,
          at: n.at as InboxItem['at'],
          dueVerb: 'decide',
          link: `/performance/nominations/${n.id}`,
          detail: {
            kind: 'nominations',
            nominationId: n.id,
            nominees: n.nominees.map((x) => ({ personId: x.personId, name: name(x.personId) })),
          } satisfies PerformanceInboxDetail,
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
          title: t('inbox.home.asked_for_feedback', '{{from}} asked for feedback', {
            from: name(q.from),
          }),
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
          title: t('inbox.home.your_review_was_released', 'Your review was released'),
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
        title: t('inbox.home.unlock_request_from', 'Unlock request from {{authorId}}', {
          authorId: name(r.authorId),
        }),
        summary: `${cap(label(r.kind))} · ${name(r.subjectId)}`,
        from: { name: name(r.authorId), personId: r.authorId },
        at: (r.unlock?.at ?? r.createdAt) as InboxItem['at'],
        dueVerb: 'decide',
        message: r.unlock?.reason ?? null,
        link: '/performance/unlocks',
        detail: { kind: 'unlock', reviewId: r.id } satisfies PerformanceInboxDetail,
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
      // On means linked and reading: a switch turned on before linking existed reads nothing.
      on: (grant?.sources[s]?.on ?? false) && (grant?.sources[s]?.account ?? null) !== null,
      at: grant?.sources[s]?.at ?? null,
      // Which tools can be linked here yet, and as whom each one is.
      available: ctx.deps.tools?.[s] !== undefined,
      account: grant?.sources[s]?.account ?? null,
      install: ctx.deps.tools?.[s]?.install ?? null,
    })),
    reads: (grant?.reads ?? []).toReversed().slice(0, 20),
  });
}

/**
 * One source, on or off, for this person alone (§22.3). On with no account
 * linked yet answers where to approve it; on with the tool's `code` and
 * `state` finishes linking it. Off stops reading at once, gives the token back
 * to the tool and drops what was recorded of its reads.
 */
export async function setGrant(
  ctx: Ctx,
  source: string,
  on: boolean,
  link: { readonly code?: string; readonly state?: string; readonly origin?: string } = {},
): Promise<Result<{ ok: true; link?: string; account?: string }>> {
  const who = me(ctx);
  if (!who.ok) return who;
  if (!(EVIDENCE_SOURCES as readonly string[]).includes(source))
    return err({ code: 'BAD_REQUEST', message: `No source ${source}` });
  const tool = ctx.deps.tools?.[source];
  if (on && tool === undefined)
    return err({ code: 'BAD_REQUEST', message: 'That tool cannot be linked yet' });
  if (on && (await settingsOf(ctx)).integrations.evidence[source] === false)
    return err({ code: 'FORBIDDEN', message: 'Your company has not offered that tool' });
  const grant = (await ctx.tx.grants.get(who.value)) ?? { id: who.value, sources: {}, reads: [] };
  const held = grant.sources[source];
  const tenantId = ctx.caller.tenantId;
  let account = held?.account ?? null;
  let secret = held?.secret ?? null;
  if (on && tool !== undefined && link.code !== undefined && link.state !== undefined) {
    const done = await tool.complete({
      tenantId,
      personId: who.value,
      code: link.code,
      state: link.state,
    });
    if (!done.ok) return done;
    ({ account, secret } = done.value);
  } else if (on && tool !== undefined && account === null) {
    // Not linked: approve it in the tool first; nothing is granted until then.
    if (link.origin === undefined)
      return err({ code: 'BAD_REQUEST', message: 'Where to come back to is missing' });
    const asked = await tool.authorize({ tenantId, personId: who.value, origin: link.origin });
    return asked.ok ? ok({ ok: true, link: asked.value.url }) : asked;
  } else if (!on && tool !== undefined && account !== null) {
    await tool.revoke({ tenantId, personId: who.value, secret });
    account = null;
    secret = null;
  }
  await ctx.tx.grants.save({
    ...grant,
    sources: { ...grant.sources, [source]: { on, at: ctx.at, account, secret } },
    reads: on ? grant.reads : grant.reads.filter((r) => r.source !== source),
  });
  await audit(ctx, {
    kind: 'tool',
    action: on ? 'Granted a connected tool' : 'Revoked a connected tool',
    target: source,
    fields: ['grant'],
  });
  return ok({ ok: true, ...(account === null ? {} : { account }) });
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
