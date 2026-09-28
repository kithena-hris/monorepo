import { useMemo, type JSX } from 'react';

import { BarChart, type ChartTone } from './chart';
import { binValues, type HistogramBin } from './geometry';

export interface HistogramChartProps {
  /** The raw values: one salary, one tenure, per person. */
  values: readonly number[];
  /** Width of each bin, in the values' unit. */
  step: number;
  /** First closed edge; values under it are counted in a "<start" bin. */
  start?: number;
  /** Last closed edge; values at or over it are counted in an "end+" bin. */
  end?: number;
  label: string;
  /** Names a bin on the axis and in the table. Defaults to its lower edge. */
  formatBin?: (bin: HistogramBin) => string;
  /** Formats a count. */
  format?: (count: number) => string;
  /** Points at one bin, "the median is here", greying the rest. */
  highlightIndex?: number;
  tone?: ChartTone;
  height?: number;
  /** What the chart shows, in a sentence, read before the data table. */
  summary?: string;
  className?: string;
}

function defaultBinLabel(bin: HistogramBin): string {
  if (bin.from === -Infinity) return `<${String(bin.to)}`;
  if (bin.to === Infinity) return `${String(bin.from)}+`;
  return String(bin.from);
}

/**
 * How values are spread: salaries, tenure, time to hire.
 *
 * A bar chart whose bars touch, because the ranges are continuous: a gap
 * between "40–50k" and "50–60k" would say there is something between them.
 * Binning is done here, from the raw values, so the chart and its table can
 * never disagree about which bin a person is in.
 */
export function HistogramChart({
  values,
  step,
  start,
  end,
  label,
  formatBin = defaultBinLabel,
  format,
  highlightIndex,
  tone,
  height,
  summary,
  className,
}: HistogramChartProps): JSX.Element {
  const bins = useMemo(
    () =>
      binValues(values, {
        step,
        ...(start === undefined ? {} : { start }),
        ...(end === undefined ? {} : { end }),
      }),
    [values, step, start, end],
  );

  return (
    <BarChart
      touching
      label={label}
      data={bins.map((bin) => ({ label: formatBin(bin), value: bin.count }))}
      {...(format === undefined ? {} : { format })}
      {...(highlightIndex === undefined ? {} : { highlightIndex })}
      {...(tone === undefined ? {} : { tone })}
      {...(height === undefined ? {} : { height })}
      {...(summary === undefined ? {} : { summary })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
