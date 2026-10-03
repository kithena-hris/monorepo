'use client';

import { TriangleAlert } from 'lucide-react';
import { useState, type CSSProperties, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Badge } from '../badge/badge';
import { parseIsoDate } from '../calendar/calendar';
import { formatMinutes, layoutEvents, type Minutes } from './scheduler-model';

/**
 * Week and day grids for interviews, rotas and meetings, and an agenda list.
 *
 * Presentational. It draws the events it is given where they belong and says
 * nothing about how they got there: fetching, creating, dragging and deciding
 * what counts as a clash are the caller's. Overlapping events sit side by side;
 * one the caller marks as a `clash` also gets a red outline.
 *
 * ### Columns are days or people
 *
 * A column is an id and a label. `dayColumns()` makes a week of calendar dates,
 * and a column per room or per interviewer makes the same grid a resource
 * view. Events name their column by id.
 *
 * ### No clock inside
 *
 * Times are minutes past midnight and days are calendar `date` strings, so
 * nothing here has a time zone to drift in. "Now" is a prop: the caller reads
 * its injected clock and passes the minute in, which is what lets a story or a
 * test pin the red line to 10:30.
 *
 * ### Under a finger
 *
 * A week of columns does not fit a phone held upright, so under a coarse
 * pointer the grid shows one column at a time and a strip of day buttons picks
 * which. It is the same grid; the strip is only there when there is more than
 * one column to pick from.
 *
 * ### Rows of days
 *
 * `variant="rows"` turns the grid on its side: a row per person or resource
 * and a column per day, with an event as a bar from its `column` to its
 * `endColumn`. Columns can be shaded (a weekend, a holiday) or marked as a
 * clash, a row can be highlighted, and `summaryRow` adds a count per day that
 * turns into a badge below a minimum. Times are ignored; a bar covers whole
 * days. Bars in one row are expected not to overlap.
 *
 * ### A month
 *
 * `view="month"` lays the columns out in weeks, Monday first, so the columns
 * are the days of a month (`dayColumns(first, 31)`). Each day shows its events
 * as chips, as many as `maxChips` and then "+N more", and with `onSelect` a
 * day can be picked.
 */

export type SchedulerTone =
  | 'neutral'
  | 'accent'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6';

export interface SchedulerColumn {
  id: string;
  /** `Wed 14`, or a person's or a room's name. */
  label: string;
  /** The strip button's two lines under a finger. Default to the label. */
  weekday?: string;
  day?: string;
  /** Read by assistive tech in place of the label: `Wednesday 14 October`. */
  fullLabel?: string;
  /**
   * Rows and month: `muted` fills the column (a day off), `hatched` stripes it
   * (a holiday). Say why in `note`.
   */
  shade?: 'muted' | 'hatched';
  /** Rows and month: the column in the danger wash. Say why in `note`. */
  clash?: boolean;
  /** Rows and month: what is special about the day, read out and, in a month, printed. */
  note?: string;
}

/** A row of `variant="rows"`: a person, a room. */
export interface SchedulerRow {
  id: string;
  label: string;
  /** Drawn before the label: an `Avatar`. */
  leading?: ReactNode;
  /** Washed in the accent: the row being looked at. */
  highlighted?: boolean;
}

/** The count per day under `variant="rows"`. */
export interface SchedulerSummaryRow {
  /** `In`, `Available`. */
  label: string;
  /** Keyed by column id. A column with no value is left blank. */
  values: Readonly<Record<string, number>>;
  /** A value below this is drawn as a danger badge. */
  minimum?: number;
  /** Read after a value below the minimum. */
  belowLabel?: string;
}

export interface SchedulerEvent {
  id: string;
  /** The id of the column it belongs in. */
  column: string;
  /** Minutes past midnight. */
  start: Minutes;
  end: Minutes;
  title: string;
  /** A second line: who, or where. */
  detail?: string;
  tone?: SchedulerTone;
  /** Outlined in red. The caller decides what a clash is. */
  clash?: boolean;
  /** Spans the visible day, and reads "All day" in the agenda. */
  allDay?: boolean;
  /** Rows: the row it sits in. */
  row?: string;
  /** Rows and month: the last column it covers, inclusive. Defaults to `column`. */
  endColumn?: string;
  /** Rows and month: not confirmed yet. Hatched in a row, outlined as a chip, and said in `detail`. */
  tentative?: boolean;
}

export interface SchedulerProps {
  columns: readonly SchedulerColumn[];
  events: readonly SchedulerEvent[];
  /** Names the schedule for assistive tech. */
  label: string;
  /**
   * `grid` draws the hours; `agenda` lists the events day by day; `month`
   * lays the day columns out in weeks.
   */
  view?: 'grid' | 'agenda' | 'month';
  /** `rows`: a row per `rows` entry and a column per day, events as bars. */
  variant?: 'columns' | 'rows';
  rows?: readonly SchedulerRow[];
  /** Rows: a count per day under the rows. */
  summaryRow?: SchedulerSummaryRow;
  /** Month: the selected day, outlined in the accent. */
  selected?: string;
  /** Month: makes each day a button. */
  onSelect?: (column: string) => void;
  /** Month: chips shown in a day before "+N more". */
  maxChips?: number;
  /** First hour shown, 0 to 23. */
  startHour?: number;
  /** Hour the grid ends at, exclusive. */
  endHour?: number;
  /** The column that is today, drawn in the accent. */
  today?: string;
  /** Minutes past midnight now, for the red line in `today`'s column. From the caller's clock. */
  now?: Minutes;
  /** The column shown under a finger. Uncontrolled when omitted. */
  column?: string;
  onColumnChange?: (column: string) => void;
  className?: string;
}

/** Fill, text and the bar down the event's leading edge, per tone. */
const toneClass: Record<SchedulerTone, string> = {
  neutral: 'bg-surface-sunken text-fg before:bg-fg-subtle',
  accent: 'bg-accent-subtle text-accent-fg before:bg-accent',
  info: 'bg-info-subtle text-info-fg before:bg-info',
  success: 'bg-success-subtle text-success-fg before:bg-success',
  warning: 'bg-warning-subtle text-warning-fg before:bg-warning',
  danger: 'bg-danger-subtle text-danger-fg before:bg-danger',
  // The categorical tones have no subtle step, so the wash is the tone itself
  // thinned, and the text stays the ink colour that holds on any wash.
  'chart-1': 'bg-chart-1/20 text-fg before:bg-chart-1',
  'chart-2': 'bg-chart-2/20 text-fg before:bg-chart-2',
  'chart-3': 'bg-chart-3/20 text-fg before:bg-chart-3',
  'chart-4': 'bg-chart-4/20 text-fg before:bg-chart-4',
  'chart-5': 'bg-chart-5/20 text-fg before:bg-chart-5',
  'chart-6': 'bg-chart-6/20 text-fg before:bg-chart-6',
};

const barClass: Record<SchedulerTone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
};

/** The edge of a tentative bar or chip, which has no wash of its own. */
const ringClass: Record<SchedulerTone, string> = {
  neutral: 'ring-fg-subtle',
  accent: 'ring-accent',
  info: 'ring-info',
  success: 'ring-success',
  warning: 'ring-warning',
  danger: 'ring-danger',
  'chart-1': 'ring-chart-1',
  'chart-2': 'ring-chart-2',
  'chart-3': 'ring-chart-3',
  'chart-4': 'ring-chart-4',
  'chart-5': 'ring-chart-5',
  'chart-6': 'ring-chart-6',
};

// The hatch is a mask, which would stripe the cell's text too, so it is
// painted on a layer behind the content rather than on the cell itself.
const shadeClass = {
  muted: 'bg-surface-sunken',
  hatched:
    'isolate before:absolute before:inset-0 before:-z-10 before:bg-surface-active before:pattern-hatched',
} as const;

/** Whether an event covers a column, by position in `columns`. */
function covers(event: SchedulerEvent, index: number, order: ReadonlyMap<string, number>): boolean {
  const first = order.get(event.column);
  const last = order.get(event.endColumn ?? event.column) ?? first;
  return first !== undefined && last !== undefined && index >= first && index <= last;
}

export function Scheduler({
  columns,
  events,
  label,
  view = 'grid',
  startHour = 9,
  endHour = 17,
  today,
  now,
  column,
  onColumnChange,
  variant = 'columns',
  rows = [],
  summaryRow,
  selected,
  onSelect,
  maxChips = 3,
  className,
}: SchedulerProps): JSX.Element {
  const [ownColumn, setOwnColumn] = useState(today ?? columns[0]?.id ?? '');
  // A column that is not on the grid (today, on a resource view) falls back to
  // the first, or a phone would be shown no column at all.
  const wanted = column ?? ownColumn;
  const shown = columns.some((entry) => entry.id === wanted) ? wanted : columns[0]?.id;
  const pick = (id: string): void => {
    if (column === undefined) setOwnColumn(id);
    onColumnChange?.(id);
  };

  if (view === 'agenda') {
    return <Agenda columns={columns} events={events} label={label} className={className} />;
  }
  if (view === 'month') {
    return (
      <Month
        columns={columns}
        events={events}
        label={label}
        today={today}
        selected={selected}
        onSelect={onSelect}
        maxChips={maxChips}
        className={className}
      />
    );
  }
  if (variant === 'rows') {
    return (
      <Rows
        columns={columns}
        rows={rows}
        events={events}
        label={label}
        today={today}
        summaryRow={summaryRow}
        className={className}
      />
    );
  }

  const from = startHour * 60;
  const span = Math.max(endHour * 60 - from, 60);
  const hours = Array.from({ length: span / 60 }, (_, index) => startHour + index);
  const timed = events.map((event) =>
    event.allDay ? { ...event, start: from, end: from + span } : event,
  );
  const slots = layoutEvents(timed);
  /** A fraction of the visible day, clamped so an early start still shows. */
  const place = (minutes: Minutes): number => Math.min(Math.max((minutes - from) / span, 0), 1);

  return (
    <section
      aria-label={label}
      className={cn('overflow-hidden rounded-lg bg-surface shadow-sm', className)}
    >
      {columns.length > 1 ? (
        <div className="hidden gap-1.5 p-2 touch:flex">
          {columns.map((entry) => {
            const on = entry.id === shown;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={on}
                aria-label={entry.fullLabel ?? entry.label}
                onClick={() => {
                  pick(entry.id);
                }}
                className={cn(
                  'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md',
                  'transition-colors duration-(--animate-duration-fast)',
                  on ? 'bg-accent-solid text-fg-on-accent' : 'bg-surface-sunken text-fg',
                )}
              >
                <span className="text-xs font-medium">{entry.weekday ?? entry.label}</span>
                {entry.day ? (
                  <span className="text-md leading-none font-bold">{entry.day}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className="grid grid-cols-[3rem_repeat(var(--reach-columns),minmax(0,1fr))] touch:grid-cols-[3rem_minmax(0,1fr)]"
        style={{ '--reach-columns': columns.length } as CSSProperties}
      >
        {/* The header row: an empty corner, then the column names. */}
        <span aria-hidden className="border-b border-border" />
        {columns.map((entry) => (
          <span
            key={entry.id}
            aria-hidden
            className={cn(
              'truncate border-b border-border px-1.5 py-2.5 text-center text-xs font-semibold',
              entry.id === today ? 'text-accent-fg' : 'text-fg-muted',
              entry.id !== shown && 'touch:hidden',
            )}
          >
            {entry.label}
          </span>
        ))}

        {/* The hour gutter. */}
        <div aria-hidden>
          {hours.map((hour) => (
            <span
              key={hour}
              className="block h-10 border-t border-border pe-2 pt-1 text-end text-2xs font-medium text-fg-muted tabular-nums first:border-t-0 touch:h-12"
            >
              {formatMinutes(hour * 60)}
            </span>
          ))}
        </div>

        {columns.map((entry) => {
          const mine = timed.filter((event) => event.column === entry.id);
          return (
            <div
              key={entry.id}
              className={cn(
                'relative border-s border-border',
                entry.id !== shown && 'touch:hidden',
              )}
            >
              {hours.map((hour) => (
                <span
                  key={hour}
                  aria-hidden
                  className="block h-10 border-t border-border first:border-t-0 touch:h-12"
                />
              ))}

              <ul aria-label={entry.fullLabel ?? entry.label} className="absolute inset-0">
                {mine.map((event) => {
                  const slot = slots.get(event.id) ?? { lane: 0, lanes: 1 };
                  const top = place(event.start);
                  const height = Math.max(place(event.end) - top, 0);
                  return (
                    <li
                      key={event.id}
                      className={cn(
                        'absolute overflow-hidden rounded-xs py-1.5 ps-2.5 pe-2 text-xs leading-tight font-semibold',
                        'before:absolute before:inset-y-0 before:start-0 before:w-[3px]',
                        toneClass[event.tone ?? 'accent'],
                        event.clash && 'outline-2 -outline-offset-2 outline-danger',
                      )}
                      style={{
                        top: `calc(${String(top * 100)}% + 2px)`,
                        height: `calc(${String(height * 100)}% - 4px)`,
                        insetInlineStart: `calc(${String((slot.lane / slot.lanes) * 100)}% + 3px)`,
                        width: `calc(${String(100 / slot.lanes)}% - 6px)`,
                      }}
                    >
                      <span className="sr-only">
                        {event.allDay
                          ? 'All day, '
                          : `${formatMinutes(event.start)} to ${formatMinutes(event.end)}, `}
                      </span>
                      {event.title}
                      {event.detail ? (
                        <span className="block font-normal">{event.detail}</span>
                      ) : null}
                      {event.clash ? <span className="sr-only">, clashes</span> : null}
                    </li>
                  );
                })}
              </ul>

              {entry.id === today && now !== undefined && now >= from && now <= from + span ? (
                <span
                  aria-hidden
                  className="absolute inset-x-0 z-10 h-0.5 bg-danger before:absolute before:-start-1 before:-top-[3px] before:size-2 before:rounded-full before:bg-danger"
                  style={{ top: `${String(place(now) * 100)}%` }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Agenda({
  columns,
  events,
  label,
  className,
}: {
  columns: readonly SchedulerColumn[];
  events: readonly SchedulerEvent[];
  label: string;
  className?: string | undefined;
}): JSX.Element {
  return (
    <section
      aria-label={label}
      className={cn('overflow-hidden rounded-lg bg-surface pb-1.5 shadow-sm', className)}
    >
      {columns.map((entry) => {
        const mine = events
          .filter((event) => event.column === entry.id)
          .toSorted(
            (a, b) => Number(b.allDay ?? false) - Number(a.allDay ?? false) || a.start - b.start,
          );
        if (mine.length === 0) return null;
        return (
          <div key={entry.id}>
            <h3 className="px-4.5 pt-3 pb-1.5 text-xs font-semibold text-fg-muted touch:px-4">
              {entry.label}
            </h3>
            <ul>
              {mine.map((event) => (
                <li key={event.id} className="flex items-stretch gap-3 px-4.5 py-2.5 touch:px-4">
                  <span className="w-14 shrink-0 self-center text-sm font-semibold text-fg-muted tabular-nums">
                    {event.allDay ? 'All day' : formatMinutes(event.start)}
                  </span>
                  <span
                    aria-hidden
                    className={cn('w-1 shrink-0 rounded-full', barClass[event.tone ?? 'accent'])}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg touch:text-base">
                      {event.title}
                    </span>
                    {event.detail ? (
                      <span className="block text-xs text-fg-muted">{event.detail}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** What a bar or a chip is, said in words: its days, its title, its detail. */
function spoken(event: SchedulerEvent, columns: readonly SchedulerColumn[]): string {
  const name = (id: string): string => {
    const entry = columns.find((candidate) => candidate.id === id);
    return entry?.fullLabel ?? entry?.label ?? id;
  };
  const days =
    event.endColumn && event.endColumn !== event.column
      ? `${name(event.column)} to ${name(event.endColumn)}`
      : name(event.column);
  return [days, event.title, event.detail].filter(Boolean).join(', ');
}

function Rows({
  columns,
  rows,
  events,
  label,
  today,
  summaryRow,
  className,
}: {
  columns: readonly SchedulerColumn[];
  rows: readonly SchedulerRow[];
  events: readonly SchedulerEvent[];
  label: string;
  today: string | undefined;
  summaryRow: SchedulerSummaryRow | undefined;
  className: string | undefined;
}): JSX.Element {
  const order = new Map(columns.map((entry, index) => [entry.id, index]));
  // One template for every line, so the header, the rows and the summary share
  // their columns without being one grid.
  const line =
    'grid grid-cols-[12.5rem_repeat(var(--reach-columns),minmax(0,1fr))] border-b border-border touch:grid-cols-[4.75rem_repeat(var(--reach-columns),minmax(0,1fr))]';
  const noted = columns.filter((entry) => entry.note);

  /** The shading behind a row, one cell per column. */
  const backdrop = columns.map((entry, index) => (
    <span
      key={entry.id}
      aria-hidden
      className={cn(
        'relative border-e border-border',
        entry.clash ? 'bg-danger/13' : entry.shade ? shadeClass[entry.shade] : undefined,
      )}
      style={{ gridRow: 1, gridColumn: index + 2 }}
    />
  ));

  return (
    <section
      aria-label={label}
      className={cn('overflow-hidden rounded-lg bg-surface shadow-sm', className)}
      style={{ '--reach-columns': columns.length } as CSSProperties}
    >
      <div aria-hidden className={cn(line, 'h-11.5 items-center touch:h-9.5')}>
        <span />
        {columns.map((entry) => {
          const isToday = entry.id === today;
          return (
            <span
              key={entry.id}
              className={cn(
                'flex flex-col items-center gap-1 text-2xs leading-none font-semibold',
                isToday ? 'text-accent-fg' : entry.shade ? 'text-fg-subtle' : 'text-fg-muted',
              )}
            >
              <span className="text-[0.5625rem] font-medium">
                {(entry.weekday ?? entry.label).slice(0, 1)}
              </span>
              <span
                className={cn(
                  'grid size-5 place-items-center rounded-full',
                  isToday && 'bg-accent-solid text-fg-on-accent',
                )}
              >
                {entry.day ?? entry.label}
              </span>
            </span>
          );
        })}
      </div>

      {noted.length > 0 ? (
        <ul className="sr-only">
          {noted.map((entry) => (
            <li key={entry.id}>
              {entry.fullLabel ?? entry.label}: {entry.note}
            </li>
          ))}
        </ul>
      ) : null}

      <ul>
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(line, 'h-12 touch:h-11', row.highlighted && 'bg-accent-subtle')}
          >
            <span
              className={cn(
                'flex min-w-0 items-center gap-2.5 ps-4.5 text-sm touch:gap-1.5 touch:ps-2.5 touch:text-xs',
                row.highlighted ? 'font-semibold' : 'font-medium',
              )}
              style={{ gridRow: 1, gridColumn: 1 }}
            >
              {row.leading}
              <span className="truncate">{row.label}</span>
            </span>
            {backdrop}
            {events
              .filter((event) => event.row === row.id && order.has(event.column))
              .map((event) => {
                const first = order.get(event.column) ?? 0;
                const last = order.get(event.endColumn ?? event.column) ?? first;
                const tone = event.tone ?? 'accent';
                return (
                  <span
                    key={event.id}
                    className={cn(
                      'relative isolate z-[1] mx-0.5 flex h-6.5 items-center self-center overflow-hidden rounded-sm ps-2.5 pe-2 text-2xs leading-none font-semibold whitespace-nowrap touch:h-5',
                      'before:absolute before:inset-y-0 before:start-0 before:w-[3px]',
                      toneClass[tone],
                      event.tentative &&
                        cn('bg-transparent ring-[1.5px] ring-inset', ringClass[tone]),
                      event.clash && 'outline-2 -outline-offset-2 outline-danger',
                    )}
                    style={{ gridRow: 1, gridColumn: `${String(first + 2)} / ${String(last + 3)}` }}
                  >
                    {event.tentative ? (
                      <span
                        aria-hidden
                        className={cn(
                          'absolute inset-0 -z-10 opacity-30 pattern-hatched',
                          barClass[tone],
                        )}
                      />
                    ) : null}
                    <span className="sr-only">{spoken(event, columns)}</span>
                    {/* The title fits a bar two days long at a desk; shorter,
                        or under a finger, it is only read out. */}
                    {last > first ? (
                      <span aria-hidden className="truncate touch:hidden">
                        {event.title}
                      </span>
                    ) : null}
                  </span>
                );
              })}
          </li>
        ))}
      </ul>

      {summaryRow ? (
        <div className={cn(line, 'h-10.5 items-center border-b-0')}>
          <span className="ps-4.5 text-xs font-semibold text-fg-muted touch:ps-2.5">
            {summaryRow.label}
          </span>
          {columns.map((entry) => {
            const value = summaryRow.values[entry.id];
            if (value === undefined) return <span key={entry.id} />;
            const below = summaryRow.minimum !== undefined && value < summaryRow.minimum;
            return (
              <span
                key={entry.id}
                className="grid place-items-center text-xs font-bold text-fg-muted tabular-nums"
              >
                <span className="sr-only">{entry.fullLabel ?? entry.label}: </span>
                {below ? (
                  <Badge tone="danger" variant="solid" size="xs">
                    {value}
                  </Badge>
                ) : (
                  value
                )}
                {below && summaryRow.belowLabel ? (
                  <span className="sr-only">, {summaryRow.belowLabel}</span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function Month({
  columns,
  events,
  label,
  today,
  selected,
  onSelect,
  maxChips,
  className,
}: {
  columns: readonly SchedulerColumn[];
  events: readonly SchedulerEvent[];
  label: string;
  today: string | undefined;
  selected: string | undefined;
  onSelect: ((column: string) => void) | undefined;
  maxChips: number;
  className: string | undefined;
}): JSX.Element {
  const order = new Map(columns.map((entry, index) => [entry.id, index]));
  /** Monday is 0. The columns are calendar dates in this view. */
  const weekday = (id: string): number => (new Date(parseIsoDate(id)).getUTCDay() + 6) % 7;
  const lead = columns[0] ? weekday(columns[0].id) : 0;
  const cells: (SchedulerColumn | null)[] = [...Array<null>(lead).fill(null), ...columns];
  while (cells.length % 7 !== 0) cells.push(null);
  // The weekday names come from the columns themselves, which already carry
  // them in the caller's locale.
  const names = Array.from({ length: 7 }, () => '');
  for (const entry of columns) names[weekday(entry.id)] ||= entry.weekday ?? '';

  return (
    <section
      aria-label={label}
      className={cn('overflow-hidden rounded-lg bg-surface shadow-sm', className)}
    >
      <div aria-hidden className="grid grid-cols-7 border-b border-border">
        {names.map((name, index) => (
          <span key={index} className="p-3 text-xs font-semibold text-fg-subtle touch:p-2">
            {name}
          </span>
        ))}
      </div>
      <ol className="grid grid-cols-7">
        {cells.map((entry, index) => {
          if (!entry) {
            return <li key={`blank-${String(index)}`} aria-hidden className="bg-surface-sunken" />;
          }
          const position = order.get(entry.id) ?? -1;
          const mine = events.filter((event) => covers(event, position, order));
          const isSelected = entry.id === selected;
          const isToday = entry.id === today;
          const name = entry.fullLabel ?? entry.label;
          return (
            <li
              key={entry.id}
              className={cn(
                'relative flex h-32 min-w-0 flex-col gap-1 overflow-hidden p-2 touch:h-14 touch:p-1',
                'shadow-[inset_-1px_-1px_0_var(--reach-color-border)]',
                isSelected
                  ? 'bg-accent-subtle shadow-[inset_0_0_0_2px_var(--reach-color-accent)]'
                  : entry.clash
                    ? 'bg-danger/10'
                    : entry.shade
                      ? shadeClass[entry.shade]
                      : undefined,
              )}
            >
              <div className="flex min-h-6 items-center gap-1.5">
                {onSelect ? (
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={[name, entry.note].filter(Boolean).join(', ')}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => {
                      onSelect(entry.id);
                    }}
                    className={cn(
                      // Stretched over the cell: the day is the target, the
                      // number is what it looks like.
                      'after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-border-focus',
                      dayNumber(isToday, Boolean(entry.shade)),
                    )}
                  >
                    {entry.day ?? entry.label}
                  </button>
                ) : (
                  <span className={dayNumber(isToday, Boolean(entry.shade))}>
                    <span aria-hidden>{entry.day ?? entry.label}</span>
                    <span className="sr-only">{[name, entry.note].filter(Boolean).join(', ')}</span>
                  </span>
                )}
                {entry.clash ? (
                  <TriangleAlert aria-hidden className="ms-auto size-3.5 shrink-0 text-danger-fg" />
                ) : null}
              </div>
              {entry.note ? (
                <span
                  aria-hidden
                  className="truncate text-2xs leading-tight font-semibold text-fg-muted touch:hidden"
                >
                  {entry.note}
                </span>
              ) : null}
              {mine.length > 0 ? (
                <ul className="flex min-w-0 flex-col gap-1 touch:flex-row touch:flex-wrap">
                  {mine.map((event, chip) => {
                    const tone = event.tone ?? 'accent';
                    const hidden = chip >= maxChips;
                    return (
                      <li
                        key={event.id}
                        className={cn(
                          hidden
                            ? 'sr-only'
                            : 'flex h-5 shrink-0 items-center gap-1.5 overflow-hidden rounded-xs px-1.5 text-2xs leading-none font-medium whitespace-nowrap touch:size-1.5 touch:rounded-full touch:p-0',
                          !hidden &&
                            (event.tentative
                              ? cn('ring-1 ring-inset', ringClass[tone])
                              : toneClass[tone]),
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn('size-1.5 shrink-0 rounded-[2px]', barClass[tone])}
                        />
                        <span className="truncate touch:sr-only">{event.title}</span>
                        {event.detail ? <span className="sr-only">, {event.detail}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {mine.length > maxChips ? (
                <span
                  aria-hidden
                  className="ps-0.5 text-2xs leading-none font-semibold text-fg-muted"
                >
                  +{mine.length - maxChips} more
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function dayNumber(isToday: boolean, shaded: boolean): string {
  return cn(
    'text-sm leading-none font-semibold tabular-nums touch:text-xs',
    isToday
      ? 'grid size-6 place-items-center rounded-full bg-accent-solid text-fg-on-accent touch:size-5'
      : shaded
        ? 'text-fg-subtle'
        : 'text-fg',
  );
}
