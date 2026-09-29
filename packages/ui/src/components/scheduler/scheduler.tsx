'use client';

import { useState, type CSSProperties, type JSX } from 'react';

import { cn } from '../../lib/cn';
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
 */

export type SchedulerTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export interface SchedulerColumn {
  id: string;
  /** `Wed 14`, or a person's or a room's name. */
  label: string;
  /** The strip button's two lines under a finger. Default to the label. */
  weekday?: string;
  day?: string;
  /** Read by assistive tech in place of the label: `Wednesday 14 October`. */
  fullLabel?: string;
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
}

export interface SchedulerProps {
  columns: readonly SchedulerColumn[];
  events: readonly SchedulerEvent[];
  /** Names the schedule for assistive tech. */
  label: string;
  /** `grid` draws the hours; `agenda` lists the events day by day. */
  view?: 'grid' | 'agenda';
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
};

const barClass: Record<SchedulerTone, string> = {
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

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
