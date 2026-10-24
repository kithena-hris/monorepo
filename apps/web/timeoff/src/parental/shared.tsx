import {
  dateFormat,
  TimelineChart,
  type TimelineEntry,
  type TimelineMove,
  type TimelineRow,
} from '@reach/ui';
import type { JSX } from 'react';
import { t } from '../i18n';

/**
 * What the parental screens share (T8–T11, MT11, MT12): the plan's shape as
 * Time Off sends it, the track it is drawn on, and the words for its dates.
 * Every number is Time Off's; these only lay it out and say it.
 */

export type ParentRole = 'birth_parent' | 'other_parent' | 'adopting';
export type TeamSees = 'type' | 'away';
export type BlockKind = 'mandatory' | 'flexible' | 'vacation' | 'company' | 'later';

export interface Entitlement {
  readonly law: string;
  readonly mandatoryWeeks: number;
  readonly flexibleWeeks: number;
  readonly flexibleBefore: string;
  readonly laterWeeks: number;
  readonly laterBefore: string;
  readonly startsFrom: string;
  readonly paidBy: string;
  readonly payPercent: number;
  readonly companyWeeks: number;
  readonly companyAfterYears: number | null;
  readonly vacationAccrues: boolean;
  readonly noticeDays: number;
}

export interface Block {
  readonly kind: BlockKind;
  readonly leaveTypeKey: string;
  readonly from: string;
  readonly to: string;
  readonly workingDays: string;
  readonly paidBy: string;
  readonly payPercent: number;
}

export interface Plan {
  readonly planId: string;
  readonly status: 'draft' | 'submitted' | 'approved';
  readonly role: ParentRole;
  readonly childDate: string;
  readonly dueDate: string | null;
  readonly birth: string | null;
  readonly singleParent: boolean;
  readonly children: number;
  readonly teamSees: TeamSees;
  readonly handover: readonly { readonly work: string; readonly coveredBy: string }[];
  readonly blocks: readonly Block[];
  readonly keptWeeks: number;
  readonly reminders: readonly { readonly blockFrom: string; readonly remindOn: string }[];
  readonly problems: readonly { readonly code: string; readonly message: string }[];
  readonly entitlement: Entitlement;
  readonly sentAt: string | null;
  readonly approvedAt: string | null;
  /** Why the plan has this shape (TOF-092): the model's words, or Time Off's template. */
  readonly explanation?: { readonly text: string; readonly ai: boolean };
}

export interface Member {
  readonly personId: string;
  readonly displayName: string;
  readonly firstName: string;
  readonly teamName: string | null;
}

/* -------------------------------------------------------------- dates -- */

/** Calendar dates are dates: read and written in UTC, so no zone moves them a day. */
const format = (options: Intl.DateTimeFormatOptions) => dateFormat({ ...options, timeZone: 'UTC' });
const asDate = (date: string): Date => new Date(`${date.slice(0, 10)}T00:00:00Z`);
const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (date: string, n: number): string => {
  const d = asDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
/** Days from `from` to `to`, both counted, as Time Off counts a block. */
export const length = (from: string, to: string): number =>
  Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000) + 1;

/** "14 Jan 2027" */
export const longDate = (date: string): string =>
  format({ day: 'numeric', month: 'short', year: 'numeric' }).format(asDate(date));
/** "Thu, 14 Jan 2027" */
export const dayDate = (date: string): string =>
  format({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(
    asDate(date),
  );
/** "14 Jan" */
export const shortDate = (date: string): string =>
  format({ day: 'numeric', month: 'short' }).format(asDate(date));
export const year = (date: string): string => date.slice(0, 4);
/** "14 Jan – 24 Feb", "2–22 Aug" */
export function spanLabel(from: string, to: string): string {
  if (from === to) return shortDate(from);
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${format({ day: 'numeric' }).format(asDate(from))}–${shortDate(to)}`
    : t('parental.shared.text_2', '{{from}} – {{to}}', {
        from: shortDate(from),
        to: shortDate(to),
      });
}
/** "6 weeks", "4 days" */
export function duration(from: string, to: string): string {
  const days = length(from, to);
  if (days % 7 === 0)
    return days === 7
      ? t('parental.shared.1_week', '1 week')
      : t('parental.shared.weeks', '{{value}} weeks', { value: String(days / 7) });
  return t(
    'parental.shared.days',
    { one: '{{count}} day', other: '{{count}} days' },
    { count: days },
  );
}
export const weeks = (n: number): string =>
  t('parental.shared.weeks_2', { one: '{{count}} week', other: '{{count}} weeks' }, { count: n });

/* -------------------------------------------------------------- words -- */

export const PAYER: Record<string, string> = {
  social_security: t('parental.shared.social_security', 'Social Security'),
  employer: t('parental.shared.your_company', 'Your company'),
};

export const LANE: Record<BlockKind, string> = {
  mandatory: t('parental.shared.mandatory', 'Mandatory'),
  flexible: t('parental.shared.flexible', 'Flexible'),
  vacation: t('parental.shared.vacation', 'Vacation'),
  company: t('parental.shared.company_weeks', 'Company weeks'),
  later: t('parental.shared.later_weeks', 'Later weeks'),
};

const TONE: Record<BlockKind, NonNullable<TimelineEntry['tone']>> = {
  mandatory: 'chart-3',
  flexible: 'chart-3',
  later: 'chart-3',
  vacation: 'chart-1',
  company: 'chart-2',
};

/** The last day away before the weeks kept for later: the day after it is back at work. */
export function backOn(plan: Pick<Plan, 'blocks'>): string | null {
  const sorted = plan.blocks.toSorted((a, b) => a.from.localeCompare(b.from));
  let last: Block | undefined;
  for (const b of sorted) {
    if (last !== undefined && b.from > addDays(last.to, 1)) break;
    last = b;
  }
  return last === undefined ? null : addDays(last.to, 1);
}

/** Statutory weeks the law gives, and the company's on top. */
export const lawWeeks = (e: Entitlement): number =>
  e.mandatoryWeeks + e.flexibleWeeks + e.laterWeeks;

/* -------------------------------------------------------------- track -- */

const firstOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;
const endOfMonth = (date: string): string => {
  const d = asDate(firstOfMonth(date));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return iso(d);
};

/**
 * The plan on its year (T9, T11): a lane per kind of week over a fixed axis
 * from the child's month to the month flexible weeks end, so it holds still
 * while a block moves. The mandatory weeks are pinned to the birth; the weeks
 * not booked are drawn hatched to the axis's end. `onMove` is a drag in whole
 * weeks; without it nothing moves.
 */
export function PlanTrack({
  plan,
  onMove,
}: {
  readonly plan: Plan;
  readonly onMove?: (index: number, from: string, to: string) => void;
}): JSX.Element {
  const e = plan.entitlement;
  const domain = {
    start: firstOfMonth(e.startsFrom < plan.childDate ? plan.childDate : e.startsFrom),
    end: endOfMonth(e.flexibleBefore),
  };
  const indexed = plan.blocks.map((b, i) => ({ b, i }));
  const lane = (kind: BlockKind, label: string): TimelineRow => ({
    label,
    items: indexed
      .filter(({ b }) => b.kind === kind)
      .map(({ b, i }) => ({
        id: String(i),
        label: t('parental.shared.text_3', '{{from}} · {{spanLabel}}', {
          from: duration(b.from, b.to),
          spanLabel: spanLabel(b.from, b.to),
        }),
        start: b.from,
        end: b.to,
        tone: TONE[kind],
        locked: kind === 'mandatory' || onMove === undefined,
      })),
  });
  const back = backOn(plan);
  const lastDay = plan.blocks.reduce((max, b) => (b.to > max ? b.to : max), plan.childDate);
  const kept: TimelineEntry[] =
    plan.keptWeeks > 0 && lastDay < domain.end
      ? [
          {
            id: 'kept',
            label: `${weeks(plan.keptWeeks)} until ${year(e.laterBefore)}`,
            start: addDays(lastDay, 1),
            end: domain.end,
            tone: 'chart-3',
            tentative: true,
            locked: true,
          },
        ]
      : [];
  const rows: TimelineRow[] = [
    lane('mandatory', LANE.mandatory),
    lane(
      'flexible',
      t('parental.shared.flexible_weeks', 'Flexible, {{weeks}}', { weeks: weeks(e.flexibleWeeks) }),
    ),
    ...(plan.blocks.some((b) => b.kind === 'vacation') ? [lane('vacation', LANE.vacation)] : []),
    ...(e.companyWeeks > 0 ? [lane('company', LANE.company)] : []),
    {
      ...lane('later', t('parental.shared.kept_for_later', 'Kept for later')),
      items: [...lane('later', '').items, ...kept],
    },
  ];
  const markers = [
    {
      date: plan.childDate,
      label:
        plan.birth === null
          ? t('parental.shared.due', 'Due {{childDate}}', { childDate: shortDate(plan.childDate) })
          : t('parental.shared.born', 'Born {{childDate}}', {
              childDate: shortDate(plan.childDate),
            }),
    },
    ...(back === null
      ? []
      : [
          {
            date: back,
            label: t('parental.shared.back', 'Back {{back}}', { back: shortDate(back) }),
          },
        ]),
    {
      date: addDays(e.flexibleBefore, -1),
      label: t('parental.shared.flexible_weeks_end', 'Flexible weeks end'),
    },
  ];
  return (
    <TimelineChart
      variant="track"
      label={t('parental.shared.your_plan', 'Your plan')}
      rows={rows}
      domain={domain}
      snapDays={7}
      labelWidth={150}
      markers={markers}
      editable={onMove !== undefined}
      formatDate={longDate}
      onItemMove={(move: TimelineMove) => {
        if (move.to.end === undefined) return;
        onMove?.(Number(move.id), move.to.start, move.to.end);
      }}
    />
  );
}
