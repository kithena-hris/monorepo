import { useMemo, type CSSProperties, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { ChartDataTable, ChartMark, seriesTone, toneVar, type ChartTone } from './chart';
import { ChartFrame } from './chart-window';
import { squarify } from './geometry';

export interface TreemapItem {
  label: string;
  value: number;
  tone?: ChartTone;
}

export interface TreemapChartProps {
  data: readonly TreemapItem[];
  label: string;
  format?: (value: number) => string;
  /** Keeps one part in colour and greys the rest, to point at it. */
  highlightIndex?: number;
  /**
   * Width over height of the drawing. The layout is computed for this shape
   * and the box keeps it at any width, so the cells stay as square as the
   * algorithm made them.
   */
  aspectRatio?: number;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
  className?: string;
}

/**
 * Parts of a whole when there are too many for a donut: payroll by team,
 * headcount by site. The area of each cell is its value.
 *
 * Laid out with the squarified algorithm, which keeps cells close to square,
 * because a square is the only rectangle whose area the eye can compare with
 * another's. The layout is computed once for the box's shape; the box then
 * scales to its container with `aspect-ratio`, so nothing is measured.
 *
 * Cells are tinted rather than solid. A label sits on every cell, and the
 * palette's lighter hues cannot carry text at 4.5:1 in either colour; a tint
 * of the hue can carry the ordinary foreground in both themes.
 */
export function TreemapChart({
  data,
  label,
  format = (value) => String(value),
  highlightIndex,
  aspectRatio = 1.75,
  summary,
  className,
}: TreemapChartProps): JSX.Element {
  const total = data.reduce((sum, item) => sum + Math.max(item.value, 0), 0) || 1;
  const rects = useMemo(
    () =>
      squarify(
        data.map((item) => item.value),
        { x: 0, y: 0, width: 100 * aspectRatio, height: 100 },
      ),
    [data, aspectRatio],
  );

  return (
    <ChartFrame
      label={label}
      rows={data}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div
        // The layout is computed for one shape; a phone draws the same layout
        // taller. Scaling a box in x and y keeps every area in proportion, so
        // the cells stay true, just less square.
        className="relative aspect-(--treemap-ratio) w-full touch:aspect-[4/3]"
        style={{ '--treemap-ratio': String(aspectRatio) } as CSSProperties}
      >
        {data.map((item, index) => {
          const rect = rects[index];
          if (!rect || rect.width === 0) return null;
          const quiet = highlightIndex !== undefined && highlightIndex !== index;
          const share = item.value / total;
          const readout = `${item.label}: ${format(item.value)} (${String(Math.round(share * 100))}%)`;
          // Text only where it fits: a short cell is a colour and a tooltip,
          // not a label squeezed to nothing. Width is left to a container
          // query on the cell, which knows its real size.
          const roomy = rect.height > 16;
          return (
            <ChartMark key={item.label} content={readout}>
              <div
                role="img"
                tabIndex={0}
                aria-label={readout}
                className={cn(
                  '@container absolute flex flex-col justify-between overflow-hidden rounded-[10px] p-2.5',
                  'motion-safe:animate-pop-in',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                  quiet ? 'bg-surface-active text-fg-muted' : 'text-fg',
                )}
                style={{
                  // A 3px gutter, taken half from each neighbour.
                  left: `calc(${String(rect.x / aspectRatio)}% + 1.5px)`,
                  top: `calc(${String(rect.y)}% + 1.5px)`,
                  width: `calc(${String(rect.width / aspectRatio)}% - 3px)`,
                  height: `calc(${String(rect.height)}% - 3px)`,
                  ...(quiet
                    ? {}
                    : {
                        background: `color-mix(in oklab, ${toneVar[item.tone ?? seriesTone(index)]} 40%, var(--color-surface))`,
                        boxShadow: `inset 0 3px 0 ${toneVar[item.tone ?? seriesTone(index)]}`,
                      }),
                  animationDelay: `min(calc(${String(index)} * 40ms), 240ms)`,
                }}
              >
                {roomy ? (
                  <>
                    <span className="truncate text-[13px] leading-tight font-semibold @max-[4.5rem]:hidden">
                      {item.label}
                    </span>
                    <span className="truncate font-display text-lg leading-none font-bold tabular-nums @max-[4.5rem]:hidden">
                      {format(item.value)}
                    </span>
                  </>
                ) : null}
              </div>
            </ChartMark>
          );
        })}
      </div>

      <ChartDataTable caption={label} data={data} format={format} valueLabel="Value" />
    </ChartFrame>
  );
}
