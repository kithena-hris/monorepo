import type { ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';
import { Line, Path, Polygon } from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import { radarPoints } from './geometry.ts';
import { ChartFrame, ChartLegend, decor, Ink, WEB } from './parts.tsx';
import { inkTone, seriesTone, type ChartTone } from './tones.ts';

export interface GaugeProps {
  value: number;
  /** What is measured, for a screen reader: "Hiring plan". */
  label: string;
  max?: number;
  /** A tick on the arc at this value. */
  target?: number;
  /** The figure in the middle. The percentage when omitted. */
  display?: ReactNode;
  /** A line under the figure: "of hiring plan". */
  description?: string;
  tone?: ChartTone;
  /** Across, in points. 180 on a phone. */
  size?: number;
  className?: string | undefined;
}

/**
 * How close one number is to one target: the figure large, the arc under it.
 * Past the maximum the arc stays full and the figure says by how much.
 */
export function Gauge({
  value,
  label,
  max = 100,
  target,
  display,
  description,
  tone = 'accent',
  size = 180,
  className,
}: GaugeProps): React.JSX.Element {
  const k = size / 100;
  const height = Math.round(size * 0.64);
  const share = Math.min(Math.max(value / max, 0), 1);
  const arc = `M ${String(10 * k)} ${String(55 * k)} A ${String(40 * k)} ${String(40 * k)} 0 0 1 ${String(90 * k)} ${String(55 * k)}`;
  const length = Math.PI * 40 * k;
  const figure = display ?? `${String(Math.round((value / max) * 100))}%`;
  const said = `${label}: ${typeof figure === 'string' ? figure : String(value)}${
    target === undefined ? '' : `, target ${String(Math.round((target / max) * 100))}%`
  }${description ? `, ${description}` : ''}`;
  const angle = target === undefined ? 0 : Math.PI * (1 - Math.min(target / max, 1));

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={said}
      {...(WEB ? { role: 'img', 'aria-label': said } : {})}
      className={cn('items-center', className)}
      style={{ width: size, height }}
    >
      <Ink width={size} height={height} className="text-surface-active">
        <Path
          d={arc}
          fill="none"
          stroke="currentColor"
          strokeWidth={10 * k}
          strokeLinecap="round"
        />
      </Ink>
      {share > 0 ? (
        <Ink width={size} height={height} className={inkTone[tone]}>
          <Path
            d={arc}
            fill="none"
            stroke="currentColor"
            strokeWidth={10 * k}
            strokeLinecap="round"
            strokeDasharray={`${(length * share).toFixed(1)} ${(length * 2).toFixed(1)}`}
          />
        </Ink>
      ) : null}
      {target === undefined ? null : (
        <Ink width={size} height={height} className="text-fg">
          <Line
            x1={(50 + 33 * Math.cos(angle)) * k}
            y1={(55 - 33 * Math.sin(angle)) * k}
            x2={(50 + 47 * Math.cos(angle)) * k}
            y2={(55 - 47 * Math.sin(angle)) * k}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Ink>
      )}
      <View {...decor} className="absolute right-0 bottom-0 left-0 items-center">
        {typeof figure === 'string' || typeof figure === 'number' ? (
          <CssText
            className="font-bold text-fg tabular-nums"
            // In points: a unitless `leading-none` becomes 1pt where the size is inline.
            style={{
              fontSize: Math.round(size * 0.16),
              lineHeight: Math.round(size * 0.16),
              letterSpacing: -0.03 * size * 0.16,
            }}
          >
            {figure}
          </CssText>
        ) : (
          figure
        )}
        {description ? (
          <CssText className="mt-1 text-center text-[12px] leading-[1.3] font-medium text-fg-muted">
            {description}
          </CssText>
        ) : null}
      </View>
    </View>
  );
}

export interface RadarSeries {
  label: string;
  tone?: ChartTone;
  values: readonly number[];
}

export interface RadarChartProps {
  /** Five to eight qualities. Fewer is a bar chart; more is a hairball. */
  axes: readonly string[];
  series: readonly RadarSeries[];
  label: string;
  /** The top of every axis: 5 for a five-point rating. */
  max?: number;
  format?: (value: number) => string;
  summary?: string;
  className?: string | undefined;
}

const toneOf = (s: RadarSeries, k: number): ChartTone => s.tone ?? seriesTone(k);

const W = 240;
const H = 220;
const CENTER = { x: 120, y: 110 };
const R = 78;

/**
 * A few items across five to eight qualities. Shapes are read, not values, so
 * the hidden table carries every score and the legend names each outline.
 */
export function RadarChart({
  axes,
  series,
  label,
  max = 5,
  format = (v) => String(v),
  summary,
  className,
}: RadarChartProps): React.JSX.Element {
  const ring = (f: number): string =>
    radarPoints(
      axes.map(() => max * f),
      max,
      R,
      CENTER,
    )
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ');
  const outer = radarPoints(
    axes.map(() => max),
    max,
    R,
    CENTER,
  );
  const labelAt = radarPoints(
    axes.map(() => max),
    max,
    R + 18,
    CENTER,
  );

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={series.flatMap((s) =>
        axes.map((axis, i) => ({ label: `${s.label}, ${axis}`, value: s.values[i] ?? 0 })),
      )}
      format={format}
      className={cn('w-full items-center', className)}
    >
      <View {...decor} style={{ width: W, height: H }}>
        <Ink width={W} height={H} className="text-border-strong">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <Polygon key={f} points={ring(f)} fill="none" stroke="currentColor" strokeWidth={1} />
          ))}
        </Ink>
        <Ink width={W} height={H} className="text-border">
          {outer.map(([x, y], i) => (
            <Line
              key={axes[i]}
              x1={CENTER.x}
              y1={CENTER.y}
              x2={x}
              y2={y}
              stroke="currentColor"
              strokeWidth={1}
            />
          ))}
        </Ink>
        {series.map((s, k) => (
          <Ink key={s.label} width={W} height={H} className={inkTone[toneOf(s, k)]}>
            <Polygon
              points={radarPoints(s.values, max, R, CENTER)
                .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
                .join(' ')}
              fill="currentColor"
              fillOpacity={0.16}
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </Ink>
        ))}
        {labelAt.map(([x, y], i) => (
          <View
            key={axes[i]}
            className="absolute w-[100px] items-center"
            style={{ left: x - 50, top: y - 7 }}
          >
            <CssText
              numberOfLines={1}
              className="text-[11px] leading-[1.2] font-medium text-fg-muted"
            >
              {axes[i]}
            </CssText>
          </View>
        ))}
      </View>
      {series.length > 1 ? (
        <ChartLegend items={series.map((s, k) => ({ label: s.label, tone: toneOf(s, k) }))} />
      ) : null}
    </ChartFrame>
  );
}
