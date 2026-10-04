import { ok, type Result } from '@kithena/domain-kit';
import { CalendarDate, type DayAmount, type LeaveTypeKey } from '@kithena/contracts';

import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { addDays, addMonths, amount, days as amountOf, type DateRange } from '../../domain/days.js';
import { dateOptions, type TeamDay } from '../../domain/request/options.js';
import type { Caller, Deps } from '../ports.js';
import { LIVE, teamCoverage } from '../request/assess.js';
import { balanceFor, calendarOf, forbidden, notFound, transact } from '../shared.js';
import { requestPanel } from '../screens/employee.js';
import type { DescribedView } from '../screens/views.js';
import { written, type Line } from './written.js';
import { listOf, shortDate, spanLabel } from './words.js';

/**
 * Describe it, get the best dates (TOF-090, T4, MT8, PRD §14.2).
 *
 * The sentence becomes five choices the person can edit — the type, about how
 * many days, the month, next to a holiday, not when the team is short. TypeSafe
 * reads them when there is a key, choosing only among options the code
 * offered; Time Off's own rules read them otherwise, and anything the person
 * set by hand wins over both. The domain then generates the date options and
 * scores them (`domain/request/options.ts`), and the writer says what each one
 * gets the person. Nothing is sent: picking one opens the ordinary request
 * panel with its dates.
 *
 * A sentence that mentions health is never shown to a model: the rules read
 * it, and sick leave is never one of the types offered.
 */

export interface DescribeQuery {
  readonly sentence?: string | undefined;
  readonly leaveTypeKey?: LeaveTypeKey | undefined;
  readonly days?: number | undefined;
  readonly month?: string | undefined;
  readonly nextToHoliday?: boolean | undefined;
  readonly avoidShort?: boolean | undefined;
}

export interface Understood {
  readonly leaveTypeKey: LeaveTypeKey | null;
  readonly days: number;
  /** `YYYY-MM`, or `null` for the next three months. */
  readonly month: string | null;
  readonly nextToHoliday: boolean;
  readonly avoidShort: boolean;
}

const HEALTH =
  /\b(sick|ill|illness|unwell|doctor|medical|hospital|surgery|operation|pregnan\w*|diagnos\w*|therapy|clinic|injur\w*)\b/iu;
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
const NUMBERS: Record<string, number> = {
  a: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ten: 10,
};

/** The month a month's name next means from `today`: October 2026, or March 2027. */
const nextMonth = (index: number, today: CalendarDate): string => {
  const year = Number(today.slice(0, 4)) + (index + 1 < Number(today.slice(5, 7)) ? 1 : 0);
  return `${String(year)}-${String(index + 1).padStart(2, '0')}`;
};

/** Time Off's own reading of the sentence: words it knows, nothing it guesses. */
export function readByRules(
  sentence: string,
  types: readonly {
    readonly key: LeaveTypeKey;
    readonly name: string;
    readonly category: string;
  }[],
  today: CalendarDate,
): Understood {
  const text = sentence.toLowerCase();
  const named = types.find(
    (t) => text.includes(t.name.toLowerCase()) || text.includes(t.key.replaceAll('_', ' ')),
  );
  const annual = types.find((t) => t.category === 'annual_leave');
  const weeks = /(\d+|a|one|two|three|four)\s+weeks?/u.exec(text);
  const dayCount = /(\d+|a|one|two|three|four|five|six|ten)\s+(working\s+)?days?/u.exec(text);
  const count = (word: string | undefined): number => Number(word) || NUMBERS[word ?? ''] || 1;
  const days = /fortnight/u.test(text)
    ? 10
    : weeks !== null
      ? count(weeks[1]) * 5
      : dayCount !== null
        ? count(dayCount[1])
        : /long weekend/u.test(text)
          ? 1
          : 5;
  const month = MONTHS.findIndex((m) => new RegExp(`\\b${m}\\b`, 'u').test(text));
  return {
    leaveTypeKey: named?.key ?? annual?.key ?? types[0]?.key ?? null,
    days: Math.min(30, Math.max(1, days)),
    month:
      month >= 0
        ? nextMonth(month, today)
        : /next month/u.test(text)
          ? addMonths(CalendarDate.parse(`${today.slice(0, 7)}-01`), 1).slice(0, 7)
          : null,
    nextToHoliday:
      /(next to|around|near|beside|with) a (public |bank )?holiday|bridge|puente|long weekend/u.test(
        text,
      ),
    avoidShort: /\bteam\b|short|minimum|cover|busy/u.test(text),
  };
}

const LENGTHS: Record<string, string> = {
  '1': 'One day, or a long weekend',
  '2': 'Two days',
  '3': 'Three days',
  '4': 'Four days',
  '5': 'About a week',
  '10': 'About two weeks',
  '15': 'About three weeks',
  unclear: 'The sentence does not say how long',
};

async function readByModel(
  judge: NonNullable<Deps['judge']>,
  tenantId: string,
  sentence: string,
  types: readonly { readonly key: LeaveTypeKey; readonly name: string }[],
  today: CalendarDate,
): Promise<Partial<Understood>> {
  const first = CalendarDate.parse(`${today.slice(0, 7)}-01`);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(first, i).slice(0, 7));
  const answers = await judge.choose(tenantId, {
    state: {
      sentence,
      today: `${MONTHS[Number(today.slice(5, 7)) - 1] ?? ''} ${today.slice(0, 4)}`,
    },
    questions: {
      type: {
        instructions: 'Which kind of time off does `sentence` ask for?',
        options: {
          ...Object.fromEntries(types.map((t) => [t.key, t.name])),
          unclear: 'It does not say',
        },
      },
      length: {
        instructions: 'About how many working days does `sentence` ask for?',
        options: LENGTHS,
      },
      month: {
        instructions: 'In which month does `sentence` want the time off?',
        options: {
          ...Object.fromEntries(
            months.map((m) => [m, `${MONTHS[Number(m.slice(5)) - 1] ?? ''} ${m.slice(0, 4)}`]),
          ),
          none: 'No month is named',
        },
      },
      holiday: {
        instructions: 'Does `sentence` want the time off next to a public holiday?',
        options: { yes: 'Yes, next to or around a public holiday', no: 'No' },
      },
      team: {
        instructions: 'Does `sentence` ask to avoid days when the team would be short of people?',
        options: { yes: 'Yes', no: 'No' },
      },
    },
  });
  const sure = (id: string): string | undefined => {
    const a = answers.get(id);
    return a !== undefined && a.confidence >= 0.5 ? a.choice : undefined;
  };
  const type = sure('type');
  const length = sure('length');
  const month = sure('month');
  const holiday = sure('holiday');
  const team = sure('team');
  return {
    ...(type === undefined || type === 'unclear' ? {} : { leaveTypeKey: type as LeaveTypeKey }),
    ...(length === undefined || length === 'unclear' ? {} : { days: Number(length) }),
    ...(month === undefined ? {} : { month: month === 'none' ? null : month }),
    ...(holiday === undefined ? {} : { nextToHoliday: holiday === 'yes' }),
    ...(team === undefined ? {} : { avoidShort: team === 'yes' }),
  };
}

/** The window a month gives, never before tomorrow; the next three months without one. */
function windowOf(month: string | null, today: CalendarDate): DateRange | null {
  const tomorrow = addDays(today, 1);
  if (month === null) return { from: tomorrow, to: addDays(today, 91) };
  const first = CalendarDate.parse(`${month}-01`);
  const last = addDays(addMonths(first, 1), -1);
  if (last < tomorrow) return null;
  return { from: first > tomorrow ? first : tomorrow, to: last };
}

const lineTemplate = (o: {
  used: number;
  away: { days: number };
  holidayNames: string[];
}): string =>
  `${String(o.used)} ${o.used === 1 ? 'day' : 'days'} for ${String(o.away.days)} days away${
    o.holidayNames.length === 0 ? '' : `, with ${listOf(o.holidayNames)}`
  }.`;

export const describeRequest =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'judge' | 'writer'>) =>
  async (caller: Caller, query: DescribeQuery): Promise<Result<DescribedView>> => {
    // The panel refuses an account Time Off holds no member for, in words.
    const panel = await requestPanel(deps)(caller, {});
    if (!panel.ok) return panel;
    const types = panel.value.leaveTypes.filter((t) => t.category !== 'sick_leave');
    const sentence = query.sentence?.trim() ?? '';
    const read = await transact(deps, caller.tenantId, async (tx) => {
      const me = await tx.members.get(caller.personId as NonNullable<Caller['personId']>);
      return me === null ? notFound('Member') : ok(me);
    });
    if (!read.ok) return read;
    const me = read.value;
    const today = deps.clock.date(me.timeZone);

    const ruled = readByRules(sentence, types, today);
    const modelled =
      deps.judge !== undefined && sentence !== '' && !HEALTH.test(sentence)
        ? await readByModel(deps.judge, caller.tenantId, sentence, types, today)
        : {};
    const ai = Object.keys(modelled).length > 0;
    const asked: Understood = {
      ...ruled,
      ...modelled,
      ...(query.leaveTypeKey === undefined ? {} : { leaveTypeKey: query.leaveTypeKey }),
      ...(query.days === undefined ? {} : { days: query.days }),
      ...(query.month === undefined ? {} : { month: query.month === '' ? null : query.month }),
      ...(query.nextToHoliday === undefined ? {} : { nextToHoliday: query.nextToHoliday }),
      ...(query.avoidShort === undefined ? {} : { avoidShort: query.avoidShort }),
    };
    const type = types.find((t) => t.key === asked.leaveTypeKey) ?? types[0];
    const window = windowOf(asked.month, today);

    const found = await transact(deps, caller.tenantId, async (tx) => {
      if (type === undefined || window === null)
        return ok({ options: [], left: null, names: new Map<string, string>() });
      const calendar = await calendarOf(tx, me, window.from, window.to);
      const booked = (
        await tx.requests.list({ personIds: [me.personId], statuses: LIVE, from: window.from })
      ).flatMap((r) => r.request.spans.map((s) => ({ from: s.from, to: s.to })));
      const team = new Map<CalendarDate, TeamDay>(
        (await teamCoverage(tx, me, window.from, addDays(window.to, 31), [], null)).map((c) => [
          c.date,
          c,
        ]),
      );
      const keys = me.locationKey === null ? [] : await tx.holidays.assigned(me.locationKey);
      const layers = (await tx.holidays.layers()).filter((l) => keys.includes(l.key));
      const names = new Map<string, string>();
      for (const y of [Number(window.from.slice(0, 4)), Number(window.to.slice(0, 4)) + 1]) {
        for (const h of resolveHolidays(layers, y)) names.set(h.date, h.name);
        for (const h of resolveHolidays(layers, y - 1)) names.set(h.date, h.name);
      }
      const left: DayAmount | null = type.tracked
        ? (await balanceFor(tx, me, type.key, today)).left
        : null;
      return ok({
        options: dateOptions({
          calendar,
          window,
          days: asked.days,
          booked,
          team,
          nextToHoliday: asked.nextToHoliday,
          avoidShort: asked.avoidShort,
        }),
        left,
        names,
      });
    });
    if (!found.ok) return found;
    const { options, left, names } = found.value;
    const shaped = options.map((o) => ({
      ...o,
      holidayNames: o.holidays.map((date) => names.get(date) ?? 'a holiday'),
    }));
    const lines: Record<string, Line> = Object.fromEntries(
      shaped.map((o, i) => [
        `o${String(i)}`,
        {
          about:
            'What these dates get the person, in under 18 words: the break they buy, and the ' +
            'holiday or the team when that matters.',
          template: lineTemplate(o),
        },
      ]),
    );
    const out = await written(
      deps.writer,
      caller.tenantId,
      {
        instruction:
          'An employee described the time off they want. The system generated and ranked these ' +
          'date options; write a line for each, to the employee as “you”.',
        facts: {
          options: shaped.map((o, i) => ({
            line: `o${String(i)}`,
            dates: spanLabel(o.from, o.to),
            daysUsed: o.used,
            awayFrom: shortDate(o.away.from),
            awayTo: shortDate(o.away.to),
            daysAway: o.away.days,
            holidays: o.holidayNames,
            fewestIn: o.fewest?.in ?? null,
            teamOf: o.fewest?.of ?? null,
            shortOn: o.short.map((s) => shortDate(s.date)),
          })),
        },
      },
      lines,
    );
    return ok({
      sentence: sentence === '' ? null : sentence,
      understood: {
        leaveTypeKey: type?.key ?? null,
        leaveTypeName: type?.name ?? null,
        days: asked.days,
        month: asked.month,
        nextToHoliday: asked.nextToHoliday,
        avoidShort: asked.avoidShort,
        ai,
      },
      leaveTypes: types.map((t) => ({ key: t.key, name: t.name })),
      left,
      options: shaped.map((o, i) => ({
        from: o.from,
        to: o.to,
        used: o.used,
        away: o.away,
        holidays: o.holidays.map((date, j) => ({ date, name: o.holidayNames[j] ?? '' })),
        short: o.short.map((s) => ({ ...s, checked: true, below: true })),
        fewest: o.fewest,
        fits: left === null || amountOf(left).gte(o.used),
        leftAfter: left === null ? null : amount(amountOf(left).minus(o.used)),
        line: out[`o${String(i)}`] ?? { text: lineTemplate(o), ai: false },
      })),
    });
  };
