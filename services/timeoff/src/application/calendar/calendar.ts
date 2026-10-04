import { ok, type Result } from '@kithena/domain-kit';
import {
  CalendarDate,
  type LeaveTypeDefinition,
  type LocationKey,
  type PersonId,
  type TeamKey,
  type TeammateRequestView,
} from '@kithena/contracts';

import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { coverage, type DayCoverage } from '../../domain/coverage/coverage.js';
import { addDays } from '../../domain/days.js';
import type { LeaveRequest } from '../../domain/request/leave-request.js';
import type { Caller, Deps, Member, Tx } from '../ports.js';
import { absencesIn, LIVE } from '../request/assess.js';
import { calendarOf, isHrAdmin, notFound, refuse, relates, transact } from '../shared.js';

/**
 * The team calendar (PRD §10.1, TOF-040): month, timeline and year are the
 * same data over different ranges, for the team, the company or me.
 *
 * Visibility is applied here, once, for every view and the feed: the member
 * and their approvers see the type; a teammate sees the type unless the
 * leave type says "Off" — sick and parental always do (§6.1) — and then sees
 * "Off" and nothing else; anybody else sees nothing. HR sees everyone.
 */

export type Scope = 'team' | 'company' | 'me';

export interface CalendarQuery {
  readonly scope: Scope;
  readonly from: CalendarDate;
  readonly to: CalendarDate;
  /** For `team`: which one. Defaults to the caller's own. */
  readonly teamKey?: TeamKey | null;
}

export interface CalendarView {
  readonly people: readonly {
    readonly personId: PersonId;
    readonly displayName: string;
    readonly teamKey: TeamKey | null;
    readonly teamName: string | null;
  }[];
  /** One per run of days: a swapped request is several. Shaped as a teammate sees one. */
  readonly entries: readonly TeammateRequestView[];
  readonly holidays: readonly {
    readonly date: CalendarDate;
    readonly name: string;
    readonly locationKey: LocationKey;
  }[];
  /** For a team with a minimum: every day, "4 of 7", for the timeline's coverage row. */
  readonly coverage: readonly DayCoverage[];
}

export type Sight = 'type' | 'teammate';
type LeaveTypeVisibility = LeaveTypeDefinition['visibility'];

/**
 * How much of a member's time off the caller may see, or `null` for none of
 * it. The calendar's rule, and the assistant's (`assist/capabilities.ts`).
 */
export async function sightOf(
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  member: Member,
  hr: boolean,
): Promise<Sight | null> {
  if (hr || caller.personId === member.personId) return 'type';
  if (
    (await relates(deps, caller, 'approver', member.personId)) ||
    (await relates(deps, caller, 'delegate', member.personId))
  ) {
    return 'type';
  }
  return (await relates(deps, caller, 'teammate', member.personId)) ? 'teammate' : null;
}

/**
 * Whether an absence shows its leave type to somebody with `sight` of the
 * member: always to the member, their approvers and HR; to a teammate only
 * where the type says so — never sick or parental leave (§6.1). Otherwise it
 * is "Off" and nothing else.
 */
export const seesType = (sight: Sight, visibility: LeaveTypeVisibility | undefined): boolean =>
  sight === 'type' || visibility === 'type';

/** A request's runs of days overlapping `from`–`to`, each with its own half days. */
export function runsIn(
  request: LeaveRequest,
  from: CalendarDate,
  to: CalendarDate,
): TeammateRequestView['span'][] {
  return request.spans
    .filter((run) => run.to >= from && run.from <= to)
    .map((run) => ({
      from: run.from,
      to: run.to,
      startsHalfDay: run.from === request.span.from && request.span.startsHalfDay,
      endsHalfDay: run.to === request.span.to && request.span.endsHalfDay,
    }));
}

const SHOWN: readonly LeaveRequest['status'][] = [...LIVE, 'taken'];

async function candidates(
  tx: Tx,
  caller: Caller,
  query: CalendarQuery,
): Promise<Result<readonly Member[]>> {
  const self = caller.personId === null ? null : await tx.members.get(caller.personId);
  switch (query.scope) {
    case 'me':
      return self === null ? notFound('Member') : ok([self]);
    case 'team': {
      const teamKey = query.teamKey ?? self?.teamKey ?? null;
      return teamKey === null ? ok([]) : ok(await tx.members.list({ teamKey }));
    }
    case 'company':
      return ok(await tx.members.list());
  }
}

/** The calendar in `tx`, for the feed and the views alike. */
export async function calendarIn(
  tx: Tx,
  deps: Pick<Deps, 'authz'>,
  caller: Caller,
  query: CalendarQuery,
): Promise<Result<CalendarView>> {
  if (query.to < query.from)
    return refuse('INVALID_PERIOD', 'The range ends before it starts', ['to']);
  const found = await candidates(tx, caller, query);
  if (!found.ok) return found;
  const hr = await isHrAdmin(deps, caller);
  const seen = new Map<PersonId, { member: Member; sight: Sight }>();
  for (const member of found.value) {
    if (member.status === 'left') continue;
    const sight = await sightOf(deps, caller, member, hr);
    if (sight !== null) seen.set(member.personId, { member, sight });
  }

  const visibility = new Map(
    (await tx.leaveTypes.list()).map((t) => [t.definition.key, t.definition.visibility]),
  );
  const records = await tx.requests.list({
    personIds: [...seen.keys()],
    statuses: SHOWN,
    from: query.from,
    to: query.to,
  });
  const entries = records.flatMap(({ request }): TeammateRequestView[] => {
    const who = seen.get(request.personId);
    if (who === undefined) return [];
    const off = !seesType(who.sight, visibility.get(request.leaveType.key));
    return runsIn(request, query.from, query.to).map((span) => {
      const base = {
        requestId: request.id,
        personId: request.personId,
        span,
        status: request.status,
      };
      return off
        ? { ...base, shows: 'off' as const }
        : { ...base, shows: 'type' as const, leaveTypeKey: request.leaveType.key };
    });
  });

  const people = [...seen.values()].map(({ member }) => member);
  const holidays = await holidaysFor(tx, people, query.from, query.to);

  let days: DayCoverage[] = [];
  const teamKey = query.scope === 'team' ? (people[0]?.teamKey ?? null) : null;
  const minimum = teamKey === null ? null : await tx.approvals.teamMinimum(teamKey);
  if (teamKey !== null && minimum !== null) {
    const team = (await tx.members.list({ teamKey })).filter((m) => m.status !== 'left');
    const members = await Promise.all(
      team.map(async (m) => ({
        personId: m.personId,
        calendar: await calendarOf(tx, m, query.from, query.to),
      })),
    );
    const absences = await absencesIn(
      tx,
      team.map((m) => m.personId),
      query.from,
      query.to,
      null,
    );
    days = coverage({ members, absences, minimum, from: query.from, to: query.to }).days;
  }

  return ok({
    people: people.map((m) => ({
      personId: m.personId,
      displayName: m.displayName,
      teamKey: m.teamKey,
      teamName: m.teamName,
    })),
    entries,
    holidays,
    coverage: days,
  });
}

/** The public holidays at the members' locations in `from`–`to`, by date. */
export async function holidaysFor(
  tx: Tx,
  people: readonly Member[],
  from: CalendarDate,
  to: CalendarDate,
): Promise<CalendarView['holidays']> {
  const layers = await tx.holidays.layers();
  const locations = [
    ...new Set(people.map((m) => m.locationKey).filter((l): l is LocationKey => l !== null)),
  ];
  const out: CalendarView['holidays'][number][] = [];
  for (const locationKey of locations) {
    const keys = await tx.holidays.assigned(locationKey);
    const mine = keys.flatMap((k) => layers.filter((l) => l.key === k));
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
      for (const h of resolveHolidays(mine, y)) {
        if (h.date >= from && h.date <= to) out.push({ date: h.date, name: h.name, locationKey });
      }
    }
  }
  return out.toSorted((a, b) => a.date.localeCompare(b.date));
}

/** Month (T12) and timeline (T13): the same view over the range asked for. */
export const teamCalendar =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (caller: Caller, query: CalendarQuery): Promise<Result<CalendarView>> =>
    transact(deps, caller.tenantId, (tx) => calendarIn(tx, deps, caller, query));

/** The year (§10.1): how many people are off on each day, for the heatmap. */
export const yearHeatmap =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  async (
    caller: Caller,
    query: { readonly scope: Scope; readonly year: number; readonly teamKey?: TeamKey | null },
  ): Promise<Result<{ readonly date: CalendarDate; readonly off: number }[]>> => {
    const view = await teamCalendar(deps)(caller, {
      scope: query.scope,
      teamKey: query.teamKey ?? null,
      from: CalendarDate.parse(`${String(query.year)}-01-01`),
      to: CalendarDate.parse(`${String(query.year)}-12-31`),
    });
    if (!view.ok) return view;
    const off = new Map<CalendarDate, Set<PersonId>>();
    for (const e of view.value.entries) {
      for (let day = e.span.from; day <= e.span.to; day = addDays(day, 1)) {
        off.set(day, (off.get(day) ?? new Set()).add(e.personId));
      }
    }
    return ok(
      [...off]
        .map(([date, who]) => ({ date, off: who.size }))
        .toSorted((a, b) => a.date.localeCompare(b.date)),
    );
  };

/** Clicking a day (T14): who is off, holidays and coverage, on that day alone. */
export const dayDetail =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (
    caller: Caller,
    query: {
      readonly scope: Scope;
      readonly date: CalendarDate;
      readonly teamKey?: TeamKey | null;
    },
  ): Promise<Result<CalendarView>> =>
    teamCalendar(deps)(caller, {
      scope: query.scope,
      teamKey: query.teamKey ?? null,
      from: query.date,
      to: query.date,
    });
