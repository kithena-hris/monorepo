'use client';

import type { JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Tooltip } from '../tooltip/tooltip';
import { ChartFrame } from './chart-window';
import type { ChartTone } from './chart';

/**
 * How a number got from one value to another.
 *
 * The headcount bridge is the canonical one: *started at 842, hired 61, lost
 * 39, ended at 864*. A bar chart of those four numbers puts 842 next to 61 and
 * makes the movements invisible; a waterfall floats each movement at the level
 * the one before it left off, so the arithmetic is the picture.
 *
 * ### The totals are anchored, the movements float
 *
 * A `total` bar is drawn from the baseline and a movement from wherever the
 * running figure had reached. Getting that the wrong way round produces a chart
 * that looks right and adds up to nothing.
 *
 * ### Direction is a shape as well as a colour
 *
 * Rises and falls differ in tone *and* carry a sign in their label. Red and
 * green bars alone are the same bar to about 8% of men, and this is a chart
 * whose entire content is which way each step went.
 */

export interface WaterfallStep {
  label: string;
  /** Signed for a movement; the absolute figure for a `total`. */
  value: number;
  /** An anchored bar: an opening or closing balance, or a subtotal. */
  total?: boolean;
  /** Overrides the tone derived from the sign. */
  tone?: ChartTone;
}

export interface WaterfallChartProps {
  data: readonly WaterfallStep[];
  label: string;
  height?: number;
  /**
   * `auto` scales to the range the running figure actually covers; `zero`
   * anchors the axis at zero.
   *
   * `auto` is the default because a bridge is about the *movements*, and on a
   * zero axis they vanish: 118 hires against a headcount of 842 is a step 12%
   * as tall as the bar beside it, which is the chart telling you nothing
   * happened. The truncation is stated in the footer rather than hidden, which
   * is the condition on doing it at all, and on a cropped axis a total's
   * *height* is no longer comparable to anything, which is why its figure is
   * printed underneath it.
   */
  baseline?: 'auto' | 'zero';
  format?: (value: number) => string;
  onSelect?: (step: WaterfallStep, index: number) => void;
  selectedLabel?: string;
  /** Extra right-click commands. */
  menuItems?: ReactNode;
  className?: string;
}

const barTone: Record<ChartTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
};

export function WaterfallChart({
  data,
  label,
  height = 220,
  baseline = 'auto',
  format = (value) => String(value),
  onSelect,
  selectedLabel,
  menuItems,
  className,
}: WaterfallChartProps): JSX.Element {
  // One pass: where each bar starts, where it ends, and how far the running
  // figure has got. Totals reset to the baseline rather than stacking.
  let running = 0;
  const bars = data.map((step) => {
    const start = step.total === true ? 0 : running;
    const end = step.total === true ? step.value : running + step.value;
    running = end;
    return { step, start, end };
  });

  // A total's `start` is a drawing detail, not a value the chart reaches, so it
  // is left out of the range: otherwise the first opening balance drags the
  // floor to zero and squashes every movement into a sliver.
  const reached = bars.flatMap(({ step, start, end }) =>
    step.total === true ? [end] : [start, end],
  );
  const high = Math.max(...reached);
  const low = Math.min(...reached);
  // Generous, deliberately. A tight crop makes the movements tall and the
  // totals hairlines; this leaves the anchored bars enough height to read as
  // bars while the steps still carry the message.
  const pad = Math.max((high - low) * 0.35, 1);
  const ceiling = baseline === 'zero' ? Math.max(high, 0) : high + pad;
  const floor = baseline === 'zero' ? Math.min(low, 0) : low - pad;
  const span = Math.max(ceiling - floor, 1);
  const y = (value: number): number => ((ceiling - value) / span) * 100;
  /** Totals are drawn from the bottom of the axis, wherever that has landed. */
  const truncated = floor > 0;

  return (
    <ChartFrame
      label={label}
      rows={data.map((step) => ({ label: step.label, value: step.value }))}
      {...(menuItems ? { menuItems } : {})}
      className={cn('w-full', className)}
    >
      <div className="relative flex items-stretch gap-2" style={{ height }}>
        {/* The zero line, drawn only when the chart actually crosses it. */}
        {floor < 0 ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-border"
            style={{ top: `${String(y(0))}%` }}
          />
        ) : null}

        {bars.map(({ step, start, end }, index) => {
          const from = step.total === true ? floor : start;
          const top = Math.min(y(from), y(end));
          const size = Math.abs(y(end) - y(from));
          const rising = end >= start;
          const tone: ChartTone =
            step.tone ?? (step.total === true ? 'accent' : rising ? 'success' : 'danger');
          const selected = selectedLabel === step.label;
          const sign = step.total === true ? '' : rising ? '+' : '−';
          const readout = `${step.label}: ${sign}${format(Math.abs(step.value))}${
            step.total === true ? '' : `, running total ${format(end)}`
          }`;

          const bar = (
            <div
              role={onSelect ? 'button' : 'img'}
              aria-label={readout}
              tabIndex={0}
              onClick={
                onSelect
                  ? () => {
                      onSelect(step, index);
                    }
                  : undefined
              }
              className={cn(
                'absolute inset-x-0 rounded-xs transition-[opacity,filter] duration-(--animate-duration-fast)',
                'motion-safe:animate-grow-y',
                barTone[tone],
                step.total === true ? 'origin-bottom' : rising ? 'origin-bottom' : 'origin-top',
                onSelect && 'cursor-pointer hover:brightness-110',
                selected && 'ring-2 ring-border-focus ring-offset-1 ring-offset-surface',
                selectedLabel !== undefined && !selected && 'opacity-50',
              )}
              style={{
                top: `${String(top)}%`,
                // A movement of zero is still a step that happened. Two pixels
                // says "nothing changed here"; nothing at all says "no data".
                height: `max(${String(size)}%, 2px)`,
                animationDelay: `min(calc(${String(index)} * 60ms), 360ms)`,
              }}
            />
          );

          return (
            <div key={step.label} className="relative min-w-0 flex-1">
              <Tooltip content={readout} side="top">
                {bar}
              </Tooltip>

              {/* The connector to the next bar, so the eye follows the running
                  figure rather than hopping between columns. */}
              {index < bars.length - 1 ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute -end-2 w-2 border-t border-dashed border-border"
                  style={{ top: `${String(y(end))}%` }}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* A truncated axis, declared. Cropping the scale is what makes a bridge
          readable and what makes every other chart a lie, so the one condition
          is saying you did it. */}
      {truncated ? (
        <p className="mt-1 text-2xs text-fg-subtle">Axis starts at {format(Math.round(floor))}</p>
      ) : null}

      <div aria-hidden className="mt-1 flex gap-2 border-t border-border pt-1">
        {bars.map(({ step, end }) => (
          <div key={step.label} className="min-w-0 flex-1 text-center">
            <span className="block truncate text-2xs text-fg-subtle">{step.label}</span>
            <span className="block truncate text-2xs font-medium tabular-nums text-fg">
              {step.total === true
                ? format(end)
                : `${step.value >= 0 ? '+' : '−'}${format(Math.abs(step.value))}`}
            </span>
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Step</th>
            <th scope="col">Change</th>
            <th scope="col">Running total</th>
          </tr>
        </thead>
        <tbody>
          {bars.map(({ step, end }) => (
            <tr key={step.label}>
              <th scope="row">{step.label}</th>
              <td>
                {step.total === true
                  ? 'Balance'
                  : `${step.value >= 0 ? 'up ' : 'down '}${format(Math.abs(step.value))}`}
              </td>
              <td>{format(end)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ChartFrame>
  );
}
