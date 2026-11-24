import { dateFormat, formatNumber } from '@reach/ui';

import { t } from './t';

/**
 * Time Off on Home: who of the team is away, now and next, and the reader's
 * own time off. Plain data, worded here, for a module that draws Home (as
 * `homeToDo` is for the Inbox): People's Home draws rows it is handed and
 * never learns what a leave request is.
 *
 * Pure: the read is `people-area.tsx`'s. Dates are calendar dates,
 * compared as text and formatted in UTC so no zone moves a day.
 */

const DAY_MS = 86_400_000;
const noon = (day: string): number => Date.parse(`${day}T12:00:00Z`);
const SHORT = dateFormat({ weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

interface Span {
  readonly from: string;
  readonly to: string;
}

/** What Home reads of `TimeOffOverview`. */
export interface OverviewAnswer {
  readonly balances: readonly {
    readonly leaveTypeKey: string;
    readonly name: string;
    readonly unit: 'day' | 'hour';
    readonly left: string;
  }[];
  readonly comingUp: readonly {
    readonly requestId: string;
    readonly leaveTypeName: string;
    readonly status: string;
    readonly span: Span;
    readonly workingDays: string;
    readonly waitingOn: 'manager' | 'hr' | null;
  }[];
  readonly member: { readonly personId: string } | null;
}

/** What Home reads of `TimeOffCalendarTimeline`. */
export interface TimelineAnswer {
  readonly entries: readonly {
    readonly personId: string;
    readonly status: string;
    readonly span: Span;
  }[];
  readonly people: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly teamName: string | null;
  }[];
}

/** Whose time off Home's widget can show: Time Off's own calendar scopes. */
export type AwayScope = 'team' | 'company';

export interface HomeAway {
  /** The team's calendar. */
  readonly href: string;
  /** Whose time off this is, and what else can be asked for, in words. */
  readonly scope: AwayScope;
  readonly scopes: readonly { readonly key: AwayScope; readonly label: string }[];
  /** How many are away in all: `people` may be the first of them. */
  readonly total: number;
  readonly people: readonly {
    readonly id: string;
    readonly name: string;
    /** "Team" they are in, when Time Off names one. */
    readonly team?: string;
    /** "Today – Wed 25 Nov", "Mon 30 Nov – Fri 4 Dec". */
    readonly when: string;
    /** "Back Thu 26 Nov", "In 8 days". */
    readonly detail: string;
    /** Away today. */
    readonly now: boolean;
  }[];
}

export interface HomeLeave {
  /** Their requests. */
  readonly href: string;
  /** Asking for time off. */
  readonly requestHref: string;
  readonly balances: readonly {
    readonly key: string;
    readonly name: string;
    /** "11.5". */
    readonly left: string;
    /** "days left", "hours left". */
    readonly unit: string;
    readonly href: string;
  }[];
  readonly requests: readonly {
    readonly id: string;
    /** The leave type: "Vacation". */
    readonly title: string;
    readonly when: string;
    /** "3 working days · waiting for your manager". */
    readonly detail: string;
    readonly status: string;
    readonly tone: 'success' | 'warning' | 'info' | 'neutral';
    readonly href: string;
  }[];
}

const day = (date: string): string => SHORT.format(noon(date));
const shift = (date: string, days: number): string =>
  new Date(noon(date) + days * DAY_MS).toISOString().slice(0, 10);
const between = (from: string, to: string): number => Math.round((noon(to) - noon(from)) / DAY_MS);

/** "Today", "Today – Wed 25 Nov", "Mon 30 Nov – Fri 4 Dec". */
function span({ from, to }: Span, today: string): string {
  const start = from <= today ? t('lib.home-time-off.today', 'Today') : day(from);
  return to === from || (from <= today && to === today) ? start : `${start} – ${day(to)}`;
}

/** Leave that is happening: agreed, taken, or agreed and being changed. */
const AWAY = new Set(['approved', 'taken', 'change_pending']);

/** How many Home is handed: its widget shows the first few and opens the rest in a list. */
const LIMIT = 50;

/** Who is away today, then who is next, soonest first; never the reader. */
export function homeAway(
  timeline: TimelineAnswer,
  today: string,
  me: string | null,
  scope: AwayScope = 'team',
): HomeAway {
  const names = new Map(timeline.people.map((p) => [p.personId, p]));
  // One row a person: what they are on now, else what starts first.
  const first = new Map<string, Span>();
  for (const e of timeline.entries.toSorted((a, b) => a.span.from.localeCompare(b.span.from))) {
    if (!AWAY.has(e.status) || e.span.to < today || e.personId === me) continue;
    if (!first.has(e.personId)) first.set(e.personId, e.span);
  }
  return {
    href: '/time-off/calendar/month',
    scope,
    scopes: [
      { key: 'team', label: t('lib.home-time-off.my_team', 'My team') },
      { key: 'company', label: t('lib.home-time-off.whole_company', 'Whole company') },
    ],
    total: first.size,
    people: [...first]
      .toSorted(([, a], [, b]) => a.from.localeCompare(b.from))
      .slice(0, LIMIT)
      .map(([id, s]) => {
        const person = names.get(id);
        const now = s.from <= today;
        return {
          id,
          name: person?.displayName ?? t('lib.home-time-off.somebody', 'Somebody'),
          ...(person?.teamName == null ? {} : { team: person.teamName }),
          when: span(s, today),
          detail: now
            ? t('lib.home-time-off.back_day', 'Back {{day}}', { day: day(shift(s.to, 1)) })
            : t(
                'lib.home-time-off.in_days',
                { one: 'In {{count}} day', other: 'In {{count}} days' },
                { count: between(today, s.from) },
              ),
          now,
        };
      }),
  };
}

const STATUS: Readonly<
  Record<string, { label: () => string; tone: HomeLeave['requests'][number]['tone'] }>
> = {
  approved: { label: () => t('lib.home-time-off.approved', 'Approved'), tone: 'success' },
  taken: { label: () => t('lib.home-time-off.taken', 'Taken'), tone: 'neutral' },
  pending: { label: () => t('lib.home-time-off.pending', 'Pending'), tone: 'warning' },
  change_pending: {
    label: () => t('lib.home-time-off.change_pending', 'Change pending'),
    tone: 'warning',
  },
  counter_proposed: {
    label: () => t('lib.home-time-off.new_dates_proposed', 'New dates proposed'),
    tone: 'info',
  },
};

/** The reader's balances and the time off they have coming up. */
export function homeLeave(overview: OverviewAnswer, today: string): HomeLeave {
  return {
    href: '/time-off/requests',
    requestHref: '/time-off/request',
    balances: overview.balances.slice(0, 2).map((b) => ({
      key: b.leaveTypeKey,
      name: b.name,
      left: formatNumber(Number(b.left), { maximumFractionDigits: 1 }),
      unit:
        b.unit === 'hour'
          ? t('lib.home-time-off.hours_left', 'hours left')
          : t('lib.home-time-off.days_left', 'days left'),
      href: `/time-off/balances/${b.leaveTypeKey}`,
    })),
    requests: overview.comingUp.slice(0, LIMIT).map((r) => {
      const status = STATUS[r.status];
      const days = Number(r.workingDays);
      return {
        id: r.requestId,
        title: r.leaveTypeName,
        when: span(r.span, today),
        detail: [
          t(
            'lib.home-time-off.working_days',
            { one: '{{shown}} working day', other: '{{shown}} working days' },
            { count: days, shown: formatNumber(days, { maximumFractionDigits: 1 }) },
          ),
          r.waitingOn === 'manager'
            ? t('lib.home-time-off.waiting_for_your_manager', 'waiting for your manager')
            : r.waitingOn === 'hr'
              ? t('lib.home-time-off.waiting_for_hr', 'waiting for HR')
              : null,
        ]
          .filter((x) => x !== null)
          .join(' · '),
        status: status?.label() ?? r.status,
        tone: status?.tone ?? 'neutral',
        href: `/time-off/requests/${r.requestId}`,
      };
    }),
  };
}
