import { View } from 'react-native';
import { Text as CssText } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { ChartFrame } from './parts.tsx';
import { bgTone, type ChartTone } from './tones.ts';

/**
 * Spans laid along one fixed axis, as the web's `RangeBar`: a working day
 * from 07:00 to 19:00, a shift, a booking window. One row, no lanes.
 *
 * The axis is the whole bar whatever the segments are, so bars stacked for
 * five days line up hour for hour. `now` is a value on the axis, passed in:
 * a component that reads the clock cannot be screenshot-tested. Each segment
 * has a label, read out with its length in the chart's hidden table, so a
 * thin band is a fact to a screen reader rather than a shape.
 */
export type RangeBarSegment = {
  /** On the same scale as `domain`. */
  start: number;
  end: number;
  /** What the span is: "Worked", "Break". */
  label: string;
  tone?: ChartTone;
  /** For a span that is not final (still running, planned, missing): drawn lighter. */
  pattern?: 'hatched';
  /** `thin`: a narrower band through the middle, a pause inside a span. */
  size?: 'full' | 'thin';
};

export type RangeBarProps = {
  /** Names the bar: "Tuesday 13 October". */
  label: string;
  domain: readonly [number, number];
  segments: readonly RangeBarSegment[];
  /** A vertical marker at this point on the axis, from the caller's clock. */
  now?: number | undefined;
  /** Where the axis labels sit. Five evenly spaced by default; `[]` hides the axis. */
  ticks?: readonly number[];
  /** Formats a tick and the lengths in the hidden table. */
  format?: (value: number) => string;
  summary?: string;
  className?: string | undefined;
};

export function RangeBar({
  label,
  domain,
  segments,
  now,
  ticks,
  format = String,
  summary,
  className,
}: RangeBarProps): React.JSX.Element {
  const [from, to] = domain;
  const span = to - from || 1;
  const at = (value: number): number => (Math.min(Math.max(value, from), to) - from) / span;
  const axis = ticks ?? Array.from({ length: 5 }, (_, index) => from + (span * index) / 4);
  const pct = (n: number): `${number}%` => `${String(n * 100)}%` as `${number}%`;
  return (
    <ChartFrame
      label={label}
      rows={segments.map((s) => ({ label: s.label, value: s.end - s.start }))}
      {...(summary === undefined ? {} : { summary })}
      className={cn('w-full', className)}
    >
      <View className="relative h-6.5 rounded-sm bg-surface-sunken">
        {segments.map((s, index) => {
          const left = at(s.start);
          return (
            <View
              key={index}
              className={cn(
                'absolute',
                s.size === 'thin' ? 'rounded-[3px]' : 'inset-y-0 rounded-sm',
                bgTone[s.tone ?? 'chart-1'],
                s.pattern === 'hatched' && 'opacity-50',
              )}
              style={{
                left: pct(left),
                width: pct(Math.max(at(s.end) - left, 0)),
                ...(s.size === 'thin' ? { top: '32%', bottom: '32%' } : {}),
              }}
            />
          );
        })}
        {now !== undefined && now >= from && now <= to ? (
          <View
            className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-fg"
            style={{ left: pct(at(now)), marginLeft: -1 }}
          />
        ) : null}
      </View>
      {axis.length > 0 ? (
        <View className="relative mt-1.5 h-3.5">
          {axis.map((tick, index) => (
            <CssText
              key={tick}
              className="absolute text-[11px] leading-[14px] font-medium text-fg-subtle"
              style={{
                left: pct(at(tick)),
                // The first and last labels sit inside the ends rather than hanging off them.
                transform: [{ translateX: index === 0 ? 0 : index === axis.length - 1 ? -34 : -17 }],
              }}
            >
              {format(tick)}
            </CssText>
          ))}
        </View>
      ) : null}
    </ChartFrame>
  );
}
