import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Avatar,
  Button,
  List,
  ListItem,
  PageSection,
  Skeleton,
  icons,
  type IconName,
} from '@reach/ui';
import { createElement, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { MonthNav } from './month-nav';
import { duration, monthName, shortDate } from './time';
import { t } from '../i18n';
import { Header } from '../frame';
import { ATTENDANCE } from './section';

/**
 * Exceptions for HR (T23, PRD §11.7): only what needs action in a month —
 * missed clock-outs, less rest between days than the rules require, overtime
 * nobody has decided and holidays worked — each with why it matters, and the
 * people behind it beside the list. The labour inspector's record (start,
 * end and breaks per person per day) downloads as CSV or PDF for the month.
 *
 * The month is the address (`?month=`) and so is the kind open beside the
 * list (`?kind=`), each a plain link. Two columns at a desk; under 60rem of
 * its own width the kinds, then the people.
 */

export type ExceptionKind =
  'missed_clock_out' | 'short_rest' | 'overtime_waiting' | 'worked_on_holiday';

export interface ExceptionsData {
  readonly from: string;
  readonly to: string;
  /** `YYYY-MM`, the month on show. */
  readonly month: string;
  readonly restMinutes: number;
  /** The kind open beside the list; the first with anyone in it when absent. */
  readonly kind: string | null;
  readonly items: readonly {
    readonly kind: ExceptionKind;
    readonly date: string;
    readonly minutes: number | null;
    readonly holiday: string | null;
    readonly personId: string;
    readonly displayName: string;
    readonly teamName: string | null;
  }[];
}

export interface ExceptionsProps {
  readonly load: Loadable<ExceptionsData>;
}

const KINDS: readonly ExceptionKind[] = [
  'missed_clock_out',
  'short_rest',
  'overtime_waiting',
  'worked_on_holiday',
];

const ICON: Record<
  ExceptionKind,
  { name: IconName; tone: 'danger' | 'warning' | 'info' | 'neutral' }
> = {
  missed_clock_out: { name: 'pending', tone: 'danger' },
  short_rest: { name: 'night', tone: 'warning' },
  overtime_waiting: { name: 'overtime', tone: 'info' },
  worked_on_holiday: { name: 'calendar', tone: 'neutral' },
};

const icon = (name: IconName): ReactNode => createElement(icons[name], { 'aria-hidden': true });
const monthLabel = (month: string): string => monthName(`${month}-01`);
const people = (n: number): string =>
  t(
    'attendance.exceptions.people',
    { one: '{{count}} person', other: '{{count}} people' },
    { count: n },
  );

type Item = ExceptionsData['items'][number];

/** What each kind is called, why it matters, and what one of it says about its day. */
function words(kind: ExceptionKind, restMinutes: number) {
  const rest = duration(restMinutes);
  return {
    missed_clock_out: {
      title: t('attendance.exceptions.missed_clock_outs', 'Missed clock-outs'),
      why: t(
        'attendance.exceptions.each_days_record_has_to_say',
        'Each day’s record has to say when work ended. Each person is asked when they finished.',
      ),
      line: (i: Item) =>
        t('attendance.exceptions.no_clock_out', '{{date}} · no clock-out', {
          date: shortDate(i.date),
        }),
    },
    short_rest: {
      title: t(
        'attendance.exceptions.less_than_rest_between_days',
        'Less than {{rest}} rest between days',
        { rest },
      ),
      why: t(
        'attendance.exceptions.the_working_time_rules_require_between',
        'The working-time rules require {{rest}} between the end of one day and the start of the next.',
        { rest },
      ),
      line: (i: Item) =>
        t('attendance.exceptions.rest_before_it', '{{date}} · {{duration}} rest before it', {
          date: shortDate(i.date),
          duration: duration(i.minutes ?? 0),
        }),
    },
    overtime_waiting: {
      title: t(
        'attendance.exceptions.overtime_waiting_for_approval',
        'Overtime waiting for approval',
      ),
      why: t(
        'attendance.exceptions.their_managers_decide_it_as_comp',
        'Their managers decide it as comp time or pay before the month closes.',
      ),
      line: (i: Item) =>
        t('attendance.exceptions.over', '{{date}} · {{duration}} over', {
          date: shortDate(i.date),
          duration: duration(i.minutes ?? 0),
        }),
    },
    worked_on_holiday: {
      title: t('attendance.exceptions.worked_on_a_holiday', 'Worked on a holiday'),
      why: t('attendance.exceptions.a_day_in_lieu_is_owed', 'A day in lieu is owed for each one.'),
      line: (i: Item) =>
        i.holiday === null
          ? t('attendance.exceptions.date_holiday', '{{date}} · Holiday', {
              date: shortDate(i.date),
            })
          : t('attendance.exceptions.text', '{{date}} · {{value}}', {
              date: shortDate(i.date),
              value: i.holiday,
            }),
    },
  }[kind];
}

export function Exceptions({ load }: ExceptionsProps): JSX.Element {
  if (load.status === 'loading') return <ExceptionsSkeleton />;
  return (
    <div className="@container/exceptions flex flex-col gap-6">
      {load.status === 'error' ? <Header fallback={ATTENDANCE()} /> : null}
      <Loaded load={load} what={t('attendance.exceptions.the_exceptions', 'the exceptions')}>
        {(data) => <Ready data={data} />}
      </Loaded>
    </div>
  );
}

const body =
  'flex flex-col gap-6 @min-[60rem]/exceptions:grid @min-[60rem]/exceptions:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] @min-[60rem]/exceptions:items-start';

function Ready({ data }: { readonly data: ExceptionsData }): JSX.Element {
  const of = (kind: ExceptionKind): Item[] => data.items.filter((i) => i.kind === kind);
  const open = KINDS.find((k) => k === data.kind) ?? KINDS.find((k) => of(k).length > 0) ?? null;
  const at = (patch: string): string => `/time-off/attendance/exceptions?${patch}`;
  const file = (format: 'csv' | 'pdf'): string =>
    `/time-off/downloads/inspector?from=${data.from}&to=${data.to}&format=${format}`;
  return (
    <>
      <Header fallback={ATTENDANCE()} />
      {/* The month and its export: the view's own, under a header every tab shares. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthNav month={data.month} path="/time-off/attendance/exceptions" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              startIcon={<icons.download aria-hidden />}
              endIcon={<icons.expand aria-hidden />}
            >
              {t(
                'attendance.exceptions.export_for_the_labour_inspector',
                'Export for the labour inspector',
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <a href={file('csv')} download>
                {t('attendance.exceptions.as_a_spreadsheet', 'As a spreadsheet (CSV)')}
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={file('pdf')} download>
                {t('attendance.exceptions.as_a_pdf', 'As a PDF')}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {data.items.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {t('attendance.exceptions.nothing_needs_you_in', 'Nothing needs you in {{monthLabel}}.', {
            monthLabel: monthLabel(data.month),
          })}
        </p>
      ) : (
        <div className={body}>
          <List
            navigable
            aria-label={t('attendance.exceptions.what_needs_action', 'What needs action')}
          >
            {KINDS.map((kind) => {
              const items = of(kind);
              const w = words(kind, data.restMinutes);
              const value =
                kind === 'overtime_waiting'
                  ? duration(items.reduce((n, i) => n + (i.minutes ?? 0), 0))
                  : String(items.length);
              return (
                <ListItem
                  key={kind}
                  asChild
                  icon={icon(ICON[kind].name)}
                  iconTone={ICON[kind].tone}
                  description={w.why}
                  selected={kind === open}
                  trailing={<span className="text-lg font-bold tabular-nums">{value}</span>}
                >
                  <a
                    href={at(`month=${data.month}&kind=${kind}`)}
                    aria-current={kind === open ? 'true' : undefined}
                  >
                    {w.title}
                  </a>
                </ListItem>
              );
            })}
          </List>
          {open === null ? null : (
            <PageSection
              title={words(open, data.restMinutes).title}
              description={people(new Set(of(open).map((i) => i.personId)).size)}
              surface
            >
              {of(open).length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {t('attendance.exceptions.nobody_this_month', 'Nobody this month.')}
                </p>
              ) : (
                <List
                  aria-label={t('attendance.exceptions.by_person', '{{title}}, by person', {
                    title: words(open, data.restMinutes).title,
                  })}
                >
                  {of(open).map((i) => (
                    <ListItem
                      key={`${i.personId} ${i.date}`}
                      leading={<Avatar name={i.displayName} />}
                      description={words(open, data.restMinutes).line(i)}
                      meta={i.teamName ?? undefined}
                    >
                      {i.displayName}
                    </ListItem>
                  ))}
                </List>
              )}
            </PageSection>
          )}
        </div>
      )}
      <p className="text-xs text-fg-muted">
        {t(
          'attendance.exceptions.the_inspectors_record_has_each_persons',
          'The inspector’s record has each person’s start, end and breaks for every day from {{from}} to {{to}}. Never a location.',
          { from: shortDate(data.from), to: shortDate(data.to) },
        )}
      </p>
    </>
  );
}

/** The page while it loads: the header, the month, the kinds and the people beside them. */
export function ExceptionsSkeleton(): JSX.Element {
  return (
    <div className="@container/exceptions flex flex-col gap-6">
      <Header fallback={ATTENDANCE()} />
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">
          {t('attendance.exceptions.loading_the_exceptions', 'Loading the exceptions')}
        </span>
        <Skeleton className="h-9 w-80 rounded-sm" />
        <div className={body}>
          <div className="flex flex-col gap-px overflow-hidden rounded-[1.125rem]">
            {KINDS.map((k) => (
              <Skeleton key={k} className="h-[4.5rem] rounded-none" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
