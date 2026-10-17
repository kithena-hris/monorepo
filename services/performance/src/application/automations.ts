import type { ActivityKind, CalendarDate } from '@kithena/contracts';
import { err, ok, type Result } from '@kithena/domain-kit';

import {
  calendarStarts,
  createOn,
  groups,
  isoWeek,
  type Automation,
  type Trigger,
} from '../domain/automation.js';
import { addDays, draftCycle, KINDS, type Cycle } from '../domain/cycle.js';
import { audit, event, hrOnly, names, notFound, publish, type Ctx } from './context.js';
import { people } from './members.js';
import { settingsOf } from './settings.js';
import { ensureSeeded } from './templates.js';

/**
 * Automations (PRD §16, PRF-108 to PRF-110): rules that make scheduled
 * cycles, on a calendar with a lead time or from an event, previewed before
 * they run, with a warning where two would put the same people in
 * overlapping reviews. The sweep runs them once a day.
 */

const label = (t: Trigger): string =>
  t.kind === 'calendar'
    ? `Every ${t.every === 'half' ? 'half-year' : t.every}, ${String(t.leadDays)} days ahead`
    : `${String(Math.round(t.offsetDays / 30))} months after ${t.event === 'hired' ? 'the start' : t.event === 'probation_end' ? 'probation ends' : 'each anniversary'}${t.times > 1 ? `, ${t.times === 2 ? 'twice' : `${String(t.times)} times`}` : ''}${t.group === 'week' ? ', grouped by week' : ''}`;

async function ensureSeededAutomations(ctx: Ctx): Promise<void> {
  if ((await ctx.tx.settings.get('automationsSeeded')) !== null) return;
  await ctx.tx.settings.set('automationsSeeded', { at: ctx.at });
  await ensureSeeded(ctx);
  const templates = (await settingsOf(ctx)).reviews.templates as Partial<
    Record<ActivityKind, string>
  >;
  const probation = (await ctx.tx.templates.find()).find((t) => t.name === 'Probation review')?.id;
  // The owner's example (§16.3), paused until HR turns it on: 3 months after the start, twice.
  await ctx.tx.automations.save({
    id: ctx.deps.newId(),
    name: 'Probation reviews',
    trigger: {
      kind: 'event',
      event: 'hired',
      offsetDays: 90,
      repeatDays: 90,
      times: 2,
      group: 'week',
      leadDays: 14,
    },
    activities: ['self', 'manager'],
    templates: probation === undefined ? templates : { self: probation, manager: probation },
    dueDays: { self: 7, manager: 14 },
    skip: ['on_leave'],
    paused: true,
    created: [],
    by: 'Kithena',
    at: ctx.at,
  });
}

interface Occurrence {
  readonly automationId: string;
  readonly name: string;
  readonly key: string;
  readonly start: CalendarDate;
  readonly createOn: CalendarDate;
  readonly people: readonly string[] | null;
}

async function occurrences(ctx: Ctx, a: Automation, until: CalendarDate): Promise<Occurrence[]> {
  const t = a.trigger;
  if (t.kind === 'calendar')
    return calendarStarts(t, ctx.today, 4)
      .filter((d) => d <= until)
      .map((start) => ({
        automationId: a.id,
        name: `${a.name} · ${start.slice(0, 7)}`,
        key: start,
        start,
        createOn: createOn(start, t.leadDays),
        people: null,
      }));
  const all = await people(ctx);
  const on = all
    .filter((p) => p.status !== 'terminated')
    .map((p) => ({
      personId: p.personId,
      on: (t.event === 'probation_end' ? p.probationEnd : p.hiredOn) as CalendarDate | null,
    }))
    .filter((p): p is { personId: string; on: CalendarDate } => p.on !== null);
  return groups(t, on)
    .filter((g) => g.start >= addDays(ctx.today, -7) && g.start <= until)
    .map((g) => ({
      automationId: a.id,
      name:
        t.group === 'week'
          ? `${a.name}, week ${String(isoWeek(g.start))}`
          : `${a.name} · ${g.start}`,
      key: g.key,
      start: g.start,
      createOn: createOn(g.start, t.leadDays),
      people: g.people,
    }));
}

export async function automationsScreen(ctx: Ctx): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  await ensureSeededAutomations(ctx);
  const until = addDays(ctx.today, 183);
  const list = await ctx.tx.automations.find();
  const name = await names(ctx);
  const rows = [];
  const windows: {
    id: string;
    start: CalendarDate;
    end: CalendarDate;
    people: Set<string> | null;
  }[] = [];
  for (const a of list) {
    const next = await occurrences(ctx, a, until);
    rows.push({
      id: a.id,
      name: a.name,
      trigger: a.trigger,
      label: label(a.trigger),
      paused: a.paused,
      activities: [...a.activities],
      next: next.slice(0, 6).map((o) => ({ ...o, people: o.people?.map(name) ?? null })),
      created: a.created.length,
    });
    for (const o of next)
      windows.push({
        id: a.id,
        start: o.start,
        end: addDays(o.start, 28),
        people: o.people === null ? null : new Set(o.people),
      });
  }
  const cycles = (await ctx.tx.cycles.find()).filter((c) =>
    ['scheduled', 'in_progress', 'launching'].includes(c.state),
  );
  const overlaps = [];
  for (const w of windows)
    for (const c of cycles) {
      const end =
        Object.values(c.snapshot?.due ?? {})
          .toSorted()
          .at(-1) ?? addDays(c.start.date, 28);
      if (w.start > end || w.end < c.start.date) continue;
      const people =
        w.people === null
          ? (c.snapshot?.subjects.length ?? 0)
          : (c.snapshot?.subjects ?? []).filter((s) => w.people?.has(s)).length;
      if (people > 0)
        overlaps.push({
          automationId: w.id,
          automation: list.find((a) => a.id === w.id)?.name ?? '',
          cycle: c.name,
          people,
          from: w.start,
        });
    }
  return ok({
    rows,
    overlaps: overlaps.slice(0, 10),
    from: ctx.today,
    until,
    templates: (await ctx.tx.templates.find())
      .filter((t) => !t.archived)
      .map((t) => ({ id: t.id, name: t.name, purpose: t.purpose })),
  });
}

export async function automationScreen(ctx: Ctx, id: string): Promise<Result<unknown>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const a = await ctx.tx.automations.get(id);
  if (a === null) return err(notFound('automation'));
  const name = await names(ctx);
  const cycles = await ctx.tx.cycles.find();
  const next = await occurrences(ctx, a, addDays(ctx.today, 183));
  return ok({
    automation: { ...a, label: label(a.trigger) },
    rows: [
      ...a.created.map((x) => {
        const c = cycles.find((y) => y.id === x.cycleId);
        return {
          key: x.key,
          start: c?.start.date ?? x.key,
          cycle: c?.name ?? 'Deleted',
          cycleId: x.cycleId,
          state: c?.state ?? null,
          people: (
            c?.snapshot?.subjects ??
            c?.participants.include.map((p) => p.personId) ??
            []
          ).map(name),
        };
      }),
      ...next
        .filter((o) => !a.created.some((x) => x.key === o.key))
        .map((o) => ({
          key: o.key,
          start: o.start,
          cycle: null,
          cycleId: null,
          state: null,
          createOn: o.createOn,
          people: o.people?.map(name) ?? [],
        })),
    ],
  });
}

export async function saveAutomation(
  ctx: Ctx,
  id: string | null,
  input: Omit<Automation, 'id' | 'created' | 'by' | 'at'>,
): Promise<Result<{ id: string }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const old = id === null ? null : await ctx.tx.automations.get(id);
  if (id !== null && old === null) return err(notFound('automation'));
  const a: Automation = {
    ...input,
    id: id ?? ctx.deps.newId(),
    created: old?.created ?? [],
    by: old?.by ?? ctx.viewer.name,
    at: old?.at ?? ctx.at,
  };
  await ctx.tx.automations.save(a);
  await audit(ctx, { kind: 'automation',
    action: id === null ? 'Created an automation' : 'Edited an automation',
    target: a.name,
    targetId: a.id,
    fields: Object.keys(input),
  });
  return ok({ id: a.id });
}

export async function pauseAutomation(
  ctx: Ctx,
  id: string,
  paused: boolean,
): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const a = await ctx.tx.automations.get(id);
  if (a === null) return err(notFound('automation'));
  await ctx.tx.automations.save({ ...a, paused });
  await audit(ctx, { kind: 'automation',
    action: paused ? 'Paused an automation' : 'Turned on an automation',
    target: a.name,
    targetId: id,
  });
  return ok({ ok: true });
}

export async function deleteAutomation(ctx: Ctx, id: string): Promise<Result<{ ok: true }>> {
  const may = hrOnly(ctx);
  if (!may.ok) return may;
  const a = await ctx.tx.automations.get(id);
  if (a === null) return err(notFound('automation'));
  await ctx.tx.automations.remove(id);
  await audit(ctx, { kind: 'automation', action: 'Deleted an automation', target: a.name, targetId: id });
  return ok({ ok: true });
}

/** Today's work for every running automation: each occurrence due is a scheduled cycle (§16.1). */
export async function runAutomations(ctx: Ctx): Promise<void> {
  const last = (await ctx.tx.settings.get('automationsRun')) as { day?: string } | null;
  if (last?.day === ctx.today) return;
  await ctx.tx.settings.set('automationsRun', { day: ctx.today });
  for (const a of await ctx.tx.automations.find()) {
    if (a.paused) continue;
    for (const o of await occurrences(ctx, a, addDays(ctx.today, 366))) {
      if (o.createOn > ctx.today || a.created.some((x) => x.key === o.key)) continue;
      const cycle = await cycleFrom(ctx, a, o);
      const fresh = await ctx.tx.automations.get(a.id);
      if (fresh !== null)
        await ctx.tx.automations.save({
          ...fresh,
          created: [...fresh.created, { key: o.key, cycleId: cycle.id }],
        });
    }
  }
}

async function cycleFrom(ctx: Ctx, a: Automation, o: Occurrence): Promise<Cycle> {
  const settings = await settingsOf(ctx);
  const base = draftCycle({
    id: ctx.deps.newId(),
    name: o.name,
    owner: 'Kithena',
    ownerName: 'Automation',
    start: o.start < ctx.today ? ctx.today : o.start,
    zone: settings.general.zone,
    at: ctx.at,
    templates: a.templates,
  });
  const activities = Object.fromEntries(
    KINDS.map((k) => [
      k,
      {
        ...base.activities[k],
        on: a.activities.includes(k),
        templateId: a.templates[k] ?? null,
        due: { kind: 'relative' as const, days: a.dueDays[k] ?? 14, from: 'start' as const },
      },
    ]),
  ) as Cycle['activities'];
  const c: Cycle = {
    ...base,
    automationId: a.id,
    state: 'scheduled',
    activities,
    peer: { ...base.peer, all: true },
    participants:
      o.people === null
        ? base.participants
        : {
            filter: [],
            include: o.people.map((personId) => ({
              personId,
              reason: 'From the automation',
              by: 'Kithena',
              at: ctx.at,
            })),
            exclude: [],
            keepInStep: false,
          },
  };
  await ctx.tx.cycles.save(c);
  await publish(
    ctx,
    event(
      ctx,
      'performance.cycle.state_changed',
      { type: 'cycle', id: c.id },
      { cycleId: c.id, from: null, to: 'scheduled', reviews: 0 },
    ),
  );
  await audit(ctx, { kind: 'cycle', action: 'An automation scheduled a cycle', target: c.name, targetId: c.id });
  ctx.touched.add(c.id);
  return c;
}
