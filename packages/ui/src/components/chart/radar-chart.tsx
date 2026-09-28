import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { ChartLegend, fillTone, seriesTone, strokeTone, type ChartTone } from './chart';
import { ChartFrame } from './chart-window';
import { radarPoints } from './geometry';

export interface RadarSeries {
  label: string;
  tone?: ChartTone;
  /** One value per axis, in the same order as `axes`. */
  values: readonly number[];
}

export interface RadarChartProps {
  /** The qualities compared, five to eight of them. */
  axes: readonly string[];
  /** One or two series. A third polygon covers the other two. */
  series: readonly RadarSeries[];
  label: string;
  /** The top of the scale, shared by every axis. */
  max?: number;
  format?: (value: number) => string;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
  className?: string;
}

// The drawing's own coordinate space. The SVG scales uniformly to its
// container, so these are proportions, never pixels.
const WIDTH = 240;
const HEIGHT = 220;
const CENTER = { x: 120, y: 110 };
const RADIUS = 78;
const RINGS = [0.25, 0.5, 0.75, 1];

const toPoints = (points: readonly [number, number][]): string =>
  points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

/**
 * A few things compared across five to eight qualities: a person's skills
 * against their level's expectation.
 *
 * Good at shape ("strong on delivery, light on mentoring") and bad at
 * precision: two areas are hard to compare, and the order of the axes changes
 * the picture. So the values are always in the table underneath, and for a
 * decision that turns on the numbers, a bar chart is the better tool.
 *
 * The axis labels are HTML placed at percentages of the drawing, not SVG
 * text: they keep to the type scale however small the chart is drawn.
 */
export function RadarChart({
  axes,
  series,
  label,
  max = 5,
  format = (value) => String(value),
  summary,
  className,
}: RadarChartProps): JSX.Element {
  const ring = (fraction: number): string =>
    toPoints(
      radarPoints(
        axes.map(() => max * fraction),
        max,
        RADIUS,
        CENTER,
      ),
    );
  const spokes = radarPoints(
    axes.map(() => max),
    max,
    RADIUS,
    CENTER,
  );
  const labels = radarPoints(
    axes.map(() => max),
    max,
    RADIUS + 20,
    CENTER,
  );

  return (
    <ChartFrame
      label={label}
      rows={series.flatMap((entry) =>
        axes.map((axis, index) => ({
          label: `${entry.label} · ${axis}`,
          value: entry.values[index] ?? 0,
        })),
      )}
      {...(summary === undefined ? {} : { summary })}
      className={cn('flex w-full flex-col items-center', className)}
    >
      <div className="relative aspect-[240/220] w-full max-w-80">
        <svg aria-hidden viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} className="size-full">
          {RINGS.map((fraction) => (
            <polygon
              key={fraction}
              points={ring(fraction)}
              fill="none"
              strokeWidth={1}
              className="stroke-border-strong"
            />
          ))}
          {spokes.map(([x, y], index) => (
            <line
              key={axes[index]}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={x}
              y2={y}
              strokeWidth={1}
              className="stroke-border"
            />
          ))}
          {series.map((entry, index) => {
            const tone = entry.tone ?? seriesTone(index);
            const points = radarPoints(entry.values, max, RADIUS, CENTER);
            return (
              // Grows out of the centre: the polygon is drawn from the middle
              // of the chart, the same point every value is measured from.
              <g
                key={entry.label}
                className="origin-center motion-safe:animate-pop-in [transform-box:view-box]"
                style={{ animationDelay: `${String(index * 80)}ms` }}
              >
                <polygon
                  points={toPoints(points)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  className={cn(fillTone[tone], strokeTone[tone])}
                  style={{ fillOpacity: 0.16 }}
                />
                {points.map(([x, y], vertex) => (
                  <circle key={axes[vertex]} cx={x} cy={y} r={2.5} className={fillTone[tone]} />
                ))}
              </g>
            );
          })}
        </svg>

        {labels.map(([x, y], index) => (
          <span
            key={axes[index]}
            aria-hidden
            className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] font-medium whitespace-nowrap text-fg-muted"
            style={{
              left: `${String((x / WIDTH) * 100)}%`,
              top: `${String((y / HEIGHT) * 100)}%`,
            }}
          >
            {axes[index]}
          </span>
        ))}
      </div>

      {series.length > 1 ? (
        <ChartLegend
          className="mt-3.5 justify-center"
          items={series.map((entry, index) => ({
            label: entry.label,
            tone: entry.tone ?? seriesTone(index),
          }))}
        />
      ) : null}

      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Quality</th>
              {series.map((entry) => (
                <th key={entry.label} scope="col">
                  {entry.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {axes.map((axis, index) => (
              <tr key={axis}>
                <th scope="row">{axis}</th>
                {series.map((entry) => (
                  <td key={entry.label}>
                    {format(entry.values[index] ?? 0)} of {format(max)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
