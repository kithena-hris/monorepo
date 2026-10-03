import {
  Avatar,
  Scheduler,
  dayColumns,
  type SchedulerColumn,
  type SchedulerEvent,
} from '@reach/ui';
import type { JSX, ReactNode } from 'react';

import {
  daysBetween,
  isWeekend,
  lookOf,
  tentative,
  type CalendarView,
  type LeaveTypeLook,
} from './words';

/**
 * People by days with a count of who is in (T13, T15, T17, MT13, MT16):
 * Reach's `Scheduler` in rows, from the calendar Time Off answered. Weekends
 * are muted, holidays hatched and named, a day below the minimum washed red
 * and said ("4 of 7 in"), a request waiting for a decision hatched and
 * outlined. A phone passes fewer days, not a different picture.
 */
export function TeamTimeline({
  view,
  types,
  from,
  to,
  label,
  highlight,
  today,
  selected,
  onSelect,
  detail,
  onDismiss,
  className,
}: {
  readonly view: CalendarView;
  readonly types: readonly LeaveTypeLook[];
  readonly from: string;
  readonly to: string;
  readonly label: string;
  /** The person being looked at: first, and washed in the accent. */
  readonly highlight?: string;
  readonly today?: string;
  readonly selected?: string;
  readonly onSelect?: (date: string) => void;
  readonly detail?: ReactNode;
  readonly onDismiss?: () => void;
  readonly className?: string;
}): JSX.Element {
  const columns = calendarColumns(view, from, to);
  const people = [...view.people].toSorted(
    (a, b) => Number(b.personId === highlight) - Number(a.personId === highlight),
  );
  const events: SchedulerEvent[] = view.entries
    .filter((e) => e.span.to >= from && e.span.from <= to)
    .map((e) => {
      const look = lookOf(types, e.leaveTypeKey);
      const waiting = tentative(e.status);
      return {
        id: `${e.requestId}:${e.span.from}`,
        row: e.personId,
        column: e.span.from < from ? from : e.span.from,
        endColumn: e.span.to > to ? to : e.span.to,
        start: 0,
        end: 0,
        allDay: true,
        title: look.name,
        tone: look.tone,
        ...(waiting ? { tentative: true, detail: 'Waiting for approval' } : {}),
      };
    });
  const counted = view.coverage.filter((c) => c.checked && c.date >= from && c.date <= to);
  const required = counted[0]?.required;
  return (
    <Scheduler
      variant="rows"
      label={label}
      columns={columns}
      rows={people.map((p) => ({
        id: p.personId,
        label: p.displayName,
        leading: <Avatar name={p.displayName} size="sm" />,
        ...(p.personId === highlight ? { highlighted: true } : {}),
      }))}
      events={events}
      {...(counted.length === 0
        ? {}
        : {
            summaryRow: {
              label: 'In',
              values: Object.fromEntries(counted.map((c) => [c.date, c.in])),
              ...(required === undefined ? {} : { minimum: required }),
              belowLabel: 'below the team minimum',
            },
          })}
      {...(today === undefined ? {} : { today })}
      {...(selected === undefined ? {} : { selected })}
      {...(onSelect === undefined ? {} : { onSelect })}
      {...(detail === undefined ? {} : { detail })}
      {...(onDismiss === undefined ? {} : { onDismiss })}
      {...(className === undefined ? {} : { className })}
    />
  );
}

/**
 * The days from `from` to `to` as Scheduler columns: weekends muted,
 * holidays hatched with their names, days below the minimum marked with how
 * many are in.
 */
export function calendarColumns(view: CalendarView, from: string, to: string): SchedulerColumn[] {
  return dayColumns(from, daysBetween(from, to) + 1, 'en-GB').map((day) => {
    const holidays = [
      ...new Set(view.holidays.filter((h) => h.date === day.id).map((h) => h.name)),
    ];
    const cover = view.coverage.find((c) => c.date === day.id);
    const below = cover?.below === true;
    const note = [
      ...holidays,
      ...(below ? [`${String(cover.in)} of ${String(cover.of)} in`] : []),
    ].join(' · ');
    return {
      ...day,
      ...(isWeekend(day.id) ? { shade: 'muted' as const } : {}),
      ...(holidays.length > 0 ? { shade: 'hatched' as const } : {}),
      ...(below ? { clash: true } : {}),
      ...(note === '' ? {} : { note }),
    };
  });
}
