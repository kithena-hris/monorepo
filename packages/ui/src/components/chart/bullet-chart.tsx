import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { ChartMark } from './chart';
import { ChartFrame } from './chart-window';

export interface BulletMeasure {
  label: string;
  value: number;
  target: number;
  /** The end of the scale. */
  max: number;
  /**
   * The two qualitative thresholds, poor then fair: `[15, 25]` shades 0–15 as
   * poor, 15–25 as fair and the rest as good.
   */
  bands: readonly [number, number];
  /** The figure printed beside the bar: "30 / 25", "81%". Defaults to the value. */
  display?: string;
  /**
   * Whether more is better. Time to hire is the counter-example: under the
   * target is the good side, and the bar turns green there instead.
   */
  higherIsBetter?: boolean;
}

export interface BulletChartProps {
  data: readonly BulletMeasure[];
  label: string;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
  className?: string;
}

const percent = (value: number, max: number): string =>
  `${String((Math.min(Math.max(value, 0), max) / (max || 1)) * 100)}%`;

/**
 * One measure against a target and qualitative ranges, many to a card.
 *
 * Stephen Few's answer to a dashboard of gauges: the same "how close are we"
 * in a single line, so eight goals fit where one gauge did. The thick bar is
 * the value, the dark tick is the target, and the shaded bands behind say what
 * poor and fair look like. The bar turns green once the target is met, so
 * "met or not" reads without comparing positions.
 */
export function BulletChart({ data, label, summary, className }: BulletChartProps): JSX.Element {
  return (
    <ChartFrame
      label={label}
      rows={data.map((row) => ({ label: row.label, value: row.value }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('flex w-full flex-col gap-3.5', className)}
    >
      {data.map((row, index) => {
        const higher = row.higherIsBetter ?? true;
        const met = higher ? row.value >= row.target : row.value <= row.target;
        const shown = row.display ?? String(row.value);
        const readout = `${row.label}: ${shown}, target ${String(row.target)}${met ? ', met' : ''}`;

        return (
          <div
            key={row.label}
            className="grid grid-cols-[140px_minmax(0,1fr)_72px] items-center gap-3.5 touch:grid-cols-1 touch:gap-1.5"
          >
            <span className="text-sm font-medium text-fg-muted">
              {row.label}
              {/* On a phone the figure moves up beside the label, and the bar
                  gets the whole width. */}
              <span className="hidden text-fg touch:inline">
                {' · '}
                <b className="font-semibold">{shown}</b>
              </span>
            </span>

            <ChartMark content={readout}>
              <div
                role="img"
                tabIndex={0}
                aria-label={readout}
                className="relative h-6 overflow-hidden rounded-[6px] bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                <span
                  className="absolute inset-y-0 start-0 bg-surface-active"
                  style={{ width: percent(row.bands[1], row.max) }}
                />
                <span
                  className="absolute inset-y-0 start-0 bg-[color-mix(in_oklab,var(--color-fg-subtle)_35%,var(--color-surface-active))]"
                  style={{ width: percent(row.bands[0], row.max) }}
                />
                <span
                  className={cn(
                    'absolute inset-y-2 start-0 origin-left rounded-[3px] motion-safe:animate-grow-x',
                    met ? 'bg-success-fg' : 'bg-chart-1',
                  )}
                  style={{
                    width: percent(row.value, row.max),
                    animationDelay: `min(calc(${String(index)} * 60ms), 320ms)`,
                  }}
                />
                <span
                  className="absolute inset-y-[3px] w-[3px] -translate-x-1/2 rounded-[2px] bg-fg"
                  style={{ insetInlineStart: percent(row.target, row.max) }}
                />
              </div>
            </ChartMark>

            <span className="text-end text-sm font-bold tabular-nums text-fg touch:hidden">
              {shown}
            </span>
          </div>
        );
      })}

      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col">Value</th>
              <th scope="col">Target</th>
              <th scope="col">Met</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => {
              const higher = row.higherIsBetter ?? true;
              const met = higher ? row.value >= row.target : row.value <= row.target;
              return (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{row.display ?? row.value}</td>
                  <td>{row.target}</td>
                  <td>{met ? 'Yes' : 'No'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
