import { useMemo, useState, type JSX } from 'react';

import { Calendar, type CalendarMarker, type IsoDate } from '../calendar/calendar';
import { Chip, ChipRow } from '../chip/chip';
import { Combobox } from '../combobox/combobox';
import { Progress } from '../progress/progress';
import { cn } from '../../lib/cn';

/**
 * Times picked from a calendar: a day at a time, the day's free times in a
 * list rather than a wall of them, and what was picked grouped by day as
 * removable chips. Days with nothing free are struck and cannot be chosen:
 * a weekend, a holiday, a day everyone is away, or one with no working
 * hours left. Which days those are is the caller's to know; this component
 * only draws what it is told is free.
 */

export interface SlotPickerProps {
  /** Every free start, as ISO instants, in any order. */
  slots: readonly string[];
  /** The picked starts, a subset of `slots`. */
  value: readonly string[];
  onChange: (value: readonly string[]) => void;
  /** How many may be picked; one makes it a single choice. */
  max?: number;
  /** Starts already taken by something booked, dotted on the calendar. */
  booked?: readonly string[];
  /** Today, injected, as the calendar needs it. */
  today: IsoDate;
  /** The zone the times are shown in; the viewer's by default. */
  timeZone?: string;
  locale?: string;
  /** Accessible name: "Interview times". */
  label: string;
  /** Under the day's list: "09:00 – 09:45" when given, else the start alone. */
  minutes?: number;
  /**
   * Why a day has nothing free, when the caller knows: "Diwali", "Public
   * holiday". Read after the date and shown when the day is chosen; a weekend
   * or a day with no working hours left needs none.
   */
  unavailable?: Readonly<Record<IsoDate, string>>;
  className?: string;
}

const dayOf = (iso: string, timeZone: string | undefined): IsoDate =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

export function SlotPicker({
  slots,
  value,
  onChange,
  max,
  booked = [],
  today,
  timeZone,
  locale = 'en-GB',
  label,
  minutes,
  unavailable = {},
  className,
}: SlotPickerProps): JSX.Element {
  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone }),
    [locale, timeZone],
  );
  const weekday = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const dayNumber = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }),
    [locale],
  );
  const month = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }),
    [locale],
  );
  const longDay = useMemo(
    () =>
      // Days are calendar dates, keyed already in the viewer's zone: drawn at noon UTC, read in UTC.
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      }),
    [locale],
  );
  const byDay = useMemo(() => {
    const map = new Map<IsoDate, string[]>();
    for (const s of [...slots].toSorted()) {
      const d = dayOf(s, timeZone);
      map.set(d, [...(map.get(d) ?? []), s]);
    }
    return map;
  }, [slots, timeZone]);
  const bookedDays = useMemo(
    () => new Set(booked.map((b) => dayOf(b, timeZone))),
    [booked, timeZone],
  );
  const firstFree = [...byDay.keys()].find((d) => d >= today) ?? today;
  const [day, setDay] = useState<IsoDate>(firstFree);
  const dayTimes = byDay.get(day) ?? [];
  const chosenByDay = useMemo(() => {
    const map = new Map<IsoDate, string[]>();
    for (const s of [...value].toSorted()) {
      const d = dayOf(s, timeZone);
      map.set(d, [...(map.get(d) ?? []), s]);
    }
    return map;
  }, [value, timeZone]);
  const markers: Record<IsoDate, readonly CalendarMarker[]> = {};
  for (const d of byDay.keys()) markers[d] = [{ tone: 'success', label: 'Times free' }];
  for (const d of bookedDays)
    markers[d] = [...(markers[d] ?? []), { tone: 'accent', label: 'Already booked' }];
  for (const [d, why] of Object.entries(unavailable))
    markers[d] = [...(markers[d] ?? []), { tone: 'warning', label: why }];
  const weekend = (d: IsoDate): boolean => {
    const n = new Date(`${d}T12:00:00Z`).getUTCDay();
    return n === 0 || n === 6;
  };
  const dayStyles: Record<IsoDate, { appearance: 'struck'; label: string }> = {};
  // Struck: the days in view with nothing free. A month's worth is enough to name.
  const [y, m] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
  for (let i = 1; i <= last; i += 1) {
    const d = `${day.slice(0, 7)}-${String(i).padStart(2, '0')}`;
    if (!byDay.has(d) && d >= today)
      dayStyles[d] = {
        appearance: 'struck',
        label: unavailable[d] ?? (weekend(d) ? 'Weekend' : 'Nothing free'),
      };
  }
  const range = (s: string): string =>
    minutes === undefined
      ? time.format(new Date(s))
      : `${time.format(new Date(s))} – ${time.format(new Date(Date.parse(s) + minutes * 60_000))}`;
  const full = max !== undefined && value.length >= max;
  return (
    <div className={cn('grid gap-6 md:grid-cols-[auto_minmax(0,1fr)]', className)}>
      <Calendar
        label={`${label}: day`}
        mode="single"
        today={today}
        min={today}
        selected={day}
        onSelect={(d) => {
          if (d !== null) setDay(d);
        }}
        isDateDisabled={(d) => !byDay.has(d)}
        markers={markers}
        dayStyles={dayStyles}
        locale={locale}
      />
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="font-semibold">{longDay.format(new Date(`${day}T12:00:00Z`))}</h3>
        {dayTimes.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Nothing free that day. Pick a day with a green dot.
          </p>
        ) : (
          <Combobox
            label={`${label}: times on ${day}`}
            multiple={max !== 1}
            chips={false}
            placeholder={
              max === 1 ? 'Choose a time' : full ? `${String(max)} picked` : 'Add a time'
            }
            searchPlaceholder="Type a time"
            emptyMessage="No time like that"
            options={dayTimes.map((s) => ({
              value: s,
              label: range(s),
              disabled: full && !value.includes(s),
            }))}
            value={
              max === 1
                ? (value.find((v) => dayOf(v, timeZone) === day) ?? null)
                : value.filter((v) => dayOf(v, timeZone) === day)
            }
            onChange={(next) => {
              const others = value.filter((v) => dayOf(v, timeZone) !== day);
              const picked = next === null ? [] : typeof next === 'string' ? [next] : [...next];
              onChange(max === 1 ? picked : [...others, ...picked].toSorted());
            }}
          />
        )}
        {max === undefined || max === 1 ? null : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {value.length === max ? 'All picked' : `Pick ${String(max - value.length)} more`}
              </span>
              <span className="text-fg-muted tabular-nums">{`${String(value.length)} of ${String(max)}`}</span>
            </div>
            <Progress
              value={value.length}
              max={max}
              size="sm"
              label={`${String(value.length)} of ${String(max)} times picked`}
            />
          </div>
        )}
        {value.length === 0 ? null : (
          <ul className="flex flex-col gap-2" aria-label={`${label}: picked`}>
            {[...chosenByDay.entries()].map(([d, times]) => {
              const at = new Date(`${d}T12:00:00Z`);
              return (
                <li
                  key={d}
                  className="flex items-start gap-3 rounded-lg bg-surface-sunken p-2.5 animate-enter motion-reduce:animate-none"
                >
                  {/* A date tile: the day read before its times, the way a calendar shows it. */}
                  <button
                    type="button"
                    className="flex w-12 shrink-0 flex-col items-center rounded-md bg-surface py-1 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    aria-label={`Show ${longDay.format(at)}`}
                    onClick={() => {
                      setDay(d);
                    }}
                  >
                    <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-accent-fg">
                      {weekday.format(at)}
                    </span>
                    <span className="text-lg font-bold leading-tight tabular-nums">
                      {dayNumber.format(at)}
                    </span>
                    <span className="text-[0.6875rem] text-fg-muted">{month.format(at)}</span>
                  </button>
                  <ChipRow
                    aria-label={`Picked on ${longDay.format(at)}`}
                    className="min-w-0 flex-1 pt-0.5"
                  >
                    {times.map((s) => (
                      <Chip
                        key={s}
                        onRemove={() => {
                          onChange(value.filter((v) => v !== s));
                        }}
                        removeLabel={`Remove ${range(s)}`}
                      >
                        {range(s)}
                      </Chip>
                    ))}
                  </ChipRow>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
