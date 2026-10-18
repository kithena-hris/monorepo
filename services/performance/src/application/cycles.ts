import * as z from 'zod';
import type { ActivityKind, CalendarDate, CycleState } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

import {
  addDays,
  blocked,
  checks,
  draftCycle,
  dueDates,
  editable,
  KINDS,
  label,
  matches,
  move,
  REVIEW_KINDS,
  startAction,
  subjectsOf,
  type Condition,
  type Cycle,
  type Filterable,
  type Issue,
} from '../domain/cycle.js';
import {
  closeStatus,
  detach,
  isSubmitted,
  newReview,
  reattach,
  reviewKey,
  type Review,
} from '../domain/review.js';
import { published, type Template } from '../domain/template.js';
import { audit, event, hrOnly, names, notFound, publish, type Ctx } from './context.js';
import type { LiveChange } from './ports.js';
import { people, subtitle, team, type Person } from './members.js';
import { settingsOf } from './settings.js';
import { ensureSeeded, publishedTemplates } from './templates.js';

/**
 * Cycles (PRD §8, §19, PRF-041): the list, setup in six steps, the checks
 * before launch, the overview with its live tiles and table, and every change
 * after launch. Creating the reviews is the launch engine's (`launch.ts`).
 */

/* ------------------------------------------------------------- reading -- */

export interface Counts {
  readonly reviews: number;
  readonly submitted: number;
  readonly overdue: number;
  readonly byKind: Readonly<
    Record<string, { total: number; submitted: number; started: number; overdue: number }>
  >;
}

export function countsOf(reviews: readonly Review[], today: CalendarDate): Counts {
  const live = reviews.filter(
    (r) => r.detached === null && !r.hidden && !['cancelled'].includes(r.status),
  );
  const byKind: Record<
    string,
    { total: number; submitted: number; started: number; overdue: number }
  > = {};
  const late = (r: Review): boolean =>
    !isSubmitted(r) && r.due < today && !['abandoned', 'withdrawn'].includes(r.status);
  for (const r of live) {
    const k = (byKind[r.kind] ??= { total: 0, submitted: 0, started: 0, overdue: 0 });
    k.total += 1;
    if (isSubmitted(r)) k.submitted += 1;
    else if (r.status === 'in_progress') k.started += 1;
    if (late(r)) k.overdue += 1;
  }
  return {
    reviews: live.length,
    submitted: live.filter(isSubmitted).length,
    overdue: live.filter(late).length,
    byKind,
  };
}

/** The live stream's message for one cycle (§8.7). */
export async function liveOf(ctx: Ctx, cycleId: string): Promise<LiveChange | null> {
  const c = await ctx.tx.cycles.get(cycleId);
  if (c === null) return null;
  const counts = countsOf(await ctx.tx.reviews.find({ cycleId }), ctx.today);
  return {
    cycleId,
    state: c.state,
    version: c.version,
    counts: {
      reviews: counts.reviews,
      submitted: counts.submitted,
      overdue: counts.overdue,
      created: c.launch.created,
      total: c.launch.total,
    },
  };
}

const datesOf = (c: Cycle): string => {
  if (c.state === 'scheduled') return `Launches ${c.start.date}, ${c.start.time} ${c.start.zone}`;
  if (c.state === 'launch_failed') return `Failed ${c.launch.at?.slice(0, 10) ?? ''}`;
  const due = dueDates(c);
  const last = Object.values(due).toSorted().at(-1) ?? c.start.date;
  return `${c.start.date} – ${last}`;
};

const whoOf = (c: Cycle, count: number): string => {
  const dept = c.participants.filter.filter((f) => f.field === 'department').map((f) => f.value);
  return `${dept.length > 0 ? dept.join(', ') : c.automationId === null ? 'Everyone' : 'Automated'} · ${String(count)}`;
};

export async function cyclesScreen(
  ctx: Ctx,
  filter: { q?: string | undefined; state?: string | undefined },
): Promise<{ readonly rows: readonly unknown[]; readonly hr: boolean }> {
  const all = await ctx.tx.cycles.find();
  const q = (filter.q ?? '').toLowerCase();
  const members = await people(ctx);
  const rows = [];
  for (const c of all.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (filter.state === 'archived' ? c.state !== 'archived' : c.state === 'archived') continue;
    if (
      filter.state !== undefined &&
      filter.state !== '' &&
      filter.state !== 'archived' &&
      !stateGroup(c.state, filter.state)
    )
      continue;
    if (q !== '' && !c.name.toLowerCase().includes(q)) continue;
    if (!ctx.viewer.hr && !(await involved(ctx, c))) continue;
    const reviews = await ctx.tx.reviews.find({ cycleId: c.id });
    const counts = countsOf(reviews, ctx.today);
    const subjects = c.snapshot?.subjects.length ?? subjectsOf(c, members.map(filterable)).length;
    rows.push({
      id: c.id,
      name: c.name,
      owner: c.automationId === null ? c.ownerName : 'Automation',
      state: c.state,
      who: whoOf(c, subjects),
      kinds: KINDS.filter((k) => c.activities[k].on),
      dates: datesOf(c),
      progress: counts.reviews === 0 ? 0 : Math.round((counts.submitted / counts.reviews) * 100),
      version: c.version,
    });
  }
  return { rows, hr: ctx.viewer.hr };
}

const stateGroup = (state: CycleState, wanted: string): boolean =>
  wanted === 'in_progress'
    ? ['launching', 'in_progress', 'closing', 'launch_failed'].includes(state)
    : wanted === 'scheduled'
      ? ['scheduling', 'scheduled'].includes(state)
      : state === wanted;

/** Whether the viewer has anything to do with a cycle: a review of theirs, or one about their reports. */
export async function involved(ctx: Ctx, c: Cycle): Promise<boolean> {
  const me = ctx.viewer.personId;
  if (me === null) return false;
  const reviews = await ctx.tx.reviews.find({ cycleId: c.id });
  return reviews.some(
    (r) => r.authorId === me || r.subjectId === me || ctx.viewer.org.has(r.subjectId),
  );
}

export const filterable = (p: Person): Filterable => ({
  personId: p.personId,
  status: p.status,
  department: p.department,
  managerPersonId: p.managerId,
  title: p.title,
  hiredOn: p.hiredOn,
  legalEntityId: p.legalEntityId,
  locationId: p.locationId,
});

/** Templates as the checks read them. */
async function templateFacts(
  ctx: Ctx,
): Promise<Record<string, { name: string; published: number | null }>> {
  return Object.fromEntries(
    (await ctx.tx.templates.find()).map((t: Template) => [
      t.id,
      { name: t.name, published: published(t)?.version ?? null },
    ]),
  );
}

export async function checksOf(ctx: Ctx, c: Cycle): Promise<Issue[]> {
  const members = await people(ctx);
  const ids = new Set(subjectsOf(c, members.map(filterable)));
  const subjects = members
    .filter((p) => ids.has(p.personId))
    .map((p) => ({ personId: p.personId, name: p.name, managerId: p.managerId }));
  const running = (await ctx.tx.cycles.find()).filter(
    (x) => x.id !== c.id && ['scheduled', 'in_progress'].includes(x.state) && x.activities.self.on,
  );
  const overlapping = new Set<string>();
  for (const x of running)
    for (const s of x.snapshot?.subjects ?? []) if (ids.has(s)) overlapping.add(s);
  return checks({
    cycle: c,
    today: ctx.today,
    subjects,
    templates: await templateFacts(ctx),
    overlapping: c.activities.self.on ? [...overlapping] : [],
  });
}

const distinct = (xs: readonly (string | null)[]): string[] =>
  [...new Set(xs.filter((x): x is string => x !== null))].toSorted();

/** The setup dialog's data (PF4): the draft, its options, who is in, and the checks. */
export async function setupScreen(ctx: Ctx, id: string, q?: string): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const members = await people(ctx);
  const ids = new Set(subjectsOf(c, members.map(filterable)));
  const byId = new Map(members.map((m) => [m.personId, m]));
  const included = new Set(c.participants.include.map((p) => p.personId));
  const excluded = new Map(c.participants.exclude.map((p) => [p.personId, p.reason]));
  const needle = (q ?? '').toLowerCase();
  const rows = members
    .filter((m) => ids.has(m.personId) || excluded.has(m.personId))
    .filter((m) => needle === '' || m.name.toLowerCase().includes(needle))
    // Everyone, not a first hundred: the screen draws only the rows in view.
    .map((m) => ({
      personId: m.personId,
      name: m.name,
      title: subtitle(m),
      manager:
        m.managerId === null
          ? null
          : { id: m.managerId, name: byId.get(m.managerId)?.name ?? 'Someone' },
      note: excluded.has(m.personId)
        ? `Excluded${excluded.get(m.personId) ? ` · ${excluded.get(m.personId) ?? ''}` : ''}`
        : included.has(m.personId)
          ? 'Included by hand'
          : null,
    }));
  const departments = [
    ...new Set(members.map((m) => m.department).filter((d): d is string => d !== null)),
  ].toSorted();
  const action = startAction(c, ctx.today);
  return ok({
    cycle: c,
    templates: await publishedTemplates(ctx),
    participants: {
      count: ids.size,
      fromFilter: [...ids].filter((p) => !included.has(p)).length,
      included: included.size,
      excluded: excluded.size,
      rows,
      // Who can be added by name: the picker filters these as it is typed in.
      everyone: members
        .filter((m) => m.status !== 'terminated')
        .map((m) => ({ personId: m.personId, name: m.name, title: subtitle(m) })),
      noLongerMatches: c.noLongerMatches.map((p) => ({
        personId: p,
        name: byId.get(p)?.name ?? 'Someone',
        title: subtitle(byId.get(p)),
      })),
    },
    // What the filter builder offers, as the members hold it: names where
    // Performance knows them, ids the shell names from People (locations, entities).
    fields: {
      departments,
      statuses: ['active', 'on_leave', 'notice', 'pre_hire'],
      locations: distinct(members.map((m) => m.locationId)),
      legalEntities: distinct(members.map((m) => m.legalEntityId)),
      managers: distinct(members.map((m) => m.managerId)).map((id) => ({
        value: id,
        label: byId.get(id)?.name ?? 'Someone who left',
      })),
    },
    due: dueDates(c),
    checks: await checksOf(ctx, c),
    action: action.ok ? action.value : 'past',
    cycles: (await ctx.tx.cycles.find())
      .filter((x) => x.id !== id)
      .map((x) => ({ id: x.id, name: x.name })),
  });
}

/* ------------------------------------------------------------- writing -- */

export async function createCycle(
  ctx: Ctx,
  input: { name: string; start: CalendarDate | null; copyFrom: string | null },
): Promise<Result<{ id: string; start: Cycle['start'] }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  await ensureSeeded(ctx);
  const settings = await settingsOf(ctx);
  const templates = settings.reviews.templates as Partial<Record<ActivityKind, string>>;
  const id = ctx.deps.newId();
  let c = draftCycle({
    id,
    name: input.name,
    owner: ctx.viewer.personId ?? ctx.viewer.accountId,
    ownerName: ctx.viewer.name,
    start: input.start ?? addDays(ctx.today, 30),
    zone: settings.general.zone,
    at: ctx.at,
    templates,
  });
  if (input.copyFrom !== null) {
    const from = await ctx.tx.cycles.get(input.copyFrom);
    if (from === null) return err(notFound('cycle to copy'));
    c = {
      ...c,
      description: from.description,
      goals: from.goals,
      participants: from.participants,
      activities: from.activities,
      peer: from.peer,
      nominations: from.nominations,
      visibility: from.visibility,
      reminders: from.reminders,
    };
  }
  c = {
    ...c,
    visibility: {
      ...c.visibility,
      minimum: settings.reviews.minimum,
      release: { mode: settings.reviews.release, date: null },
    },
  };
  await ctx.tx.cycles.save(c);
  await publish(
    ctx,
    event(
      ctx,
      'performance.cycle.state_changed',
      { type: 'cycle', id },
      { cycleId: id, from: null, to: 'draft', reviews: 0 },
    ),
  );
  await audit(ctx, {
    kind: 'cycle',
    action: input.copyFrom === null ? 'Created a cycle' : 'Copied a cycle',
    target: input.name,
    targetId: id,
  });
  ctx.touched.add(id);
  // The start as the company's defaults made it, for a dialog already open.
  return ok({ id, start: c.start });
}

/** A setup step saved (§8.1): any step, any order, while the cycle can still change. */
export async function saveCycle(
  ctx: Ctx,
  id: string,
  patch: Partial<Cycle>,
): Promise<Result<{ version: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  if (!editable(c) && Object.keys(patch).some((k) => k !== 'name' && k !== 'description'))
    return err(
      failure('LAUNCHED', 'A launched cycle keeps its setup; use the changes after launch'),
    );
  const allowed = [
    'name',
    'description',
    'start',
    'period',
    'goals',
    'participants',
    'activities',
    'peer',
    'nominations',
    'visibility',
    'reminders',
  ] as const;
  const next: Cycle = { ...c, version: c.version + 1 };
  const changed: string[] = [];
  for (const k of allowed)
    if (patch[k] !== undefined) {
      (next as unknown as Record<string, unknown>)[k] = patch[k];
      changed.push(k);
    }
  await ctx.tx.cycles.save(next);
  await audit(ctx, {
    kind: 'cycle',
    action: 'Edited a cycle',
    target: c.name,
    targetId: id,
    fields: changed,
  });
  ctx.touched.add(id);
  return ok({ version: next.version });
}

/**
 * The one button (§8.1, §8.7): checks first, then schedule for a later start
 * or launch for today. A launch returns at once; the engine creates the
 * reviews in batches once this transaction commits.
 */
export async function scheduleOrLaunch(
  ctx: Ctx,
  id: string,
): Promise<Result<{ state: CycleState }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  if (c.state !== 'draft' && c.state !== 'scheduled')
    return err(failure('BAD_STATE', 'Only a draft or scheduled cycle starts'));
  const issues = await checksOf(ctx, c);
  if (blocked(issues))
    return err(
      failure(
        'BLOCKED',
        issues.find((i) => i.level === 'block')?.title ?? 'Something blocks this cycle',
      ),
    );
  const action = startAction(c, ctx.today);
  if (!action.ok) return action;
  if (action.value === 'schedule') {
    if (c.state === 'scheduled') return ok({ state: 'scheduled' });
    const scheduling = move(c, 'scheduling');
    if (!scheduling.ok) return scheduling;
    const scheduled = move(scheduling.value, 'scheduled');
    if (!scheduled.ok) return scheduled;
    await ctx.tx.cycles.save(scheduled.value);
    await openNominations(ctx, scheduled.value);
    await stateEvent(ctx, c, 'scheduled');
    await audit(ctx, { kind: 'cycle', action: 'Scheduled a cycle', target: c.name, targetId: id });
    ctx.touched.add(id);
    return ok({ state: 'scheduled' });
  }
  return beginLaunch(ctx, c);
}

/** Into `launching`, with the snapshot (§8.7): who, on which versions, due when. */
export async function beginLaunch(ctx: Ctx, c: Cycle): Promise<Result<{ state: CycleState }>> {
  const launching = move(c, 'launching');
  if (!launching.ok) return launching;
  const members = await people(ctx);
  const subjects = subjectsOf(c, members.map(filterable));
  const templates = new Map((await ctx.tx.templates.find()).map((t) => [t.id, t]));
  const pinned: Partial<Record<ActivityKind, { templateId: string; version: number }>> = {};
  for (const k of REVIEW_KINDS) {
    const a = c.activities[k];
    if (!a.on || a.templateId === null) continue;
    const t = templates.get(a.templateId);
    const v = a.pinnedVersion ?? (t === undefined ? undefined : published(t)?.version);
    if (t === undefined || v === undefined)
      return err(failure('NO_FORM', `The ${label(k)} has no published form`));
    pinned[k] = { templateId: t.id, version: v };
    if (!t.everUsed) await ctx.tx.templates.save({ ...t, everUsed: true });
  }
  const next: Cycle = {
    ...launching.value,
    snapshot: { subjects, pinned, due: dueDates(c) },
    launch: { total: expected(c, subjects, members), created: 0, done: 0, error: null, at: ctx.at },
  };
  await ctx.tx.cycles.save(next);
  await openNominations(ctx, next);
  await stateEvent(ctx, c, 'launching');
  await audit(ctx, { kind: 'cycle', action: 'Launched a cycle', target: c.name, targetId: c.id });
  ctx.touched.add(c.id);
  return ok({ state: 'launching' });
}

/** How many reviews a launch will create, for "Creating reviews · 24 of 38". */
function expected(c: Cycle, subjects: readonly string[], members: readonly Person[]): number {
  let n = 0;
  const byId = new Map(members.map((m) => [m.personId, m]));
  for (const s of subjects) {
    const p = byId.get(s);
    if (c.activities.self.on) n += 1;
    if (c.activities.manager.on && p?.managerId) n += 1;
    if (c.activities.skip.on && p?.managerId && byId.get(p.managerId)?.managerId) n += 1;
    if (c.activities.peer.on && c.peer.all) n += Math.min(c.peer.max, team(members, s).length);
    if (c.activities.upward.on) {
      const reports = members.filter((m) => m.managerId === s && m.status !== 'terminated').length;
      if (reports >= c.visibility.minimum) n += reports;
    }
  }
  return n;
}

/** Nominations open at schedule or launch (§9.3): one per subject, for whoever nominates. */
async function openNominations(ctx: Ctx, c: Cycle): Promise<void> {
  if (!c.activities.peer.on || c.peer.all) return;
  const members = await people(ctx);
  const byId = new Map(members.map((m) => [m.personId, m]));
  const existing = new Set(
    (await ctx.tx.nominations.find({ cycleId: c.id })).map((n) => n.subjectId),
  );
  for (const s of c.snapshot?.subjects ?? subjectsOf(c, members.map(filterable))) {
    if (existing.has(s)) continue;
    const manager = byId.get(s)?.managerId ?? null;
    await ctx.tx.nominations.save({
      id: ctx.deps.newId(),
      cycleId: c.id,
      subjectId: s,
      kind: 'peer',
      by: c.peer.picker === 'subject' ? s : c.peer.picker === 'manager' ? (manager ?? s) : 'hr',
      approverId: c.peer.approval ? manager : null,
      nominees: [],
      state: 'draft',
      note: null,
      at: ctx.at,
    });
  }
}

async function stateEvent(ctx: Ctx, c: Cycle, to: CycleState): Promise<void> {
  const reviews = (await ctx.tx.reviews.find({ cycleId: c.id })).length;
  await publish(
    ctx,
    event(
      ctx,
      'performance.cycle.state_changed',
      { type: 'cycle', id: c.id },
      { cycleId: c.id, from: c.state, to, reviews },
    ),
  );
}

export async function unschedule(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const back = move(c, 'draft');
  if (!back.ok) return back;
  await ctx.tx.cycles.save(back.value);
  await stateEvent(ctx, c, 'draft');
  await audit(ctx, {
    kind: 'cycle',
    action:
      c.state === 'launch_failed' ? 'Moved a failed launch back to draft' : 'Unscheduled a cycle',
    target: c.name,
    targetId: id,
  });
  ctx.touched.add(id);
  if (c.state === 'launch_failed')
    for (const r of await ctx.tx.reviews.find({ cycleId: id }))
      if (r.hidden) await ctx.tx.reviews.remove(r.id);
  return ok({ ok: true });
}

export async function retryLaunch(ctx: Ctx, id: string): Promise<Result<{ state: CycleState }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const again = move(c, 'launching');
  if (!again.ok) return again;
  await ctx.tx.cycles.save({ ...again.value, launch: { ...c.launch, error: null } });
  await audit(ctx, { kind: 'cycle', action: 'Retried a launch', target: c.name, targetId: id });
  ctx.touched.add(id);
  return ok({ state: 'launching' });
}

/** §8.9, §10.5: every review mapped; unreleased ones released now when asked. */
export async function closeCycle(
  ctx: Ctx,
  id: string,
  releaseNow: boolean,
): Promise<Result<{ mapped: Record<string, number> }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const closing = move(c, 'closing');
  if (!closing.ok) return closing;
  const mapped: Record<string, number> = {};
  for (const r of await ctx.tx.reviews.find({ cycleId: id })) {
    if (r.detached !== null || r.status === 'cancelled') continue;
    const to = closeStatus(r);
    mapped[to] = (mapped[to] ?? 0) + 1;
    const released =
      releaseNow && to === 'completed' && r.released === null && r.kind !== 'self'
        ? { at: ctx.at, by: ctx.viewer.name }
        : r.released;
    await ctx.tx.reviews.save({
      ...r,
      status: to,
      unlock:
        r.status === 'unlock_requested' && r.unlock !== null
          ? {
              ...r.unlock,
              decided: { approved: false, by: 'Kithena', at: ctx.at, note: 'Cycle closed' },
            }
          : r.unlock,
      released,
    });
    if (to !== r.status)
      await publish(
        ctx,
        event(
          ctx,
          'performance.review.status_changed',
          { type: 'review', id: r.id },
          { reviewId: r.id, cycleId: id, kind: r.kind, subjectId: r.subjectId, from: r.status, to },
        ),
      );
  }
  const closed = move(closing.value, 'closed');
  if (!closed.ok) return closed;
  await ctx.tx.cycles.save({ ...closed.value, closedAt: ctx.at });
  await stateEvent(ctx, c, 'closed');
  await audit(ctx, {
    kind: 'cycle',
    action: 'Closed a cycle',
    target: c.name,
    targetId: id,
    fields: releaseNow ? ['released'] : [],
  });
  ctx.touched.add(id);
  return ok({ mapped });
}

export async function archiveCycle(
  ctx: Ctx,
  id: string,
  archived: boolean,
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const next = move(c, archived ? 'archived' : 'closed');
  if (!next.ok) return next;
  await ctx.tx.cycles.save(next.value);
  await stateEvent(ctx, c, next.value.state);
  await audit(ctx, {
    kind: 'cycle',
    action: archived ? 'Archived a cycle' : 'Unarchived a cycle',
    target: c.name,
    targetId: id,
  });
  ctx.touched.add(id);
  return ok({ ok: true });
}

/* ------------------------------------------------------ after launch -- */

/** The reviews one subject gets in a cycle (§8.7, §8.8): the launch's and a late joiner's. */
export async function reviewsFor(
  ctx: Ctx,
  c: Cycle,
  subjectId: string,
  opts: { readonly hidden: boolean; readonly dueFloor?: CalendarDate },
): Promise<number> {
  const members = await people(ctx);
  const byId = new Map(members.map((m) => [m.personId, m]));
  const subject = byId.get(subjectId);
  if (subject === undefined || c.snapshot === null) return 0;
  const goals = c.goals === 'scored' ? await goalsFor(ctx, c, subjectId) : [];
  const authors: { kind: ActivityKind; author: string }[] = [];
  if (c.activities.self.on) authors.push({ kind: 'self', author: subjectId });
  if (c.activities.manager.on && subject.managerId !== null)
    authors.push({ kind: 'manager', author: subject.managerId });
  const skip = subject.managerId === null ? null : (byId.get(subject.managerId)?.managerId ?? null);
  if (c.activities.skip.on && skip !== null) authors.push({ kind: 'skip', author: skip });
  if (c.activities.peer.on && c.peer.all)
    for (const p of team(members, subjectId)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .slice(0, c.peer.max))
      authors.push({ kind: 'peer', author: p.personId });
  if (c.activities.peer.on && !c.peer.all) {
    const n = (await ctx.tx.nominations.find({ cycleId: c.id, subjectId })).find(
      (x) => x.state === 'approved',
    );
    for (const x of n?.nominees ?? [])
      if (x.state === 'approved') authors.push({ kind: 'peer', author: x.personId });
  }
  if (c.activities.upward.on) {
    const reports = members.filter((m) => m.managerId === subjectId && m.status !== 'terminated');
    if (reports.length >= c.visibility.minimum)
      for (const r of reports) authors.push({ kind: 'upward', author: r.personId });
  }
  let made = 0;
  for (const { kind, author } of authors) {
    const pin = c.snapshot.pinned[kind];
    if (pin === undefined) continue;
    const key = reviewKey(c.id, kind, subjectId, author);
    const existing = await ctx.tx.reviews.find({ key });
    if (existing.length > 0) {
      const back = existing[0];
      if (back !== undefined && (back.detached !== null || back.status === 'cancelled'))
        await ctx.tx.reviews.save(reattach(back));
      continue;
    }
    const due0 = c.snapshot.due[kind] ?? addDays(c.start.date, 14);
    const due = opts.dueFloor !== undefined && due0 < opts.dueFloor ? opts.dueFloor : due0;
    await ctx.tx.reviews.save(
      newReview({
        id: ctx.deps.newId(),
        cycleId: c.id,
        kind,
        subjectId,
        authorId: author,
        templateId: pin.templateId,
        version: pin.version,
        due,
        confidential:
          (kind === 'peer' && c.visibility.peerNames !== 'shown') ||
          (kind === 'upward' && c.visibility.upwardNames !== 'shown'),
        hidden: opts.hidden,
        goals: kind === 'manager' || kind === 'self' ? goals : [],
        at: ctx.at,
      }),
    );
    made += 1;
  }
  return made;
}

/** Option 1 (§14.6): every goal of the subject's in periods that overlap the review period. */
async function goalsFor(ctx: Ctx, c: Cycle, subjectId: string): Promise<string[]> {
  const periods = (await settingsOf(ctx)).goals.periods
    .filter((p) => p.from <= c.period.to && p.to >= c.period.from)
    .map((p) => p.id);
  return (await ctx.tx.goals.find({ ownerId: subjectId }))
    .filter((g) => periods.includes(g.periodId) && g.status !== 'cancelled' && g.status !== 'draft')
    .map((g) => g.id);
}

export async function addParticipant(
  ctx: Ctx,
  id: string,
  personId: string,
  reason: string | null,
): Promise<Result<{ created: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const participants = {
    ...c.participants,
    include: [
      ...c.participants.include.filter((p) => p.personId !== personId),
      { personId, reason, by: ctx.viewer.name, at: ctx.at },
    ],
    exclude: c.participants.exclude.filter((p) => p.personId !== personId),
  };
  let next: Cycle = { ...c, participants, version: c.version + 1 };
  let created = 0;
  if (c.state === 'in_progress' && c.snapshot !== null) {
    next = {
      ...next,
      snapshot: { ...c.snapshot, subjects: [...new Set([...c.snapshot.subjects, personId])] },
    };
    await ctx.tx.cycles.save(next);
    // Fewer than 7 days left: due 7 days from today (§8.8).
    created = await reviewsFor(ctx, next, personId, {
      hidden: false,
      dueFloor: addDays(ctx.today, 7),
    });
  } else await ctx.tx.cycles.save(next);
  await audit(ctx, {
    kind: 'cycle',
    action: 'Added someone to a cycle',
    target: c.name,
    targetId: id,
    fields: ['participants'],
  });
  ctx.touched.add(id);
  return ok({ created });
}

export async function removeParticipant(
  ctx: Ctx,
  id: string,
  personId: string,
  reason: string | null,
): Promise<Result<{ detached: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  let detached = 0;
  for (const r of await ctx.tx.reviews.find({ cycleId: id, subjectId: personId })) {
    const d = detach(r, ctx.at);
    if (d.detached !== null && r.detached === null) detached += 1;
    await ctx.tx.reviews.save(d);
  }
  await ctx.tx.cycles.save({
    ...c,
    version: c.version + 1,
    participants: {
      ...c.participants,
      include: c.participants.include.filter((p) => p.personId !== personId),
      exclude: [
        ...c.participants.exclude.filter((p) => p.personId !== personId),
        { personId, reason, by: ctx.viewer.name, at: ctx.at },
      ],
    },
    noLongerMatches: c.noLongerMatches.filter((p) => p !== personId),
    snapshot:
      c.snapshot === null
        ? null
        : { ...c.snapshot, subjects: c.snapshot.subjects.filter((s) => s !== personId) },
  });
  await audit(ctx, {
    kind: 'cycle',
    action: 'Removed someone from a cycle',
    target: c.name,
    targetId: id,
    fields: ['participants'],
  });
  ctx.touched.add(id);
  return ok({ detached });
}

export async function extendDeadline(
  ctx: Ctx,
  id: string,
  input: { kind: ActivityKind; personIds: string[]; due: CalendarDate; reason: string },
): Promise<Result<{ extended: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  if (input.reason.trim() === '')
    return err(failure('REASON', 'Give a reason; it is kept in the audit log'));
  let extended = 0;
  for (const r of await ctx.tx.reviews.find({ cycleId: id })) {
    if (r.kind !== input.kind || isSubmitted(r)) continue;
    if (input.personIds.length > 0 && !input.personIds.includes(r.subjectId)) continue;
    await ctx.tx.reviews.save({ ...r, due: input.due });
    extended += 1;
  }
  if (input.personIds.length === 0 && c.snapshot !== null)
    await ctx.tx.cycles.save({
      ...c,
      version: c.version + 1,
      snapshot: { ...c.snapshot, due: { ...c.snapshot.due, [input.kind]: input.due } },
    });
  await audit(ctx, {
    kind: 'cycle',
    action: 'Extended a deadline',
    target: `${c.name} · ${label(input.kind)}`,
    targetId: id,
    fields: ['due', 'reason'],
  });
  ctx.touched.add(id);
  return ok({ extended });
}

/** A reminder by hand (§8.4): to every author of an unsubmitted review about the people chosen. */
export async function remind(
  ctx: Ctx,
  id: string,
  personIds: string[],
): Promise<Result<{ reminded: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  const name = await names(ctx);
  const authors = new Set<string>();
  for (const r of await ctx.tx.reviews.find({ cycleId: id }))
    if (
      !isSubmitted(r) &&
      r.detached === null &&
      r.status !== 'cancelled' &&
      (personIds.length === 0 || personIds.includes(r.subjectId))
    )
      authors.add(r.authorId);
  for (const n of await ctx.tx.nominations.find({ cycleId: id }))
    if (
      n.state === 'draft' &&
      (personIds.length === 0 || personIds.includes(n.subjectId)) &&
      n.by !== 'hr'
    )
      authors.add(n.by);
  const members = await ctx.members();
  for (const a of authors) {
    const email = members.find((m) => m.personId === a)?.workEmail;
    if (email)
      ctx.mail.push({
        to: email,
        subject: `Reminder: ${c.name}`,
        text: `Hi ${name(a)}, you have reviews to write in ${c.name}. Open Kithena to continue.`,
        dedupeKey: `remind:${id}:${a}:${ctx.today}`,
        ...(c.reminders.chat ? {} : { chat: false as const }),
      });
  }
  await audit(ctx, {
    kind: 'cycle',
    action: 'Sent reminders',
    target: `${c.name} · ${String(authors.size)} people`,
    targetId: id,
  });
  return ok({ reminded: authors.size });
}

/** HR releases early, for some or everyone (§10.8). */
export async function releaseFor(
  ctx: Ctx,
  id: string,
  personIds: string[],
): Promise<Result<{ released: number }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  let released = 0;
  for (const r of await ctx.tx.reviews.find({ cycleId: id })) {
    if (r.kind === 'self' || r.released !== null || !isSubmitted(r)) continue;
    if (personIds.length > 0 && !personIds.includes(r.subjectId)) continue;
    await ctx.tx.reviews.save({ ...r, released: { at: ctx.at, by: ctx.viewer.name } });
    await publish(
      ctx,
      event(
        ctx,
        'performance.review.released',
        { type: 'review', id: r.id },
        { reviewId: r.id, cycleId: id, subjectId: r.subjectId },
      ),
    );
    released += 1;
  }
  await audit(ctx, {
    kind: 'cycle',
    action: 'Released reviews',
    target: `${c.name} · ${String(released)}`,
    targetId: id,
  });
  ctx.touched.add(id);
  return ok({ released });
}

/** The subject's manager changed mid-cycle (§8.8, design PF5f): who finishes the draft. */
export async function handOver(
  ctx: Ctx,
  reviewId: string,
  input: { choice: 'hand_over' | 'old_finishes' | 'restart'; to: string; note: string | null },
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const r = await ctx.tx.reviews.get(reviewId);
  if (r === null || r.kind !== 'manager') return err(notFound('manager review'));
  if (input.choice === 'old_finishes') {
    await audit(ctx, {
      kind: 'review',
      action: 'Kept a manager review with its writer',
      target: 'Manager review',
      targetId: reviewId,
    });
    return ok({ ok: true });
  }
  if (input.choice === 'hand_over')
    await ctx.tx.reviews.save({
      ...r,
      authorId: input.to,
      handover: { from: r.authorId, note: input.note },
    });
  else {
    await ctx.tx.reviews.save({ ...r, status: 'cancelled' });
    if (r.cycleId !== null)
      await ctx.tx.reviews.save(
        newReview({
          id: ctx.deps.newId(),
          cycleId: r.cycleId,
          kind: 'manager',
          subjectId: r.subjectId,
          authorId: input.to,
          templateId: r.templateId,
          version: r.version,
          due: r.due,
          confidential: false,
          hidden: false,
          goals: r.goals,
          at: ctx.at,
        }),
      );
  }
  await audit(ctx, {
    kind: 'review',
    action: 'Handed over a manager review',
    target: 'Manager review',
    targetId: reviewId,
    fields: ['author'],
  });
  if (r.cycleId !== null) ctx.touched.add(r.cycleId);
  return ok({ ok: true });
}

/* ------------------------------------------------------------ overview -- */

const reviewState = (r: Review | undefined, today: CalendarDate): string => {
  if (r === undefined) return 'none';
  if (r.detached !== null) return 'detached';
  if (r.acknowledged !== null) return 'ack';
  if (r.released !== null) return 'released';
  if (isSubmitted(r))
    return r.status === 'unlock_requested'
      ? 'unlock'
      : r.status === 'unlocked'
        ? 'unlocked'
        : 'submitted';
  if (r.due < today && ['not_started', 'in_progress'].includes(r.status)) return 'overdue';
  return r.status === 'in_progress'
    ? 'draft'
    : r.status === 'not_started'
      ? 'not_started'
      : r.status;
};

/** A review as the charts count it: one of four states, lateness first. */
function stance(r: Review, today: CalendarDate): 'submitted' | 'overdue' | 'started' | 'waiting' {
  if (isSubmitted(r)) return 'submitted';
  if (r.due < today && ['not_started', 'in_progress'].includes(r.status)) return 'overdue';
  return r.status === 'in_progress' ? 'started' : 'waiting';
}

/**
 * Where the cycle's reviews stand, overall and by the department of the
 * person each is about, the least done first: the departments to chase.
 * Eight departments, the rest as Other, so the chart stays readable.
 */
export function insightsOf(
  reviews: readonly Review[],
  subjects: readonly Person[],
  today: CalendarDate,
): {
  readonly status: Record<'submitted' | 'overdue' | 'started' | 'waiting', number>;
  readonly byDepartment: readonly {
    readonly department: string;
    readonly submitted: number;
    readonly started: number;
    readonly waiting: number;
    readonly overdue: number;
  }[];
} {
  const live = reviews.filter((r) => r.detached === null && !r.hidden && r.status !== 'cancelled');
  const department = new Map(subjects.map((p) => [p.personId, p.department ?? 'No department']));
  const status = { submitted: 0, overdue: 0, started: 0, waiting: 0 };
  const rows = new Map<
    string,
    { submitted: number; started: number; waiting: number; overdue: number }
  >();
  for (const r of live) {
    const s = stance(r, today);
    status[s] += 1;
    const d = department.get(r.subjectId);
    if (d === undefined) continue;
    const row = rows.get(d) ?? { submitted: 0, started: 0, waiting: 0, overdue: 0 };
    row[s] += 1;
    rows.set(d, row);
  }
  const done = (x: { submitted: number; started: number; waiting: number; overdue: number }) =>
    x.submitted / Math.max(1, x.submitted + x.started + x.waiting + x.overdue);
  const ranked = [...rows]
    .map(([d, x]) => ({ department: d, ...x }))
    .toSorted(
      (a, b) =>
        done(a) - done(b) || b.overdue - a.overdue || a.department.localeCompare(b.department),
    );
  const kept = ranked.slice(0, 8);
  const rest = ranked.slice(8);
  return {
    status,
    byDepartment:
      rest.length === 0
        ? kept
        : [
            ...kept,
            rest.reduce(
              (o, x) => ({
                department: 'Other',
                submitted: o.submitted + x.submitted,
                started: o.started + x.started,
                waiting: o.waiting + x.waiting,
                overdue: o.overdue + x.overdue,
              }),
              { department: 'Other', submitted: 0, started: 0, waiting: 0, overdue: 0 },
            ),
          ],
  };
}

/** The overview's own conditions, beside a person's: each review's state, and lateness. */
const REVIEW_FIELDS = new Set(['self', 'managerReview', 'overdue']);
const OverviewCond = z.object({
  field: z.enum([
    'department',
    'status',
    'hiredOn',
    'manager',
    'title',
    'legalEntity',
    'location',
    'self',
    'managerReview',
    'overdue',
  ]),
  op: z.enum(['is', 'not', 'contains', 'before', 'after']).optional(),
  value: z.string().max(120),
});
type Cond = z.infer<typeof OverviewCond>;

/** The filter from the address, or none when it does not read as one. */
function overviewFilter(raw: string | undefined): Cond[] {
  if (raw === undefined || raw === '') return [];
  try {
    const parsed = z.array(OverviewCond).max(30).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** PF5: header, tiles per activity, and one row per subject the viewer may see, paged. */
export async function overviewScreen(
  ctx: Ctx,
  id: string,
  opts: {
    q?: string;
    page?: number;
    size?: number;
    tab?: string;
    /** Conditions as JSON: a person's fields (`matches`) and their reviews' states. */
    filter?: string;
    match?: 'all' | 'any';
    /** Rows in runs of one key: department, location, legalEntity or manager. */
    group?: string;
  },
): Promise<Result<unknown>> {
  const c = await ctx.tx.cycles.get(id);
  if (c === null) return err(notFound('cycle'));
  if (!ctx.viewer.hr && !(await involved(ctx, c))) return err(notFound('cycle'));
  const members = await people(ctx);
  const byId = new Map(members.map((m) => [m.personId, m]));
  const reviews = (await ctx.tx.reviews.find({ cycleId: id })).filter((r) => !r.hidden);
  const counts = countsOf(reviews, ctx.today);
  const subjects = (c.snapshot?.subjects ?? subjectsOf(c, members.map(filterable))).filter(
    (s) => ctx.viewer.hr || ctx.viewer.org.has(s),
  );
  const nominations = await ctx.tx.nominations.find({ cycleId: id });
  const subjectPeople = subjects
    .map((s) => byId.get(s))
    .filter((p): p is Person => p !== undefined);
  const needle = (opts.q ?? '').toLowerCase();
  const asked = overviewFilter(opts.filter);
  const match = opts.match ?? 'all';
  const bySubject = Map.groupBy(reviews, (r) => r.subjectId);
  const stateOf = (p: Person, field: string): string => {
    const about = bySubject.get(p.personId) ?? [];
    const kind = field === 'self' ? 'self' : 'manager';
    if (field === 'managerReview' && p.managerId === null) return 'none';
    if (field === 'overdue')
      return about.some(
        (r) =>
          !isSubmitted(r) && r.due < ctx.today && ['not_started', 'in_progress'].includes(r.status),
      )
        ? 'yes'
        : 'no';
    return reviewState(
      about.find((r) => r.kind === kind),
      ctx.today,
    );
  };
  const reviewHolds = (p: Person, cond: Cond): boolean => {
    const have = stateOf(p, cond.field);
    return cond.op === 'not' ? have !== cond.value : have === cond.value;
  };
  const personConds = asked.filter((x) => !REVIEW_FIELDS.has(x.field)) as Condition[];
  const reviewConds = asked.filter((x) => REVIEW_FIELDS.has(x.field));
  const wanted = (p: Person): boolean => {
    if (asked.length === 0) return true;
    const person = personConds.length === 0 ? null : matches(filterable(p), personConds, match);
    const states = reviewConds.map((x) => reviewHolds(p, x));
    if (match === 'any') return person === true || states.some(Boolean);
    return (person ?? true) && states.every(Boolean);
  };
  const groupKey = (p: Person): string =>
    opts.group === 'department'
      ? (p.department ?? '')
      : opts.group === 'location'
        ? (p.locationId ?? '')
        : opts.group === 'legalEntity'
          ? (p.legalEntityId ?? '')
          : opts.group === 'manager'
            ? p.managerId === null
              ? ''
              : (byId.get(p.managerId)?.name ?? '')
            : '';
  const shown = subjects
    .map((s) => byId.get(s))
    .filter((p): p is Person => p !== undefined)
    .filter(
      (p) =>
        needle === '' ||
        [p.name, p.department, p.title].some((x) => (x ?? '').toLowerCase().includes(needle)),
    )
    .filter(wanted)
    // In runs of the group, those with none last, so a page never splits a run
    // it could keep together; by name within each.
    .toSorted(
      (a, b) =>
        Number(groupKey(a) === '') - Number(groupKey(b) === '') ||
        groupKey(a).localeCompare(groupKey(b)) ||
        a.name.localeCompare(b.name),
    );
  const size = Math.min(200, Math.max(10, opts.size ?? 50));
  const page = Math.max(1, opts.page ?? 1);
  const slice = shown.slice((page - 1) * size, page * size);
  const rows = slice.map((p) => {
    const about = bySubject.get(p.personId) ?? [];
    const peers = about.filter(
      (r) => r.kind === 'peer' && r.detached === null && r.status !== 'cancelled',
    );
    const nom = nominations.find((n) => n.subjectId === p.personId);
    const mgr = about.find((r) => r.kind === 'manager');
    return {
      personId: p.personId,
      name: p.name,
      title: subtitle(p),
      // What a row is grouped by, as its keys: names for the shell to put to them.
      department: p.department,
      locationId: p.locationId,
      legalEntityId: p.legalEntityId,
      manager:
        p.managerId === null
          ? null
          : { id: p.managerId, name: byId.get(p.managerId)?.name ?? 'Someone' },
      self: reviewState(
        about.find((r) => r.kind === 'self'),
        ctx.today,
      ),
      peers: !c.activities.peer.on
        ? '—'
        : nom !== undefined && nom.state === 'draft'
          ? 'Nominating'
          : nom?.state === 'waiting'
            ? 'Awaiting approval'
            : `${String(peers.filter(isSubmitted).length)} of ${String(peers.length)}`,
      upward: c.activities.upward.on
        ? `${String(about.filter((r) => r.kind === 'upward' && isSubmitted(r)).length)} of ${String(about.filter((r) => r.kind === 'upward').length)}`
        : '—',
      // Nobody can write it for someone with no manager (`checks` says so at launch).
      managerReview: p.managerId === null ? '—' : reviewState(mgr, ctx.today),
      managerReviewId: mgr?.id ?? null,
      // Where peers are nominated for them, from the row's own menu.
      nominationId: nom?.id ?? null,
      release: mgr?.acknowledged
        ? 'Acknowledged'
        : mgr?.released
          ? 'Released'
          : mgr !== undefined && isSubmitted(mgr)
            ? 'Not released'
            : '—',
      score:
        ctx.viewer.hr && mgr !== undefined
          ? (mgr.calibrated?.hundredths ?? mgr.submitted.at(-1)?.scoreHundredths ?? null)
          : null,
    };
  });
  const due = c.snapshot?.due ?? dueDates(c);
  const pinned = Object.entries(c.snapshot?.pinned ?? {}).map(
    ([k, v]) => `${k[0]?.toUpperCase() ?? ''}${k.slice(1)} v${String(v.version)}`,
  );
  const name = await names(ctx);
  return ok({
    cycle: {
      id: c.id,
      name: c.name,
      state: c.state,
      version: c.version,
      start: c.start,
      dates: datesOf(c),
      versions: pinned.join(', '),
      who: whoOf(c, subjects.length),
      launch: c.launch,
      release: c.visibility.release,
      kinds: KINDS.filter((k) => c.activities[k].on),
    },
    tiles: REVIEW_KINDS.filter((k) => c.activities[k].on).map((k) => ({
      kind: k,
      submitted: counts.byKind[k]?.submitted ?? 0,
      started: counts.byKind[k]?.started ?? 0,
      overdue: counts.byKind[k]?.overdue ?? 0,
      total: counts.byKind[k]?.total ?? 0,
      due: due[k] ?? null,
    })),
    // The cycle on one axis: its deadlines as they stand (extensions
    // included), the reminders the rules put around them, and today.
    plan: {
      start: c.start,
      nominations:
        due.nominations === undefined ? c.nominations : { kind: 'exact', date: due.nominations },
      activities: Object.fromEntries(
        KINDS.map((k) => {
          const date = due[k];
          const a = c.activities[k];
          return [
            k,
            {
              on: a.on,
              due:
                date === undefined
                  ? a.due
                  : {
                      kind: 'exact',
                      date,
                      ...(a.due.kind === 'relative' ? { from: a.due.from } : {}),
                    },
            },
          ];
        }),
      ),
      peer: { all: c.peer.all },
      reminders: c.reminders,
      visibility: { release: c.visibility.release },
    },
    today: ctx.today,
    released: reviews.filter((r) => r.released !== null && r.kind === 'manager').length,
    overdue: counts.overdue,
    // The two charts' numbers: where every review stands, and by department.
    insights: insightsOf(reviews, subjectPeople, ctx.today),
    rows,
    total: shown.length,
    page,
    size,
    nominations: nominations
      .filter((n) => ctx.viewer.hr || ctx.viewer.org.has(n.subjectId))
      .map((n) => ({
        id: n.id,
        subjectId: n.subjectId,
        subject: name(n.subjectId),
        peers: n.nominees.filter((x) => x.state !== 'declined').map((x) => name(x.personId)),
        count: n.nominees.filter((x) => x.state !== 'declined').length,
        state:
          n.state === 'approved'
            ? n.nominees.some((x) => x.state === 'declined')
              ? 'Declined, replaced'
              : 'Approved'
            : n.state === 'waiting'
              ? `Waiting for ${n.approverId === null ? 'HR' : name(n.approverId)}`
              : 'Not nominated',
        late: n.state === 'draft' && due.nominations !== undefined && due.nominations < ctx.today,
      })),
    bounds: { min: c.peer.min, max: c.peer.max },
    // What the table filters by: the values present among the cycle's people.
    fields: {
      departments: [
        ...new Set(subjectPeople.flatMap((p) => (p.department === null ? [] : [p.department]))),
      ].toSorted(),
      locations: [
        ...new Set(subjectPeople.flatMap((p) => (p.locationId === null ? [] : [p.locationId]))),
      ],
      legalEntities: [
        ...new Set(
          subjectPeople.flatMap((p) => (p.legalEntityId === null ? [] : [p.legalEntityId])),
        ),
      ],
      managers: [
        ...new Set(subjectPeople.flatMap((p) => (p.managerId === null ? [] : [p.managerId]))),
      ]
        .map((m) => ({ value: m, label: byId.get(m)?.name ?? 'Someone' }))
        .toSorted((a, b) => a.label.localeCompare(b.label)),
      statuses: [...new Set(subjectPeople.map((p) => p.status))],
    },
    settings: { visibility: c.visibility, peer: c.peer, reminders: c.reminders, goals: c.goals },
    hr: ctx.viewer.hr,
  });
}

/** PF20: every unlock request for HR, newest first. */
export async function unlocksScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const name = await names(ctx);
  const cycles = new Map((await ctx.tx.cycles.find()).map((c) => [c.id, c.name]));
  const rows = (await ctx.tx.reviews.find())
    .filter((r) => r.unlock !== null)
    .toSorted((a, b) => (b.unlock?.at ?? '').localeCompare(a.unlock?.at ?? ''))
    .map((r) => ({
      reviewId: r.id,
      by: name(r.authorId),
      review: `${label(r.kind).replace(/^./u, (x) => x.toUpperCase())} · ${name(r.subjectId)}`,
      cycle: r.cycleId === null ? null : (cycles.get(r.cycleId) ?? null),
      reason: r.unlock?.reason ?? '',
      at: r.unlock?.at ?? '',
      decided:
        r.unlock?.decided === null || r.unlock?.decided === undefined
          ? null
          : r.unlock.decided.approved
            ? 'Unlocked'
            : 'Declined',
    }));
  return ok({ rows });
}
