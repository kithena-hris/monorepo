import {
  Avatar,
  Button,
  List,
  ListItem,
  PageHeader,
  PageSection,
  Skeleton,
  icons,
  type IconName,
} from '@reach/ui';
import { createElement, type JSX, type ReactNode } from 'react';

import { Loaded, type Loadable } from '../load';
import { duration, shortDate } from './time';

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
const monthLabel = (month: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${month}-01T00:00:00Z`),
  );
const shiftMonth = (month: string, by: number): string => {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const people = (n: number): string => (n === 1 ? '1 person' : `${String(n)} people`);

type Item = ExceptionsData['items'][number];

/** What each kind is called, why it matters, and what one of it says about its day. */
function words(kind: ExceptionKind, restMinutes: number) {
  const rest = duration(restMinutes);
  return {
    missed_clock_out: {
      title: 'Missed clock-outs',
      why: 'Each day’s record has to say when work ended. Each person is asked when they finished.',
      line: (i: Item) => `${shortDate(i.date)} · no clock-out`,
    },
    short_rest: {
      title: `Less than ${rest} rest between days`,
      why: `The working-time rules require ${rest} between the end of one day and the start of the next.`,
      line: (i: Item) => `${shortDate(i.date)} · ${duration(i.minutes ?? 0)} rest before it`,
    },
    overtime_waiting: {
      title: 'Overtime waiting for approval',
      why: 'Their managers decide it as comp time or pay before the month closes.',
      line: (i: Item) => `${shortDate(i.date)} · ${duration(i.minutes ?? 0)} over`,
    },
    worked_on_holiday: {
      title: 'Worked on a holiday',
      why: 'A day in lieu is owed for each one.',
      line: (i: Item) => `${shortDate(i.date)} · ${i.holiday ?? 'Holiday'}`,
    },
  }[kind];
}

export function Exceptions({ load }: ExceptionsProps): JSX.Element {
  if (load.status === 'loading') return <ExceptionsSkeleton />;
  return (
    <div className="@container/exceptions flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Attendance" /> : null}
      <Loaded load={load} what="the exceptions">
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
      <PageHeader
        title="Attendance"
        description={`Everyone · ${monthLabel(data.month)}`}
        actions={
          <>
            <Button asChild variant="secondary" startIcon={<icons.download aria-hidden />}>
              <a href={file('csv')} download>
                Export for the labour inspector
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href={file('pdf')} download aria-label="Export for the labour inspector as PDF">
                PDF
              </a>
            </Button>
          </>
        }
      />
      <nav aria-label="Month" className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost" startIcon={<icons.previous aria-hidden />}>
          <a href={at(`month=${shiftMonth(data.month, -1)}`)}>
            {monthLabel(shiftMonth(data.month, -1))}
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost" endIcon={<icons.next aria-hidden />}>
          <a href={at(`month=${shiftMonth(data.month, 1)}`)}>
            {monthLabel(shiftMonth(data.month, 1))}
          </a>
        </Button>
      </nav>
      {data.items.length === 0 ? (
        <p className="text-sm text-fg-muted">{`Nothing needs you in ${monthLabel(data.month)}.`}</p>
      ) : (
        <div className={body}>
          <List navigable aria-label="What needs action">
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
                <p className="text-sm text-fg-muted">Nobody this month.</p>
              ) : (
                <List aria-label={`${words(open, data.restMinutes).title}, by person`}>
                  {of(open).map((i) => (
                    <ListItem
                      key={`${i.personId} ${i.date}`}
                      leading={<Avatar name={i.displayName} />}
                      description={words(open, data.restMinutes).line(i)}
                      meta={i.teamName ?? undefined}
                      trailing={
                        <Button asChild size="xs" variant="secondary">
                          <a
                            href={`/time-off/attendance/timesheets?person=${i.personId}&week=${i.date}`}
                            aria-label={`Open ${i.displayName}’s ${shortDate(i.date)}`}
                          >
                            Open
                          </a>
                        </Button>
                      }
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
        {`The inspector’s record has each person’s start, end and breaks for every day from ${shortDate(data.from)} to ${shortDate(data.to)}. Never a location.`}
      </p>
    </>
  );
}

/** The page while it loads: the header, the month, the kinds and the people beside them. */
export function ExceptionsSkeleton(): JSX.Element {
  return (
    <div className="@container/exceptions flex flex-col gap-6">
      <PageHeader title="Attendance" description={' '} />
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">Loading the exceptions</span>
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
