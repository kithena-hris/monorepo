import { ok, type Result } from '@kithena/domain-kit';
import {
  ASSISTANT_LIMITS,
  isPrivateLeaveType,
  SELF_NAME,
  timeoffCapabilities,
  type AmbiguousResult,
  type CalendarDate,
  type CapabilityFilter,
  type CapabilityInput,
  type CatalogueField,
  type LeaveTypeDefinition,
  type LocationKey,
  type NotFoundResult,
  type PeopleResult,
  type PersonId,
  type RuntimeCatalogue,
} from '@kithena/contracts';

import { days, type Decimal } from '../../domain/days.js';
import type { LeaveRequest } from '../../domain/request/leave-request.js';
import { holidaysFor, runsIn, seesType, sightOf, type Sight } from '../calendar/calendar.js';
import type { Caller, Deps, Member, Tx } from '../ports.js';
import { seesBalances } from '../screens/employee.js';
import { chatAnswersOf } from '../settings/chat.js';
import { applies, balanceFor, isHrAdmin, refuse, transact } from '../shared.js';
import { DENIED } from './denied.js';
import { dayName, longDate, longDay, shortDate } from './words.js';

/**
 * What Time Off answers the assistant (assistant PRD §8, §10.3): read-only
 * queries, run as the asker, over the same sight rule as the calendar. Nothing
 * here decides who may see what a second time; the transport only proves the
 * assistant sent the request (`http/capabilities.ts`).
 */

/**
 * `GET /internal/capabilities`: configuration only — the leave types, the
 * teams the projection holds, Time Off's denied words — never a value from
 * anybody's record. The assistant drops what yields to People and masks what
 * is private before a model sees any of it.
 *
 * A private type is not an option by name: the assistant offers it only as a
 * masked reference (§12.2), and `leaveTypes` says which ones those are.
 */
export const capabilityCatalogue =
  (deps: Pick<Deps, 'uow'>) =>
  (caller: Caller): Promise<Result<RuntimeCatalogue>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const types = (await tx.leaveTypes.list())
        .map((t) => t.definition)
        .toSorted((a, b) => a.name.default.localeCompare(b.name.default));
      const teams = new Map<string, string>();
      for (const m of await tx.members.list()) {
        if (m.status !== 'left' && m.teamKey !== null)
          teams.set(m.teamKey, m.teamName ?? m.teamKey);
      }
      const leaveType: CatalogueField = {
        key: 'leave_type',
        label: 'Leave type',
        kind: 'select',
        options: types
          .filter((t) => !isPrivateLeaveType(t))
          .map((t) => ({ value: t.key, label: t.name.default })),
      };
      const tracked: CatalogueField = {
        ...leaveType,
        options: types
          .filter((t) => t.tracked && !isPrivateLeaveType(t))
          .map((t) => ({ value: t.key, label: t.name.default })),
      };
      const team: CatalogueField = {
        key: 'team',
        label: 'Team',
        kind: 'select',
        options: [...teams]
          .map(([value, label]) => ({ value, label }))
          .toSorted((a, b) => a.label.localeCompare(b.label)),
      };
      return ok({
        module: 'timeoff',
        serves: timeoffCapabilities.map((c) => ({ name: c.name, version: c.version })),
        fields: {
          'timeoff.away': [leaveType, team],
          'timeoff.balances': [tracked, DAYS_LEFT, team],
        },
        metrics: [],
        leaveTypes: types.map((t) => ({
          key: t.key,
          name: t.name.default,
          private: isPrivateLeaveType(t),
          // "Off sick" names a sick_leave type whatever the company called it: without
          // the category the assistant can mask only the name and key (§12.2).
          category: t.category,
        })),
        denied: DENIED.map((d) => ({ key: d.key, labels: [...(d.labels ?? [])] })),
        // Read on every question, so HR switching it off takes effect on the next one.
        chatNamesPrivateLeave: (await chatAnswersOf(tx)).namesPrivateLeave,
      });
    });

/** "More than 10 left": a number, compared with each balance in its own unit. */
const DAYS_LEFT: CatalogueField = {
  key: 'days_left',
  label: 'Days left',
  kind: 'number',
  options: [],
};

/* ---------------------------------------------------------------- shared -- */

type Found = PeopleResult | AmbiguousResult | NotFoundResult;
type Test = (value: string | null, label: string | null) => boolean;

/** Case and accents aside: "omar diaz" is Omar Díaz. */
const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** A filter as a test of a key and its label; a type or team is named by either. */
function testOf(filter: CapabilityFilter): Result<Test> {
  const values = new Set(filter.values.map(fold));
  const has: Test = (value, label) =>
    (value !== null && values.has(fold(value))) || (label !== null && values.has(fold(label)));
  switch (filter.op) {
    case 'is':
    case 'in':
      return ok(has);
    case 'not_in':
      return ok((value, label) => !has(value, label));
    default:
      return refuse('BAD_REQUEST', `A ${filter.key} filter is "is", "in" or "not in"`, ['filters']);
  }
}

/** Everyone the asker may see is HR's "everyone"; anybody else sees part of the company. */
const scopeOf = (hr: boolean): PeopleResult['scope'] => (hr ? 'everyone' : 'visible');

/** The groups `timeoff.away` and `timeoff.managers` declare, by label. */
async function groupsOf(
  tx: Tx,
  member: Member,
  places: Map<string, string>,
): Promise<Record<string, string>> {
  const groups: Record<string, string> = {};
  if (member.teamKey !== null) groups['team'] = member.teamName ?? member.teamKey;
  if (member.locationKey !== null)
    groups['location'] = await placeOf(tx, member.locationKey, places);
  return groups;
}

async function placeOf(tx: Tx, key: LocationKey, places: Map<string, string>): Promise<string> {
  let name = places.get(key);
  if (name === undefined) {
    name = (await tx.locations.get(key))?.name ?? key;
    places.set(key, name);
  }
  return name;
}

/**
 * The members a name in a question means, among those the asker may see: the
 * asker for `@me`, else every member whose name starts word by word as typed,
 * accents and case aside, a single exact match winning. `sees` is checked only
 * for the names that match.
 */
async function named(
  members: readonly Member[],
  name: string,
  caller: Caller,
  sees: (m: Member) => Promise<boolean>,
): Promise<Member[] | AmbiguousResult | NotFoundResult> {
  if (name === SELF_NAME) {
    if (caller.personId === null) return { kind: 'not_found', self: true };
    return members.filter((m) => m.personId === caller.personId);
  }
  const typed = fold(name);
  const words = typed.split(/\s+/u);
  const visible: Member[] = [];
  for (const m of members) {
    const own = fold(m.displayName).split(/\s+/u);
    // oxlint-disable-next-line no-await-in-loop -- sight only for the names that match
    if (words.every((w) => own.some((o) => o.startsWith(w))) && (await sees(m))) visible.push(m);
  }
  const exact = visible.filter((m) => fold(m.displayName) === typed);
  const picked = exact.length === 1 ? exact : visible;
  if (picked.length === 0) return { kind: 'not_found', name };
  if (picked.length > 1) {
    return {
      kind: 'ambiguous',
      name,
      candidates: picked
        .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, ASSISTANT_LIMITS.listed)
        .map((m) => ({ personId: m.personId, name: m.displayName })),
    };
  }
  return picked;
}

/* ---------------------------------------------------------- timeoff.away -- */

/** Approved or taken. A request still waiting is not time off yet, nor is a counter-proposal. */
const AWAY: readonly LeaveRequest['status'][] = ['approved', 'change_pending', 'taken'];

const half = (yes: boolean): string => (yes ? ' (half day)' : '');

/** "Tue 6", "Tue 6, half day", "Mon 12 to Wed 14", "Wed 30 Sep to Fri 2 Oct". */
function runText(run: ReturnType<typeof runsIn>[number]): string {
  if (run.from === run.to) {
    return `${dayName(run.from)}${run.startsHalfDay || run.endsHalfDay ? ', half day' : ''}`;
  }
  const day = run.from.slice(0, 7) === run.to.slice(0, 7) ? dayName : shortDate;
  return `${day(run.from)}${half(run.startsHalfDay)} to ${day(run.to)}${half(run.endsHalfDay)}`;
}

/** A type or team by its key or its label, to say what was asked for. */
const said = (key: string, label: string): [string, string][] => [
  [fold(key), label],
  [fold(label), label],
];

/** "on Tuesday 6 October", "from Monday 12 to Sunday 18 October". */
function period(from: CalendarDate, to: CalendarDate): string {
  if (from === to) return `on ${longDate(from)}`;
  return `from ${from.slice(0, 7) === to.slice(0, 7) ? longDay(from) : longDate(from)} to ${longDate(to)}`;
}

/** What a step selected, from what it was asked: never from what it found. */
function describe(
  filters: readonly CapabilityFilter[],
  on: { readonly from: CalendarDate; readonly to: CalendarDate },
  names: { readonly leave_type: Map<string, string>; readonly team: Map<string, string> },
): string {
  const phrases = ['away'];
  for (const f of filters) {
    const map = f.key === 'leave_type' ? names.leave_type : names.team;
    const said = [...new Set(f.values.flatMap((v) => map.get(fold(v)) ?? []))];
    if (said.length === 0) continue;
    const word = f.key === 'leave_type' ? 'on' : 'in';
    phrases.push(`${f.op === 'not_in' ? `not ${word}` : word} ${said.join(' or ')}`);
  }
  phrases.push(period(on.from, on.to));
  return phrases.join(' ').slice(0, 240);
}

/**
 * `timeoff.away` (assistant PRD §7.1–§7.3, §7.7, §14): who is away in a range,
 * as the asker may see them.
 *
 * Sight is the calendar's (`sightOf`, `seesType`), checked only for members
 * with an absence in the range — the calendar checks everybody, because it
 * draws everybody. **A leave type filter matches only an absence whose type
 * the asker sees**, so somebody who sees a teammate's sick day as "Off" gets
 * the same answer, byte for byte, whether anybody is off sick or nobody is:
 * no count of the rest, no hint that there was one.
 *
 * A private type (sick, parental, or any shown as "Off") is written "Away" in
 * a row's `detail` whoever asks, HR included, because the text goes to a chat
 * app (§11.4) — unless the company chose to name it (AST-029a), and then only
 * where the sight rule already shows the asker the type.
 */
export const away =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (caller: Caller, input: CapabilityInput): Promise<Result<Found>> =>
    transact(deps, caller.tenantId, async (tx): Promise<Result<Found>> => {
      const { on } = input;
      if (on === undefined) return refuse('BAD_REQUEST', 'Away when? A date is required', ['on']);
      const tests: Record<'leave_type' | 'team', Test[]> = { leave_type: [], team: [] };
      for (const filter of input.filters ?? []) {
        if (filter.key !== 'leave_type' && filter.key !== 'team') {
          return refuse('BAD_REQUEST', `timeoff.away has no ${filter.key} filter`, ['filters']);
        }
        const test = testOf(filter);
        if (!test.ok) return test;
        tests[filter.key].push(test.value);
      }

      const hr = await isHrAdmin(deps, caller);
      const naming = (await chatAnswersOf(tx)).namesPrivateLeave;
      const sights = new Map<PersonId, Sight | null>();
      const sight = async (m: Member): Promise<Sight | null> => {
        if (!sights.has(m.personId)) sights.set(m.personId, await sightOf(deps, caller, m, hr));
        return sights.get(m.personId) ?? null;
      };
      const all = await tx.members.list();
      const within = input.personIds === undefined ? null : new Set<string>(input.personIds);
      let members = all.filter(
        (m) =>
          m.status !== 'left' &&
          (within === null || within.has(m.personId)) &&
          tests.team.every((t) => t(m.teamKey, m.teamName)),
      );

      if (input.name !== undefined) {
        const picked = await named(
          members,
          input.name,
          caller,
          async (m) => (await sight(m)) !== null,
        );
        if (!Array.isArray(picked)) return ok(picked);
        members = picked;
      }

      const byId = new Map(members.map((m) => [m.personId, m]));
      const records =
        byId.size === 0
          ? []
          : await tx.requests.list({
              personIds: [...byId.keys()],
              statuses: AWAY,
              from: on.from,
              to: on.to,
            });
      const types = new Map<string, LeaveTypeDefinition>(
        (await tx.leaveTypes.list()).map((t) => [t.definition.key, t.definition]),
      );
      const found = new Map<PersonId, { member: Member; runs: { from: string; text: string }[] }>();
      for (const { request } of records) {
        const m = byId.get(request.personId);
        // oxlint-disable-next-line no-await-in-loop -- one check per member with an absence
        const s = m === undefined ? null : await sight(m);
        if (m === undefined || s === null) continue;
        const type = types.get(request.leaveType.key);
        const name = type?.name.default ?? request.leaveType.key;
        const shown = seesType(s, type?.visibility);
        if (!tests.leave_type.every((t) => shown && t(request.leaveType.key, name))) continue;
        const label =
          shown && type !== undefined && (naming || !isPrivateLeaveType(type)) ? name : 'Away';
        const entry = found.get(m.personId) ?? { member: m, runs: [] };
        for (const run of runsIn(request, on.from, on.to)) {
          entry.runs.push({ from: run.from, text: `${runText(run)} · ${label}` });
        }
        found.set(m.personId, entry);
      }

      const matched = [...found.values()].toSorted((a, b) =>
        a.member.displayName.localeCompare(b.member.displayName),
      );
      const places = new Map<string, string>();
      const rows: PeopleResult['rows'] = [];
      for (const { member, runs } of matched.slice(0, input.limit ?? ASSISTANT_LIMITS.listed)) {
        rows.push({
          personId: member.personId,
          name: member.displayName,
          detail: runs
            .toSorted((a, b) => a.from.localeCompare(b.from))
            .map((r) => r.text)
            .join(', ')
            .slice(0, 200),
          // oxlint-disable-next-line no-await-in-loop -- a location's name once, then remembered
          groups: await groupsOf(tx, member, places),
        });
      }

      // The holidays where the people found work, and where the asker does: from
      // what the asker may see, so they never vary with anybody who is hidden.
      const self = caller.personId === null ? null : await tx.members.get(caller.personId);
      const around = [...matched.map((x) => x.member), ...(self === null ? [] : [self])];
      const notes = new Set<string>();
      for (const h of await holidaysFor(tx, around, on.from, on.to)) {
        // oxlint-disable-next-line no-await-in-loop -- a location's name once, then remembered
        const place = await placeOf(tx, h.locationKey, places);
        notes.add(`${longDate(h.date)} is a public holiday in ${place}.`);
      }

      const names = {
        leave_type: new Map([...types.values()].flatMap((t) => said(t.key, t.name.default))),
        team: new Map(
          all.flatMap((m) => (m.teamKey === null ? [] : said(m.teamKey, m.teamName ?? m.teamKey))),
        ),
      };
      return ok({
        kind: 'people',
        rows,
        ...(input.ids === true
          ? { ids: matched.slice(0, ASSISTANT_LIMITS.ids).map((x) => x.member.personId) }
          : {}),
        total: matched.length,
        scope: scopeOf(hr),
        described: describe(input.filters ?? [], on, names),
        notes: [...notes].slice(0, 5),
      });
    });

/* ------------------------------------------------------ timeoff.managers -- */

/**
 * `timeoff.managers` (assistant PRD §7.5, §8.4): the managers of the people
 * an earlier step found, from the member projection's `managerPersonId`,
 * which Time Off keeps for approvals. Offered only where People is absent;
 * where it is present `people.managers` answers instead.
 *
 * A person the asker has no sight of is left out, and so is a manager they
 * have no sight of. Each manager once, with no count of how many of theirs
 * were found: "Marco — 1" names the one.
 */
export const managers =
  (deps: Pick<Deps, 'uow' | 'authz'>) =>
  (caller: Caller, input: CapabilityInput): Promise<Result<PeopleResult>> =>
    transact(deps, caller.tenantId, async (tx) => {
      const hr = await isHrAdmin(deps, caller);
      const everyone = new Map((await tx.members.list()).map((m) => [m.personId, m]));
      const checked = new Map<PersonId, Member | null>();
      const seen = async (id: PersonId | null): Promise<Member | null> => {
        if (id === null) return null;
        if (!checked.has(id)) {
          const m = everyone.get(id);
          const visible =
            m !== undefined && m.status !== 'left' && (await sightOf(deps, caller, m, hr)) !== null;
          checked.set(id, visible ? m : null);
        }
        return checked.get(id) ?? null;
      };
      const found = new Map<PersonId, Member>();
      for (const id of input.personIds ?? []) {
        // oxlint-disable-next-line no-await-in-loop -- each person's sight, then their manager's, once
        const manager = await seen((await seen(id))?.managerPersonId ?? null);
        if (manager !== null) found.set(manager.personId, manager);
      }

      const matched = [...found.values()].toSorted((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
      const places = new Map<string, string>();
      const rows: PeopleResult['rows'] = [];
      for (const m of matched.slice(0, input.limit ?? ASSISTANT_LIMITS.listed)) {
        // oxlint-disable-next-line no-await-in-loop -- a location's name once, then remembered
        const groups = await groupsOf(tx, m, places);
        // The asker among them: the answer says "(you)".
        const self = m.personId === caller.personId ? { self: true as const } : {};
        rows.push({ personId: m.personId, name: m.displayName, groups, ...self });
      }
      return ok({
        kind: 'people',
        rows,
        ...(input.ids === true ? { ids: matched.map((m) => m.personId) } : {}),
        total: matched.length,
        scope: scopeOf(hr),
        described: 'managers of people',
        notes: [],
      });
    });

/* ------------------------------------------------------ timeoff.balances -- */

const NUMBER = /^-?\d+(?:\.\d+)?$/u;

interface LeftTest {
  readonly test: (left: Decimal) => boolean;
  readonly said: string;
}

/** A `days_left` filter as a test of one balance: more than, fewer than, or exactly. */
function leftOf(filter: CapabilityFilter): Result<LeftTest> {
  const [value, ...rest] = filter.values.map((v) => v.trim());
  if (value === undefined || rest.length > 0 || !NUMBER.test(value)) {
    return refuse('BAD_REQUEST', 'days_left compares with one number', ['filters']);
  }
  const n = days(value);
  switch (filter.op) {
    case 'after':
      return ok({ test: (left) => left.gt(n), said: `more than ${n.toString()}` });
    case 'before':
      return ok({ test: (left) => left.lt(n), said: `less than ${n.toString()}` });
    case 'is':
      return ok({ test: (left) => left.eq(n), said: `exactly ${n.toString()}` });
    default:
      return refuse('BAD_REQUEST', 'days_left is "after", "before" or "is"', ['filters']);
  }
}

/** "12.5 days left", "1 day left", "6 hours left": the fold's own figure, never a float. */
const leftText = (left: Decimal, unit: LeaveTypeDefinition['unit']): string =>
  `${left.toString()} ${unit}${left.eq(1) ? '' : 's'} left`;

/**
 * `timeoff.balances` (assistant PRD §17, Phase 2): how much leave people have
 * left today, as the asker may see balances — their own, the people they
 * approve or cover, HR everyone's (`seesBalances`, the People Graph's rule) —
 * each from the ledger's fold (`balanceFor`) for the leave year today is in,
 * in the member's own zone.
 *
 * The types are those a `leave_type` filter names, else the annual leave
 * types (any tracked type that is not private where a company has none), and
 * only tracked ones that apply to the member. Everybody whose balance the
 * asker sees has `type` sight of them (`sightOf`), so a private type matches
 * its filter; its name is still written "Away" beside a person, as
 * `timeoff.away` writes it, unless the company chose to name it (AST-029a).
 * One type in play reads "12.5 days left"; several name each.
 */
export const balances =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock'>) =>
  (caller: Caller, input: CapabilityInput): Promise<Result<Found>> =>
    transact(deps, caller.tenantId, async (tx): Promise<Result<Found>> => {
      const tests: Record<'leave_type' | 'team', Test[]> = { leave_type: [], team: [] };
      const lefts: LeftTest[] = [];
      for (const filter of input.filters ?? []) {
        if (filter.key === 'days_left') {
          const read = leftOf(filter);
          if (!read.ok) return read;
          lefts.push(read.value);
          continue;
        }
        if (filter.key !== 'leave_type' && filter.key !== 'team') {
          return refuse('BAD_REQUEST', `timeoff.balances has no ${filter.key} filter`, ['filters']);
        }
        const test = testOf(filter);
        if (!test.ok) return test;
        tests[filter.key].push(test.value);
      }

      const hr = await isHrAdmin(deps, caller);
      const naming = (await chatAnswersOf(tx)).namesPrivateLeave;
      const sees = (m: Member): Promise<boolean> => seesBalances(deps, caller, m.personId, hr);
      const all = await tx.members.list();
      const within = input.personIds === undefined ? null : new Set<string>(input.personIds);
      let members = all.filter(
        (m) =>
          m.status !== 'left' &&
          (within === null || within.has(m.personId)) &&
          tests.team.every((t) => t(m.teamKey, m.teamName)),
      );
      if (input.name === undefined) {
        const visible: Member[] = [];
        for (const m of members) {
          // oxlint-disable-next-line no-await-in-loop -- one check per member
          if (await sees(m)) visible.push(m);
        }
        members = visible;
      } else {
        const picked = await named(members, input.name, caller, sees);
        if (!Array.isArray(picked)) return ok(picked);
        members = picked;
      }

      const tracked = (await tx.leaveTypes.list())
        .filter((t) => !t.deleted && t.definition.tracked)
        .map((t) => t.definition)
        .toSorted((a, b) => a.name.default.localeCompare(b.name.default));
      const annual = tracked.filter((t) => t.category === 'annual_leave');
      const asked =
        tests.leave_type.length > 0
          ? tracked.filter((t) => tests.leave_type.every((test) => test(t.key, t.name.default)))
          : annual.length > 0
            ? annual
            : tracked.filter((t) => !isPrivateLeaveType(t));
      const several = asked.length > 1;

      const matched: { member: Member; detail: string }[] = [];
      for (const m of members.toSorted((a, b) => a.displayName.localeCompare(b.displayName))) {
        const today = deps.clock.date(m.timeZone);
        const texts: string[] = [];
        for (const t of asked) {
          if (!applies(t.appliesTo, m)) continue;
          // oxlint-disable-next-line no-await-in-loop -- one fold per member and type
          const left = days((await balanceFor(tx, m, t.key, today)).left);
          if (!lefts.every((l) => l.test(left))) continue;
          const label = naming || !isPrivateLeaveType(t) ? t.name.default : 'Away';
          texts.push(`${leftText(left, t.unit)}${several ? ` · ${label}` : ''}`);
        }
        if (texts.length > 0) matched.push({ member: m, detail: texts.join(', ').slice(0, 200) });
      }

      const places = new Map<string, string>();
      const rows: PeopleResult['rows'] = [];
      for (const { member, detail } of matched.slice(0, input.limit ?? ASSISTANT_LIMITS.listed)) {
        // oxlint-disable-next-line no-await-in-loop -- a location's name once, then remembered
        const groups = await groupsOf(tx, member, places);
        // The asker among them: the answer says "(you)".
        const self = member.personId === caller.personId ? { self: true as const } : {};
        rows.push({ personId: member.personId, name: member.displayName, detail, groups, ...self });
      }

      // What was asked, never what was found: "in Sales with more than 10 days of Vacation left".
      const teams = new Map(
        all.flatMap((m) => (m.teamKey === null ? [] : said(m.teamKey, m.teamName ?? m.teamKey))),
      );
      const inTeams = (input.filters ?? [])
        .filter((f) => f.key === 'team')
        .flatMap((f) => {
          const names = [...new Set(f.values.flatMap((v) => teams.get(fold(v)) ?? []))];
          if (names.length === 0) return [];
          return [`${f.op === 'not_in' ? 'not in' : 'in'} ${names.join(' or ')}`];
        });
      const typeNames = asked.map((t) => t.name.default).join(' or ');
      const unit = asked.length > 0 && asked.every((t) => t.unit === 'hour') ? 'hours' : 'days';
      const balance =
        lefts.length === 0
          ? `with a ${typeNames === '' ? 'leave' : typeNames} balance`
          : `with ${lefts.map((l) => l.said).join(' and ')} ${unit}${typeNames === '' ? '' : ` of ${typeNames}`} left`;
      return ok({
        kind: 'people',
        rows,
        ...(input.ids === true
          ? { ids: matched.slice(0, ASSISTANT_LIMITS.ids).map((x) => x.member.personId) }
          : {}),
        total: matched.length,
        scope: scopeOf(hr),
        described: [...inTeams, balance].join(' ').slice(0, 240),
        notes: [],
      });
    });
