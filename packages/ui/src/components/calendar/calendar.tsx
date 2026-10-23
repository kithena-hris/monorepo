'use client';

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { t as tr } from '../../lib/i18n';

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

/** The ISO date for these parts, or null when no such day exists (31 February). */
function isoOf(year: number, month: number, day: number): IsoDate | null {
  if (![year, month, day].every(Number.isInteger) || year < 1 || month < 1 || day < 1) return null;
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
    ? formatIsoDate(t)
    : null;
}

/** "96" is 1996 and "12" is 2012: a two-digit year is the nearer century's. */
const fullYear = (y: string): number => {
  const n = Number(y);
  return y.length > 2 ? n : n < 50 ? 2000 + n : 1900 + n;
};

/** Month names, long and short, in the locale and in English, to their number. */
function monthNames(locale: string): Map<string, number> {
  const names = new Map<string, number>();
  for (const loc of [locale, 'en']) {
    for (const width of ['long', 'short'] as const) {
      const format = new Intl.DateTimeFormat(loc, { month: width, timeZone: 'UTC' });
      for (let m = 0; m < 12; m++) {
        names.set(
          format
            .format(new Date(Date.UTC(2024, m, 1)))
            .toLowerCase()
            .replace('.', ''),
          m + 1,
        );
      }
    }
  }
  return names;
}

/**
 * A date as a person types it, as an ISO date, or null: "14/03/1996",
 * "1996-03-14", "14 March 1996", "March 14, 1996", "14 mar 96". Numbers are
 * read day first, as the locale writes them; month first in US English.
 */
export function parseTypedDate(text: string, locale = 'en-GB'): IsoDate | null {
  const t = text.trim().toLowerCase().replaceAll(',', ' ').replaceAll(/\s+/gu, ' ');
  if (t === '') return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(t);
  if (iso) return isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{2}|\d{4})$/u.exec(t);
  if (numeric) {
    const [a, b] = [Number(numeric[1]), Number(numeric[2])];
    const monthFirst = locale.toLowerCase() === 'en-us';
    return isoOf(fullYear(numeric[3] ?? ''), monthFirst ? a : b, monthFirst ? b : a);
  }
  const names = monthNames(locale);
  const parts = t.split(' ');
  if (parts.length === 3) {
    const [x, y, z] = parts as [string, string, string];
    const dayFirst = names.get(y.replace('.', ''));
    if (dayFirst !== undefined && /^\d{1,2}$/u.test(x) && /^\d{2,4}$/u.test(z)) {
      return isoOf(fullYear(z), dayFirst, Number(x));
    }
    const monthFirst = names.get(x.replace('.', ''));
    if (monthFirst !== undefined && /^\d{1,2}$/u.test(y) && /^\d{2,4}$/u.test(z)) {
      return isoOf(fullYear(z), monthFirst, Number(y));
    }
  }
  return null;
}

export interface DateRange {
  start: IsoDate | null;
  end: IsoDate | null;
}

/** The status tones and the categorical chart palette. */
export type CalendarTone =
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
  | 'chart-6';

/** A dot under a day. */
export interface CalendarMarker {
  tone: CalendarTone;
  /** Read after the date: "Public holiday", "2 away". A dot alone says nothing to a screen reader. */
  label?: string;
}

/** How one day's number is drawn, apart from selection. */
export interface CalendarDayStyle {
  /**
   * `struck`: muted and crossed out, but still selectable, unlike a disabled
   * day: a day that does not count. `danger`: the number in the danger colour,
   * a day with a problem on it.
   */
  appearance: 'struck' | 'danger';
  /** Read after the date. The appearance is never the only signal. */
  label?: string;
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
  /**
   * Dots under a day: something already booked, a public holiday, a cut-off.
   * One marker or several; three fit under a day.
   */
  markers?: Readonly<Record<IsoDate, CalendarMarker | readonly CalendarMarker[]>>;
  /** Per-day appearance: crossed out, or in the danger colour. */
  dayStyles?: Readonly<Record<IsoDate, CalendarDayStyle>>;
  /**
   * A period drawn as a range is, ends filled and a band between, without
   * being the selection: a period chosen elsewhere and shown here for
   * reference. In `range` mode a selection in progress takes its place.
   * `label` is read after each day inside it.
   */
  highlight?: { start: IsoDate; end: IsoDate; label?: string } | null;
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

const dotTone: Record<CalendarTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
  'chart-1': 'bg-chart-1',
  'chart-2': 'bg-chart-2',
  'chart-3': 'bg-chart-3',
  'chart-4': 'bg-chart-4',
  'chart-5': 'bg-chart-5',
  'chart-6': 'bg-chart-6',
};

/** What each level's arrows do: a month, a year, or a page of twelve years. */
const STEP = {
  days: { months: 1, previous: 'Previous month', next: 'Next month' },
  months: { months: 12, previous: 'Previous year', next: 'Next year' },
  years: { months: 144, previous: 'Previous twelve years', next: 'Next twelve years' },
} as const;

/** A month or a year to choose: the day circle's treatment, as a wider pill. */
const zoomCell = (selected: boolean, disabled: boolean, current: boolean): string =>
  cn(
    'tap-target h-10 rounded-full text-sm font-medium tabular-nums touch:h-12 touch:text-base',
    'transition-colors duration-(--animate-duration-fast)',
    'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
    selected
      ? 'bg-accent-solid font-bold text-fg-on-accent hover:bg-accent-hover'
      : 'text-fg hover:bg-surface-hover',
    current && !selected && 'font-bold text-accent-fg ring-[1.5px] ring-accent ring-inset',
    disabled && 'cursor-not-allowed text-fg-disabled line-through hover:bg-transparent',
  );

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
    dayStyles,
    highlight,
    weekStartsOn = 1,
    locale = 'en-GB',
    today = formatIsoDate(Date.now()),
    className,
    label = tr('components.calendar.calendar.calendar', 'Calendar'),
  } = props;
  const mode = props.mode ?? 'single';
  // A picker opens on what is chosen: a birthday in 1996 opens on 1996, not on today.
  const chosen = props.mode === 'range' ? props.selected?.start : props.selected;
  const [internalMonth, setInternalMonth] = useState(() => startOfMonth(month ?? chosen ?? today));
  /**
   * Days, then months, then years: the heading zooms out, so a date decades
   * away is three presses, not three hundred.
   */
  const [view, setView] = useState<'days' | 'months' | 'years'>('days');
  const visibleMonth = month ? startOfMonth(month) : internalMonth;
  const visibleYear = Number(visibleMonth.slice(0, 4));
  const decade = Math.floor(visibleYear / 12) * 12;

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
  const shortMonthFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const yearFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }),
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

  // The band drawn: the selection once one is under way, else the highlight.
  const band = range?.start ? range : (highlight ?? null);
  const fromHighlight = band !== null && band === highlight;

  const inRange = (date: IsoDate): boolean =>
    Boolean(band?.start && band.end && date > band.start && date < band.end);

  const isSelected = (date: IsoDate): boolean =>
    mode === 'single' ? date === single : date === range?.start || date === range?.end;

  return (
    <div
      className={cn('w-full max-w-70 select-none touch:max-w-none', className)}
      role="group"
      aria-label={label}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* Polite, not assertive: paging should be announced, not interrupt
            whatever the user was already hearing. */}
        {view === 'years' ? (
          <p aria-live="polite" className="ps-1.5 text-base font-semibold text-fg touch:text-md">
            {tr('components.calendar.calendar.text', '{{decade}} – {{value}}', {
              decade: String(decade),
              value: String(decade + 11),
            })}
          </p>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-live="polite"
            aria-label={
              view === 'days'
                ? tr('components.calendar.calendar.choose_a_month', '{{format}}, choose a month', {
                    format: monthFormatter.format(new Date(parseIsoDate(visibleMonth))),
                  })
                : tr(
                    'components.calendar.calendar.choose_a_year',
                    '{{visibleYear}}, choose a year',
                    { visibleYear: String(visibleYear) },
                  )
            }
            className="-ms-1.5 px-1.5 text-base font-semibold touch:text-md"
            onClick={() => {
              setView(view === 'days' ? 'months' : 'years');
            }}
            endIcon={<ChevronDown aria-hidden />}
          >
            {view === 'days'
              ? monthFormatter.format(new Date(parseIsoDate(visibleMonth)))
              : String(visibleYear)}
          </Button>
        )}
        <div className="flex gap-0.5">
          <Button
            size="sm"
            variant="ghost"
            aria-label={STEP[view].previous}
            onClick={() => {
              setMonth(addMonths(visibleMonth, -STEP[view].months));
            }}
            startIcon={<ChevronLeft />}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label={STEP[view].next}
            onClick={() => {
              setMonth(addMonths(visibleMonth, STEP[view].months));
            }}
            startIcon={<ChevronRight />}
          />
        </div>
      </div>

      {view === 'months' ? (
        <div
          role="group"
          aria-label={tr('components.calendar.calendar.months_of', 'Months of {{visibleYear}}', {
            visibleYear: String(visibleYear),
          })}
          className="grid grid-cols-3 gap-1.5"
        >
          {Array.from({ length: 12 }, (_, m) => {
            const first = `${String(visibleYear).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-01`;
            const last = addDays(addMonths(first, 1), -1);
            const out = (max !== undefined && first > max) || (min !== undefined && last < min);
            const here = first.slice(0, 7) === visibleMonth.slice(0, 7);
            return (
              <button
                key={m}
                type="button"
                disabled={out}
                aria-pressed={here}
                onClick={() => {
                  setMonth(first);
                  setView('days');
                }}
                className={zoomCell(here, out, today.slice(0, 7) === first.slice(0, 7))}
              >
                {shortMonthFormatter.format(new Date(parseIsoDate(first)))}
              </button>
            );
          })}
        </div>
      ) : view === 'years' ? (
        <div
          role="group"
          aria-label={tr('components.calendar.calendar.years_to', 'Years {{decade}} to {{value}}', {
            decade: String(decade),
            value: String(decade + 11),
          })}
          className="grid grid-cols-3 gap-1.5"
        >
          {Array.from({ length: 12 }, (_, i) => {
            const year = decade + i;
            const first = `${String(year).padStart(4, '0')}-01-01`;
            const last = `${String(year).padStart(4, '0')}-12-31`;
            const out = (max !== undefined && first > max) || (min !== undefined && last < min);
            const here = year === visibleYear;
            return (
              <button
                key={year}
                type="button"
                disabled={out}
                aria-pressed={here}
                onClick={() => {
                  setMonth(`${String(year).padStart(4, '0')}-${visibleMonth.slice(5, 7)}-01`);
                  setView('months');
                }}
                className={zoomCell(here, out, today.slice(0, 4) === String(year))}
              >
                {yearFormatter.format(new Date(parseIsoDate(first)))}
              </button>
            );
          })}
        </div>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {weekdayNames.map((name) => (
                <th
                  key={name}
                  scope="col"
                  className="h-7 text-center text-2xs font-semibold text-fg-subtle"
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
                  const entry = markers?.[date];
                  const dots: readonly CalendarMarker[] =
                    entry === undefined ? [] : 'tone' in entry ? [entry] : entry;
                  const style = dayStyles?.[date];
                  // The band under a range runs edge to edge between the ends
                  // and stops at the centre of each end's circle.
                  const isStart = band?.start === date;
                  const isEnd = band?.end === date;
                  const banded =
                    between ||
                    (Boolean(band?.end) && band?.start !== band?.end && (isStart || isEnd));
                  const filled = selectedDay || (fromHighlight && (isStart || isEnd));
                  const notes = [
                    ...dots.map((dot) => dot.label),
                    style?.label,
                    fromHighlight && (between || isStart || isEnd) ? highlight.label : undefined,
                  ].filter(Boolean);

                  return (
                    <td key={date} className="relative h-9 p-0 text-center touch:h-11">
                      {banded ? (
                        <span
                          aria-hidden
                          className={cn(
                            'absolute inset-y-0.75 bg-accent-subtle',
                            isStart ? 'start-1/2' : 'start-0',
                            isEnd ? 'end-1/2' : 'end-0',
                          )}
                        />
                      ) : null}
                      <button
                        type="button"
                        disabled={disabled}
                        aria-pressed={selectedDay}
                        aria-current={date === today ? 'date' : undefined}
                        aria-label={[
                          dayFormatter.format(new Date(parseIsoDate(date))),
                          ...notes,
                        ].join(', ')}
                        onClick={() => {
                          handleSelect(date);
                        }}
                        className={cn(
                          // A 32px circle in a 36px cell at a desk, 40 in 44
                          // under a thumb: the cell is the target, the circle
                          // is what a selection looks like.
                          'tap-target relative mx-auto grid size-8 place-items-center rounded-full touch:size-10',
                          'text-sm font-medium tabular-nums touch:text-base',
                          'transition-colors duration-(--animate-duration-fast)',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
                          outsideMonth || style?.appearance === 'struck'
                            ? 'text-fg-subtle'
                            : 'text-fg',
                          style?.appearance === 'struck' && 'line-through',
                          style?.appearance === 'danger' && 'text-danger-fg',
                          !disabled && !filled && 'hover:bg-surface-hover',
                          filled &&
                            'bg-accent-solid font-bold text-fg-on-accent no-underline hover:bg-accent-hover',
                          date === today &&
                            !filled &&
                            'font-bold text-accent-fg ring-[1.5px] ring-accent ring-inset',
                          disabled && 'cursor-not-allowed text-fg-disabled line-through',
                        )}
                      >
                        {Number(date.slice(8))}
                        {dots.length > 0 ? (
                          <span
                            aria-hidden
                            className="absolute bottom-0.75 flex gap-0.5 touch:bottom-1.25"
                          >
                            {dots.slice(0, 3).map((dot, index) => (
                              <span
                                key={index}
                                className={cn(
                                  'size-[5px] rounded-full',
                                  filled ? 'bg-fg-on-accent' : dotTone[dot.tone],
                                )}
                              />
                            ))}
                          </span>
                        ) : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
