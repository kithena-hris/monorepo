import type { JSX } from 'react';

import { cn } from '../../lib/cn';
import { bgTone, type ChartTone } from './chart';
import { ChartFrame } from './chart-window';

/**
 * Spans laid along one fixed axis: a working day from 07:00 to 19:00, a
 * shift, a booking window. One row, no lanes.
 *
 * ### The axis is fixed, not fitted
 *
 * `domain` is the whole bar whatever the segments are, so five bars stacked
 * for five days line up hour for hour, and an empty morning is a gap rather
 * than a bar that starts somewhere else. A segment outside the domain is
 * clipped to it.
 *
 * ### It never reads the clock
 *
 * `now` is a value on the axis, passed in, like every other "today" in this
 * system: a component that reads the clock cannot be screenshot-tested.
 *
 * ### Words under the colour
 *
 * Each segment has a label, and every segment is written out in a hidden table
 * with its start and end, so a hatched stripe and a thin band are facts to a
 * screen reader rather than shapes. The colour and the pattern tell segments
 * apart; they never carry a value on their own.
 */

export interface RangeBarSegment {
  /** On the same scale as `domain`. */
  start: number;
  end: number;
  /** What the span is: "Worked", "Break". Read out with its times. */
  label: string;
  tone?: ChartTone;
  /** `hatched` for a span that is not final: still running, planned, missing. */
  pattern?: 'hatched';
  /** `thin` draws a narrower band through the middle: a pause inside a span. */
  size?: 'full' | 'thin';
}

export interface RangeBarProps {
  /** Names the bar: "Tuesday 13 October". */
  label: string;
  /** The axis, start and end, on whatever scale the segments use. */
  domain: readonly [number, number];
  segments: readonly RangeBarSegment[];
  /** A vertical marker at this point on the axis, from the caller's clock. */
  now?: number | undefined;
  /** Where the axis labels sit. Five evenly spaced by default; `[]` hides the axis. */
  ticks?: readonly number[];
  /** Formats a tick and the times in the hidden table. */
  format?: (value: number) => string;
  /** What the bar shows, in a sentence, read before the table. */
  summary?: string;
  className?: string;
}

export function RangeBar({
  label,
  domain,
  segments,
  now,
  ticks,
  format = String,
  summary,
  className,
}: RangeBarProps): JSX.Element {
  const [from, to] = domain;
  const span = to - from || 1;
  const at = (value: number): number => (Math.min(Math.max(value, from), to) - from) / span;
  const axis = ticks ?? Array.from({ length: 5 }, (_, index) => from + (span * index) / 4);

  return (
    <ChartFrame
      label={label}
      rows={segments.map((segment) => ({
        label: segment.label,
        value: segment.end - segment.start,
      }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <div aria-hidden className="relative h-7.5 rounded-sm bg-surface-sunken touch:h-6.5">
        {segments.map((segment, index) => {
          const left = at(segment.start);
          const thin = segment.size === 'thin';
          return (
            <span
              key={index}
              className={cn(
                'absolute',
                thin ? 'inset-y-[32%] rounded-[3px]' : 'inset-y-0 rounded-sm',
                bgTone[segment.tone ?? 'chart-1'],
                segment.pattern === 'hatched' && 'pattern-hatched',
              )}
              style={{
                insetInlineStart: `${String(left * 100)}%`,
                width: `${String(Math.max(at(segment.end) - left, 0) * 100)}%`,
              }}
            />
          );
        })}
        {now !== undefined && now >= from && now <= to ? (
          <span
            className="absolute -inset-y-1 -ms-px w-0.5 rounded-full bg-fg"
            style={{ insetInlineStart: `${String(at(now) * 100)}%` }}
          />
        ) : null}
      </div>
      {axis.length > 0 ? (
        <div
          aria-hidden
          className="relative mt-1.5 h-3 text-2xs leading-none font-medium text-fg-subtle tabular-nums"
        >
          {axis.map((tick, index) => (
            <span
              key={tick}
              className={cn(
                'absolute',
                // The first and last labels sit inside the bar's ends rather
                // than centred on them, or they would hang off the card.
                index === 0
                  ? 'translate-x-0'
                  : index === axis.length - 1
                    ? '-translate-x-full'
                    : '-translate-x-1/2',
              )}
              style={{ insetInlineStart: `${String(at(tick) * 100)}%` }}
            >
              {format(tick)}
            </span>
          ))}
        </div>
      ) : null}
      <div className="sr-only">
        <table>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Segment</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment, index) => (
              <tr key={index}>
                <th scope="row">{segment.label}</th>
                <td>{format(segment.start)}</td>
                <td>{format(segment.end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartFrame>
  );
}
