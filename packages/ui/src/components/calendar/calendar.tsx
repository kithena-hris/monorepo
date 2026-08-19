'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * A month grid for choosing calendar dates.
 *
 * **Everything here is an ISO `YYYY-MM-DD` string, never a `Date`.** A hire
 * date, a leave day and a birthday are calendar dates: they have no time and
 * no zone. The moment one becomes a `Date`, it acquires the *browser's* zone,
 * and a leave day booked as the 1st in Madrid is stored as the 31st for
 * anyone rendering it in São Paulo. That bug is silent. It is a day out, and
 * it only appears for some users in some months. The database column is
 * `date`; this stays a string all the way to it.
 *
 * The arithmetic below is therefore done on UTC dates, which never shift.
 */

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;

/** `2026-08-09` → a UTC timestamp. Exported for the unit tests. */
export function parseIsoDate(iso: IsoDate): number {
  // `Number('a')` is `NaN`, not `undefined`, so a missing-part check alone
  // lets "not-a-date" through and produces an Invalid Date several frames
  // later, in whichever component happened to format it.
  const [year, month, day] = iso.split('-').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day)
  ) {
    throw new TypeError(`Expected an ISO calendar date (YYYY-MM-DD), received "${iso}".`);
  }
  return Date.UTC(year, month - 1, day);
}

export function formatIsoDate(timestamp: number): IsoDate {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  return formatIsoDate(parseIsoDate(iso) + days * MS_PER_DAY);
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const date = new Date(parseIsoDate(iso));
  const targetMonth = date.getUTCMonth() + months;
  // Clamping the day is what stops "31 January + 1 month" landing on 3 March.
  const target = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return formatIsoDate(target.getTime());
}

export interface DateRange {
  start: IsoDate | null;
  end: IsoDate | null;
}

/**
 * Everything that does not depend on the selection mode.
 *
 * Split out so the two modes below differ only in the three props that
 * genuinely differ, rather than restating twenty.
 */
interface CalendarBaseProps {
  /** The visible month, as any date within it. Uncontrolled if omitted. */
  month?: IsoDate;
  onMonthChange?: (month: IsoDate) => void;
  /** Inclusive bounds. Days outside are rendered but not selectable. */
  min?: IsoDate;
  max?: IsoDate;
  /** Per-day veto: company holidays, blackout periods, weekends. */
  isDateDisabled?: (date: IsoDate) => boolean;
  /** Dots under a day: existing leave, a public holiday, a payroll cut-off. */
  markers?: Readonly<Record<IsoDate, { tone: 'accent' | 'success' | 'warning' | 'danger' }>>;
  /**
   * 0 = Sunday. Defaults to Monday, which is the ISO week and what every
   * European payroll calendar uses. Do not hardcode the US week.
   */
  weekStartsOn?: 0 | 1;
  locale?: string;
  /**
   * Today, injected. The domain layer forbids `new Date()` for the same
   * reason it matters here: a component that reads the clock cannot be
   * screenshot-tested, and "today" is exactly the pixel that changes.
   */
  today?: IsoDate;
  className?: string;
  /** Accessible name, e.g. "Leave start date". */
  label?: string;
}

/**
 * The mode decides what a selection *is*, so it discriminates the props.
 *
 * As two independent props, `mode` and `selected` allowed
 * `mode="single" selected={{ start, end }}`, which is meaningless, and forced
 * the component to assert `selected` into whichever shape it expected. The
 * union makes the impossible combination unrepresentable, so the narrowing the
 * assertions were faking now falls out of `mode` on its own.
 *
 * It also fixes the callback. `onSelect` used to hand every consumer
 * `IsoDate | DateRange | null` regardless of mode, so a single-date picker had
 * to re-narrow a range it could never receive. Each mode now reports only what
 * that mode can produce.
 */
export type CalendarProps = CalendarBaseProps &
  (
    | {
        /** Picks one day. `onSelect` receives an `IsoDate`, or `null` when cleared. */
        mode?: 'single';
        selected?: IsoDate | null;
        onSelect?: (value: IsoDate | null) => void;
      }
    | {
        /** Picks a period. `onSelect` receives a `DateRange`. */
        mode: 'range';
        selected?: DateRange | null;
        onSelect?: (value: DateRange) => void;
      }
  );

const dotTone = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
} as const;

function startOfMonth(iso: IsoDate): IsoDate {
  return `${iso.slice(0, 7)}-01`;
}

export function Calendar(props: CalendarProps): JSX.Element {
  /*
   * The three discriminated props stay on `props`, everything else is
   * destructured. Pulling `mode` and `selected` out as separate locals is what
   * breaks the narrowing: TypeScript can relate two properties of one union
   * value, but not two independent variables, and that lost relationship is
   * precisely what the old assertions were re-asserting by hand.
   */
  const {
    month,
    onMonthChange,
    min,
    max,
    isDateDisabled,
    markers,
    weekStartsOn = 1,
    locale = 'en-GB',
    today = formatIsoDate(Date.now()),
    className,
    label = 'Calendar',
  } = props;
  const mode = props.mode ?? 'single';
  const [internalMonth, setInternalMonth] = useState(() => startOfMonth(month ?? today));
  const visibleMonth = month ? startOfMonth(month) : internalMonth;

  const setMonth = (next: IsoDate): void => {
    if (!month) setInternalMonth(next);
    onMonthChange?.(next);
  };

  const range = props.mode === 'range' ? (props.selected ?? { start: null, end: null }) : null;
  const single = props.mode === 'range' ? null : (props.selected ?? null);

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const dayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  );
  const weekdayFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    [locale],
  );

  const weekdayNames = useMemo(() => {
    // 2024-01-01 was a Monday; offsetting from it gives the names in the right
    // order for either week start without a hardcoded English array.
    const monday = Date.UTC(2024, 0, 1);
    return Array.from({ length: 7 }, (_, i) => {
      const offset = weekStartsOn === 1 ? i : (i + 6) % 7;
      return weekdayFormatter.format(new Date(monday + offset * MS_PER_DAY));
    });
  }, [weekdayFormatter, weekStartsOn]);

  const days = useMemo(() => {
    const firstOfMonth = parseIsoDate(visibleMonth);
    const weekday = new Date(firstOfMonth).getUTCDay();
    const lead = (weekday - weekStartsOn + 7) % 7;
    const gridStart = firstOfMonth - lead * MS_PER_DAY;
    // Always six rows. A grid that is five rows in February and six in March
    // makes the panel jump height when the user pages through months.
    return Array.from({ length: 42 }, (_, i) => formatIsoDate(gridStart + i * MS_PER_DAY));
  }, [visibleMonth, weekStartsOn]);

  const isOutOfBounds = (date: IsoDate): boolean =>
    (min !== undefined && date < min) || (max !== undefined && date > max);

  const isDisabled = (date: IsoDate): boolean =>
    isOutOfBounds(date) || (isDateDisabled?.(date) ?? false);

  const handleSelect = (date: IsoDate): void => {
    if (isDisabled(date)) return;

    /*
     * Narrowing on `props` rather than on the `mode` local. Both branches call
     * something named `onSelect`, but they are two different functions with two
     * different parameter types, and only the union knows which one is in hand.
     * This is the check the old `as` casts were standing in for.
     */
    if (props.mode !== 'range') {
      props.onSelect?.(date === single ? null : date);
      return;
    }

    const current = range ?? { start: null, end: null };
    if (!current.start || (current.start && current.end)) {
      props.onSelect?.({ start: date, end: null });
      return;
    }
    // Dragging backwards is a normal thing to do; swap rather than reject.
    props.onSelect?.(
      date < current.start
        ? { start: date, end: current.start }
        : { start: current.start, end: date },
    );
  };

  const inRange = (date: IsoDate): boolean =>
    Boolean(range?.start && range.end && date > range.start && date < range.end);

  const isSelected = (date: IsoDate): boolean =>
    mode === 'single' ? date === single : date === range?.start || date === range?.end;

  return (
    <div className={cn('w-full max-w-xs select-none', className)} role="group" aria-label={label}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous month"
          onClick={() => {
            setMonth(addMonths(visibleMonth, -1));
          }}
          startIcon={<ChevronLeft />}
        />
        {/* Polite, not assertive: paging months should be announced, not
            interrupt whatever the user was already hearing. */}
        <p aria-live="polite" className="text-base font-medium text-fg">
          {monthFormatter.format(new Date(parseIsoDate(visibleMonth)))}
        </p>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next month"
          onClick={() => {
            setMonth(addMonths(visibleMonth, 1));
          }}
          startIcon={<ChevronRight />}
        />
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr>
            {weekdayNames.map((name) => (
              <th
                key={name}
                scope="col"
                className="pb-1 text-center text-2xs font-medium text-fg-subtle"
              >
                {/* The short name is shown; the long one is read out, because
                    "Mo" is announced as "mo". */}
                <span aria-hidden>{name.slice(0, 2)}</span>
                <span className="sr-only">{name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, week) => (
            <tr key={week}>
              {days.slice(week * 7, week * 7 + 7).map((date) => {
                const outsideMonth = date.slice(0, 7) !== visibleMonth.slice(0, 7);
                const disabled = isDisabled(date);
                const selectedDay = isSelected(date);
                const between = inRange(date);
                const marker = markers?.[date];

                return (
                  <td key={date} className="p-0 text-center">
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={selectedDay}
                      aria-current={date === today ? 'date' : undefined}
                      aria-label={dayFormatter.format(new Date(parseIsoDate(date)))}
                      onClick={() => {
                        handleSelect(date);
                      }}
                      className={cn(
                        'relative mx-auto grid size-9 place-items-center rounded-md text-sm tabular-nums',
                        'transition-colors duration-(--animate-duration-fast)',
                        'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
                        outsideMonth ? 'text-fg-subtle' : 'text-fg',
                        !disabled && 'hover:bg-surface-hover',
                        between && 'rounded-none bg-accent-subtle',
                        selectedDay && 'bg-accent-solid text-fg-on-accent hover:bg-accent-hover',
                        date === today && !selectedDay && 'font-semibold text-accent-fg',
                        disabled && 'cursor-not-allowed text-fg-disabled line-through',
                      )}
                    >
                      {Number(date.slice(8))}
                      {marker ? (
                        <span
                          aria-hidden
                          className={cn(
                            'absolute bottom-1 size-1 rounded-full',
                            dotTone[marker.tone],
                            selectedDay && 'bg-fg-on-accent',
                          )}
                        />
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
