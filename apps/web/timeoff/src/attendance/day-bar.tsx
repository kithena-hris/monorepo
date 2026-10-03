import { RangeBar, type ChartLegendItem, type RangeBarSegment } from '@reach/ui';
import type { JSX } from 'react';

import { clockTime, type Day } from './time';

/**
 * A day as a bar from 07:00 to 19:00 (§11.3): worked, break, overtime,
 * missing, planned. The top bar's clock, the timesheet's rows and the
 * team's board draw the same one.
 */

const SEGMENT: Record<string, Pick<RangeBarSegment, 'label' | 'tone' | 'pattern' | 'size'>> = {
  worked: { label: 'Worked', tone: 'success' },
  live: { label: 'Working now', tone: 'success', pattern: 'hatched' },
  break: { label: 'Break', tone: 'warning', size: 'thin' },
  overtime: { label: 'Overtime', tone: 'info' },
  missing: { label: 'Missing', tone: 'danger', pattern: 'hatched' },
  planned: { label: 'Planned', tone: 'neutral' },
};

/** 07:00 to 19:00, in minutes after midnight. */
export const DAY: readonly [number, number] = [420, 1140];

export function DayBar({
  label,
  segments,
  now,
  axis = true,
  className,
}: {
  /** Names the bar: "Wednesday 30 September". */
  readonly label: string;
  readonly segments: Day['segments'];
  /** The minute it is now, for the marker; absent on a day that is not today. */
  readonly now?: number | undefined;
  /** The hours under it; off in a row of a table, whose header has them. */
  readonly axis?: boolean;
  readonly className?: string;
}): JSX.Element {
  return (
    <RangeBar
      label={label}
      domain={DAY}
      ticks={axis ? [420, 600, 780, 960, 1140] : []}
      format={clockTime}
      now={now}
      {...(className === undefined ? {} : { className })}
      segments={segments.map((s) => ({
        start: s.from,
        end: s.to,
        ...(SEGMENT[s.kind] ?? { label: s.kind }),
      }))}
    />
  );
}

/** What the bar's colours mean, once under a list of them (`ChartLegend`). */
export const LEGEND: readonly ChartLegendItem[] = [
  'worked',
  'break',
  'overtime',
  'missing',
  'planned',
].map((kind) => ({ label: SEGMENT[kind]?.label ?? kind, tone: SEGMENT[kind]?.tone ?? 'neutral' }));
