import { icons, type IconName } from '@reach/ui';
import { createElement, type ReactNode } from 'react';

/**
 * The words and looks the manager's screens share (approvals, delegation,
 * the calendar): dates as people say them, a leave type's colour and icon,
 * and the templated sentences that stand in for the assistant's (§14.1)
 * until TOF-086 to TOF-088 write them. Every number in a sentence comes
 * from Time Off; the template only says it.
 */

/* --------------------------------------------------------------- types -- */

export interface Span {
  readonly from: string;
  readonly to: string;
  readonly startsHalfDay: boolean;
  readonly endsHalfDay: boolean;
}

export interface Range {
  readonly from: string;
  readonly to: string;
}

/** A request as a list shows it (`TimeOffRequestItem`). */
export interface RequestItem {
  readonly requestId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly leaveTypeKey: string;
  readonly leaveTypeName: string;
  readonly category: string;
  readonly status: string;
  readonly span: Span;
  readonly spans: readonly Range[];
  /** Decimal string: "5.000". */
  readonly workingDays: string;
  readonly requestedAt: string;
  readonly waitingOn: 'manager' | 'hr' | null;
}

/** "4 of 7 in" on one day (`TimeOffCoverageDay`). */
export interface CoverageDay {
  readonly date: string;
  readonly in: number;
  readonly of: number;
  readonly required: number;
  readonly checked: boolean;
  readonly below: boolean;
}

/** Why a request is in Look closer: the rule that fired and its numbers. */
export interface LookCloser {
  readonly rule:
    'below_zero' | 'over_banked' | 'below_minimum' | 'protected_period' | 'sick_over_threshold';
  /** Days below zero, hours short, or sick days, by rule. */
  readonly amount: string | null;
  readonly days: readonly string[];
}

/** The calendar over a range, as the viewer may see it (`TimeOffCalendar`). */
export interface CalendarView {
  readonly from: string;
  readonly to: string;
  readonly people: readonly {
    readonly personId: string;
    readonly displayName: string;
    readonly teamKey: string | null;
    readonly teamName: string | null;
  }[];
  readonly entries: readonly {
    readonly requestId: string;
    readonly personId: string;
    readonly span: Span;
    readonly status: string;
    /** `null`: the viewer sees "Off" and nothing else. */
    readonly leaveTypeKey: string | null;
  }[];
  readonly holidays: readonly {
    readonly date: string;
    readonly name: string;
    readonly locationKey: string;
  }[];
  /** Every day of a team with a minimum; empty otherwise. */
  readonly coverage: readonly CoverageDay[];
}

/** Waiting on somebody: drawn outlined and hatched. */
export const tentative = (status: string): boolean =>
  status === 'pending' || status === 'change_pending' || status === 'counter_proposed';

/** A leave type as the screens colour it: the request panel's list. */
export interface LeaveTypeLook {
  readonly key: string;
  readonly name: string;
  readonly colorToken: string;
  readonly icon: string;
}

/* ---------------------------------------------------------------- look -- */

export type Tone =
  'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' | 'chart-5' | 'chart-6' | 'neutral';

/** A leave type's colour as a series tone; anything else is neutral. */
export function chartTone(token: string | undefined): Tone {
  return token !== undefined && /^chart-[1-6]$/.test(token) ? (token as Tone) : 'neutral';
}

/** Time Off's icon names for leave types, as Reach's words for them. */
const LEAVE_ICONS: Record<string, IconName> = {
  sun: 'vacation',
  coffee: 'break',
  thermometer: 'sick',
  baby: 'parental',
  timer: 'overtime',
  'circle-slash': 'unpaid',
  plane: 'travel',
  flag: 'flagged',
};

export function leaveIcon(name: string | undefined): ReactNode {
  return createElement(icons[LEAVE_ICONS[name ?? ''] ?? 'leave'], { 'aria-hidden': true });
}

/** How a leave type looks, or "Off" in grey when the viewer may not see which. */
export function lookOf(
  types: readonly LeaveTypeLook[],
  key: string | null,
): { readonly name: string; readonly tone: Tone; readonly icon: ReactNode } {
  const type = key === null ? undefined : types.find((t) => t.key === key);
  return {
    name: type?.name ?? 'Off',
    tone: chartTone(type?.colorToken),
    icon: leaveIcon(type?.icon),
  };
}

/* --------------------------------------------------------------- dates -- */

/** "11.500" as "11.5": a decimal string, through a float for nothing. */
export const amount = (value: string): string =>
  value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

/** "5 days", "1 day", "0.5 days". */
export function dayCount(value: string): string {
  const n = amount(value);
  return `${n} ${n === '1' ? 'day' : 'days'}`;
}

/** Calendar dates are dates: read and written in UTC, so no zone moves them a day. */
const format = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
export const asDate = (date: string): Date => new Date(`${date}T00:00:00Z`);
export const isoOf = (at: Date): string => at.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const at = asDate(date);
  at.setUTCDate(at.getUTCDate() + n);
  return isoOf(at);
}

/** Monday is 0. */
export const weekdayOf = (date: string): number => (asDate(date).getUTCDay() + 6) % 7;
export const isWeekend = (date: string): boolean => weekdayOf(date) >= 5;
export const mondayOf = (date: string): string => addDays(date, -weekdayOf(date));
export const daysBetween = (from: string, to: string): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000);

/** Every date from `from` to `to`, inclusive. */
export function datesIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) out.push(day);
  return out;
}

/** "Wed 21 Oct". */
export const shortDate = (date: string): string =>
  format({ weekday: 'short', day: 'numeric', month: 'short' }).format(asDate(date));
/** "Wed 21". */
export const dayName = (date: string): string =>
  format({ weekday: 'short', day: 'numeric' }).format(asDate(date));
/** "Wednesday 21 October". */
export const longDate = (date: string): string =>
  format({ weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(date));
/** "21 Oct". */
export const dayMonth = (date: string): string =>
  format({ day: 'numeric', month: 'short' }).format(asDate(date));
/** "October 2026", from "2026-10". */
export const monthName = (month: string): string =>
  format({ month: 'long', year: 'numeric' }).format(asDate(`${month}-01`));

/** "19–23 Oct", "28 Sep – 2 Oct", "9 Oct". */
export function spanLabel(from: string, to: string): string {
  if (from === to) return dayMonth(from);
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${format({ day: 'numeric' }).format(asDate(from))}–${dayMonth(to)}`
    : `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** "19, 20, 22, 23 and 26 Oct": days in one list, the month said once where it can be. */
export function daysLabel(dates: readonly string[]): string {
  if (dates.length === 0) return '';
  const sameMonth = dates.every((d) => d.slice(0, 7) === dates[0]?.slice(0, 7));
  const each = dates.map((d) =>
    sameMonth ? format({ day: 'numeric' }).format(asDate(d)) : dayMonth(d),
  );
  const list =
    each.length === 1
      ? (each[0] ?? '')
      : `${each.slice(0, -1).join(', ')} and ${each.at(-1) ?? ''}`;
  return sameMonth ? `${list} ${format({ month: 'short' }).format(asDate(dates[0] ?? ''))}` : list;
}

/** When something was sent, from where the server stood: "Today 08:10", "Sent yesterday". */
export function sentLabel(at: string, now: string, zone = 'Europe/Madrid'): string {
  const local = (iso: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: zone, dateStyle: 'short' }).format(new Date(iso));
  const days = daysBetween(local(at), local(now));
  if (days <= 0) {
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at));
    return `Today ${time}`;
  }
  return days === 1 ? 'Sent yesterday' : `${String(days)} days ago`;
}

/** The weekday `n` working days after `date`. ponytail: Monday to Friday, until the member's pattern crosses. */
export function workingDaysAfter(date: string, n: number): string {
  let day = date;
  for (let left = n; left > 0;) {
    day = addDays(day, 1);
    if (!isWeekend(day)) left -= 1;
  }
  return day;
}

/* ------------------------------------------------------------ sentences -- */

/** The first name, for a sentence about someone. */
export const firstName = (displayName: string): string => displayName.split(' ')[0] ?? displayName;

/** Look closer's one line, templated from the rule that fired (TOF-086 writes it). */
export function lookCloserLine(reason: LookCloser, item: RequestItem): string {
  const who = firstName(item.displayName);
  const days = reason.days.map(shortDate);
  switch (reason.rule) {
    case 'below_minimum':
      return `Below the team minimum on ${listOf(days)}.`;
    case 'below_zero':
      return `Would take ${who} to −${amount(reason.amount ?? '0')} days. Needs HR after you.`;
    case 'over_banked':
      return `${amount(reason.amount ?? '0')}h more than ${who} has banked.`;
    case 'protected_period':
      return `Falls in a protected period on ${listOf(days)}.`;
    case 'sick_over_threshold':
      return `${dayCount(reason.amount ?? item.workingDays)} off sick, so a note is needed.`;
  }
}

/** Clear to approve's one line: why nothing needs a second look. */
export function clearLine(item: RequestItem): string {
  if (item.category === 'sick') return 'Self-certified, under the days that need a note.';
  return 'Within balance, and the team stays at or above its minimum.';
}

export function listOf(parts: readonly string[]): string {
  return parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}
