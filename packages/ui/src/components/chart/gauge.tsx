import type { JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { strokeTone, type ChartTone } from './chart';

export interface GaugeProps {
  /** How far along, in the same unit as `max`. */
  value: number;
  /** The accessible name: what is being measured, "Hiring plan". */
  label: string;
  /** The full scale. Defaults to 100, so `value` reads as a percentage. */
  max?: number;
  /** Where the goal sits on the scale, drawn as a tick across the arc. */
  target?: number;
  /** The figure in the middle. Defaults to the value as a percentage of `max`. */
  display?: ReactNode;
  /** A line under the figure: "of hiring plan", "Over budget". */
  description?: string;
  tone?: ChartTone;
  /** Width in pixels. The gauge never grows past its container. */
  size?: number;
  className?: string;
}

// The arc runs from 180° to 0°, radius 40, centred at (50, 55) in a 100 x 64
// box: the flat side at the bottom leaves room for the figure under it.
const ARC = 'M 10 55 A 40 40 0 0 1 90 55';

/**
 * Progress towards one target, as a half ring with the number large inside.
 *
 * Use it only where "how close are we" is the question, and one per card. For
 * several targets side by side, a bullet chart says the same in a tenth of
 * the space. The number is the point; the arc is how far it is from done.
 *
 * A `meter`, because that is what it is: assistive technology announces a
 * value within a range without being told how to read an arc. Values over the
 * scale fill the arc and say so in the figure, rather than wrapping round.
 */
export function Gauge({
  value,
  label,
  max = 100,
  target,
  display,
  description,
  tone = 'chart-1',
  size = 200,
  className,
}: GaugeProps): JSX.Element {
  const share = max > 0 ? value / max : 0;
  const shown = display ?? `${String(Math.round(share * 100))}%`;
  const angle = target === undefined ? 0 : Math.PI * (1 - Math.min(Math.max(target / max, 0), 1));

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuetext={[
        typeof shown === 'string' ? shown : `${String(Math.round(share * 100))}%`,
        description,
        target === undefined ? undefined : `target ${String(target)}`,
      ]
        .filter(Boolean)
        .join(', ')}
      // `@container` so the figure is sized to the ring, not to the page.
      className={cn('@container relative aspect-[100/64] max-w-full', className)}
      style={{ width: size }}
    >
      <svg aria-hidden viewBox="0 0 100 64" className="size-full">
        <path
          d={ARC}
          fill="none"
          strokeWidth={10}
          strokeLinecap="round"
          className="stroke-surface-active"
        />
        <path
          d={ARC}
          fill="none"
          strokeWidth={10}
          strokeLinecap="round"
          pathLength={1}
          // A dash the length of the share, drawn in from the left with the
          // same keyframe the donut uses.
          strokeDasharray={`${String(Math.min(Math.max(share, 0), 1))} 1`}
          className={cn(strokeTone[tone], share <= 0 && 'hidden', 'motion-safe:animate-arc')}
        />
        {target === undefined ? null : (
          <line
            x1={50 + 33 * Math.cos(angle)}
            y1={55 - 33 * Math.sin(angle)}
            x2={50 + 47 * Math.cos(angle)}
            y2={55 - 47 * Math.sin(angle)}
            strokeWidth={2}
            strokeLinecap="round"
            className="stroke-fg"
          />
        )}
      </svg>
      <div aria-hidden className="absolute inset-x-0 bottom-0 text-center">
        <div className="font-display text-[16cqi] leading-none font-bold tracking-[-0.03em] tabular-nums">
          {shown}
        </div>
        {description === undefined ? null : (
          <div className="mt-1 text-xs font-medium text-fg-muted">{description}</div>
        )}
      </div>
    </div>
  );
}
