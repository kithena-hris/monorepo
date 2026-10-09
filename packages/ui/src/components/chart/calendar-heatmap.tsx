import { useEffect, useMemo, useRef, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { ChartDataTable, ChartMark, ChartScaleKey, toneMix, type ChartTone } from './chart';
import { ChartFrame } from './chart-window';

export interface CalendarDay {
  /** A calendar date, `YYYY-MM-DD`. Not a timestamp: a day has no time zone. */
  date: string;
  value: number;
}

export interface CalendarHeatmapProps {
  data: readonly CalendarDay[];
  /** First day shown, `YYYY-MM-DD`. */
  from: string;
  /** Last day shown, `YYYY-MM-DD`, inclusive. */
  to: string;
  label: string;
  tone?: ChartTone;
  /** Top of the colour scale. Defaults to the busiest day. */
  max?: number;
  format?: (value: number) => string;
  /** The day's sentence for the tooltip and the table: "3 people off sick". */
  describe?: (value: number, date: string) => string;
  /** Used for the month names and the dates in the tooltip. */
  locale?: string;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
  /**
   * A day, `YYYY-MM-DD`, brought into view when the range is wider than the
   * screen — today, on a phone, rather than January.
   */
  focus?: string;
  className?: string;
}

const DAY = 86_400_000;
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'];

/** Days since the epoch, in UTC, so no daylight-saving hour can skip a day. */
function dayNumber(iso: string): number {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY);
}

function isoOf(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/**
 * Activity per day across months: sick days, office check-ins. Weeks run
 * left to right, Monday to Sunday top to bottom, and darker means more.
 *
 * Dates are handled as dates, days since the epoch in UTC, never as local
 * timestamps: a calendar heatmap computed in local time loses or doubles a
 * day every spring and autumn.
 *
 * Only the busy days are in the data table. A year of zeros read aloud is
 * three hundred rows of nothing; the summary and the busy days are the data.
 */
export function CalendarHeatmap({
  data,
  from,
  to,
  label,
  tone = 'chart-1',
  max,
  format = (value) => String(value),
  describe,
  locale = 'en-GB',
  summary,
  focus,
  className,
}: CalendarHeatmapProps): JSX.Element {
  const scroller = useRef<HTMLDivElement>(null);
  const { weeks, first, last, values } = useMemo(() => {
    const firstDay = dayNumber(from);
    const lastDay = dayNumber(to);
    // Back to the Monday on or before the first day. Day 0 was a Thursday.
    const offset = (firstDay + 3) % 7;
    const monday = firstDay - offset;
    return {
      weeks: Math.max(Math.ceil((lastDay - monday + 1) / 7), 1),
      first: monday,
      last: lastDay,
      values: new Map(data.map((entry) => [dayNumber(entry.date), entry.value])),
    };
  }, [data, from, to]);

  const start = dayNumber(from);
  // The week holding `focus`, centred where the weeks scroll; nothing to do
  // when they all fit.
  useEffect(() => {
    const el = scroller.current;
    if (focus === undefined || el === null || el.scrollWidth <= el.clientWidth) return;
    const week = Math.floor((dayNumber(focus) - first) / 7);
    el.scrollLeft = Math.max(0, (week / weeks) * el.scrollWidth - el.clientWidth / 2);
  }, [focus, first, weeks]);
  const ceiling = max ?? Math.max(...values.values(), 1);
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const dateName = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const sentence = (value: number, day: number): string =>
    describe?.(value, isoOf(day)) ?? `${dateName.format(day * DAY)}: ${format(value)}`;

  // A month's name over the first week that contains its 1st.
  const months = Array.from({ length: weeks }, (_, week) => {
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = first + week * 7 + weekday;
      if (day >= start && day <= last && new Date(day * DAY).getUTCDate() === 1) {
        return monthName.format(day * DAY);
      }
    }
    return week === 0 ? monthName.format(start * DAY) : '';
  });

  const busy = [...values.entries()]
    .filter(([day, value]) => value > 0 && day >= start && day <= last)
    .toSorted(([a], [b]) => a - b);

  return (
    <ChartFrame
      label={label}
      rows={busy.map(([day, value]) => ({ label: isoOf(day), value }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div ref={scroller} className="overflow-x-auto">
        <div
          aria-hidden
          className="grid min-w-max items-center gap-[3px] text-[11px] font-medium text-fg-subtle"
          style={{ gridTemplateColumns: `auto repeat(${String(weeks)}, minmax(0.625rem, 1fr))` }}
        >
          <span />
          {months.map((month, week) => (
            // Allowed to overflow into the next columns: a month name is wider
            // than one week.
            <span key={week} className="pb-1 whitespace-nowrap">
              {month}
            </span>
          ))}

          {WEEKDAYS.map((weekday, row) => (
            <Row key={row} label={weekday}>
              {Array.from({ length: weeks }, (_, week) => {
                const day = first + week * 7 + row;
                if (day < start || day > last) return <span key={week} />;
                const value = values.get(day) ?? 0;
                const intensity = Math.min(value / ceiling, 1);
                return (
                  <ChartMark key={week} content={sentence(value, day)}>
                    <span
                      className="aspect-square rounded-[3px] bg-surface-sunken motion-safe:animate-fade-in"
                      style={
                        value === 0 ? undefined : { background: toneMix(tone, 15 + intensity * 85) }
                      }
                    />
                  </ChartMark>
                );
              })}
            </Row>
          ))}
        </div>
      </div>

      <ChartScaleKey tone={tone} low="Less" high={`More · ${format(ceiling)}+`} />

      <ChartDataTable
        caption={`${label}: days with any`}
        valueLabel="Value"
        data={busy.map(([day, value]) => ({ label: dateName.format(day * DAY), value }))}
        format={format}
      />
    </ChartFrame>
  );
}

/** A weekday label and its cells, flattened into the parent grid. */
function Row({ label, children }: { label: string; children: JSX.Element[] }): JSX.Element {
  return (
    <>
      <span className="pe-1.5">{label}</span>
      {children}
    </>
  );
}
