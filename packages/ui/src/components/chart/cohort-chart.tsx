import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { toneMix, type ChartTone } from './chart';
import { ChartFrame } from './chart-window';

export interface CohortRow {
  /** The group: "Q1 2025 joiners". */
  label: string;
  /** One value per period since joining; `null` where the period has not come yet. */
  values: readonly (number | null)[];
}

export interface CohortChartProps {
  /** Column headings: "M0", "M3", "M6", or "Year 1", "Year 2". */
  periods: readonly string[];
  cohorts: readonly CohortRow[];
  label: string;
  /** Formats a cell. Defaults to a whole percentage. */
  format?: (value: number) => string;
  /**
   * The ends of the colour scale. Default to the lowest and highest values
   * present: retention lives between 80% and 100%, and a scale from zero would
   * paint every cell the same.
   */
  min?: number;
  max?: number;
  tone?: ChartTone;
  /** What the chart shows, in a sentence. */
  summary?: string;
  className?: string;
}

/**
 * How each group of joiners stays over time. Read across a row for one
 * cohort's story, down a column to compare cohorts at the same age.
 *
 * It is a table, so it is built as one: a real `<table>` with row and column
 * headers is the accessible version and the visual one at the same time, and
 * a screen reader can move through it cell by cell with the headers read out.
 *
 * The colour ramp stops at 60% strength: every cell carries its number, and
 * the ordinary foreground has to clear 4.5:1 on the darkest of them in both
 * themes. The triangle of empty cells is the future, not missing data, so it
 * is left blank rather than drawn as zero.
 */
export function CohortChart({
  periods,
  cohorts,
  label,
  format = (value) => `${String(Math.round(value))}%`,
  min: minProp,
  max: maxProp,
  tone = 'chart-1',
  summary,
  className,
}: CohortChartProps): JSX.Element {
  const present = cohorts.flatMap((cohort) =>
    cohort.values.filter((value): value is number => value !== null),
  );
  const low = minProp ?? Math.min(...present);
  const span = (maxProp ?? Math.max(...present)) - low || 1;

  return (
    <ChartFrame
      label={label}
      rows={cohorts.flatMap((cohort) =>
        cohort.values.flatMap((value, index) =>
          value === null ? [] : [{ label: `${cohort.label} · ${periods[index] ?? ''}`, value }],
        ),
      )}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-105 border-separate border-spacing-[3px] touch:min-w-80">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <td />
              {periods.map((period) => (
                <th
                  key={period}
                  scope="col"
                  className="pb-1 text-center text-[11px] font-semibold text-fg-subtle"
                >
                  {period}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((cohort) => (
              <tr key={cohort.label}>
                <th
                  scope="row"
                  className="w-[90px] pe-2 text-start text-xs font-medium whitespace-nowrap text-fg-muted touch:w-16"
                >
                  {cohort.label}
                </th>
                {periods.map((period, index) => {
                  const value = cohort.values[index] ?? null;
                  return (
                    <td key={period} className="p-0">
                      {value === null ? (
                        <span className="sr-only">Not yet</span>
                      ) : (
                        <span
                          className="grid h-[34px] min-w-10 place-items-center rounded-[6px] text-[11px] font-semibold tabular-nums text-fg motion-safe:animate-fade-in"
                          style={{
                            background: toneMix(
                              tone,
                              8 + Math.min(Math.max((value - low) / span, 0), 1) * 52,
                            ),
                            animationDelay: `min(calc(${String(index)} * 40ms), 240ms)`,
                          }}
                        >
                          {format(value)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
