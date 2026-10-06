import { useState } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import type { ChartCommonProps } from './bar-chart.tsx';
import { AxisLabels, ChartFrame, ChartGrid, decor, pct, WEB } from './parts.tsx';
import { bgTone, type ChartTone } from './tones.ts';

export interface WaterfallStep {
  label: string;
  /** Signed for a movement; the absolute figure for a `total`. */
  value: number;
  /** An anchored bar: an opening or closing balance, or a subtotal. */
  total?: boolean;
  /** Overrides the tone derived from the sign. */
  tone?: ChartTone;
}

export interface WaterfallChartProps extends ChartCommonProps {
  data: readonly WaterfallStep[];
  /** Height of the plot. 170 on a phone. */
  height?: number;
  /**
   * `zero` anchors the axis at zero, as the phone's design draws it; `auto`
   * scales to the range the running figure covers, so small movements on a
   * large total stay visible.
   */
  baseline?: 'auto' | 'zero';
  /** Rings one step: the one the card's sentence is about. */
  highlightIndex?: number;
  onSelect?: (step: WaterfallStep, index: number) => void;
  selectedIndex?: number;
}

/** A signed figure with a true minus, so "−14" is not read as a hyphen. */
export function signed(value: number, format: (v: number) => string): string {
  if (value > 0) return `+${format(value)}`;
  if (value < 0) return `−${format(Math.abs(value))}`;
  return format(0);
}

/**
 * How a number got from start to end: rises in green, falls in red, totals in
 * the series colour, and every step's sign in words beside its bar so the
 * colour is never the only way to tell up from down. A tap on a step says it.
 */
export function WaterfallChart({
  data,
  label,
  summary,
  height = 170,
  baseline = 'zero',
  highlightIndex,
  onSelect,
  selectedIndex,
  format = (v) => String(v),
  menuItems,
  className,
}: WaterfallChartProps): React.JSX.Element {
  const [inspected, setInspected] = useState<number | undefined>();
  let running = 0;
  const spans = data.map((step) => {
    if (step.total) {
      running = step.value;
      return {
        low: Math.min(0, step.value),
        high: Math.max(0, step.value),
        kind: 'total' as const,
      };
    }
    const from = running;
    running += step.value;
    return {
      low: Math.min(from, running),
      high: Math.max(from, running),
      kind: step.value < 0 ? ('fall' as const) : ('rise' as const),
      from,
    };
  });
  const lowest = Math.min(...spans.map((s) => s.low));
  const highest = Math.max(...spans.map((s) => s.high));
  const auto = baseline === 'auto';
  const floor = auto ? lowest - (highest - lowest) * 0.15 : Math.min(0, lowest);
  const ceiling = auto ? highest + (highest - lowest) * 0.12 : highest * 1.12;
  const range = ceiling - floor || 1;
  const y = (v: number): number => ((v - floor) / range) * 100;

  return (
    <ChartFrame
      label={label}
      summary={summary}
      rows={data}
      format={format}
      menuItems={menuItems}
      className={cn('w-full', className)}
    >
      <View className="relative" style={{ height }}>
        <ChartGrid />
        {floor < 0 ? (
          <View
            {...decor}
            className="absolute right-0 left-0 z-10 h-0.5 bg-fg-subtle"
            style={{ bottom: pct(y(0)) }}
          />
        ) : null}
        <View className="absolute inset-0 flex-row gap-1">
          {data.map((step, i) => {
            const span = spans[i];
            if (!span) return null;
            const ringed = highlightIndex === i || selectedIndex === i || inspected === i;
            const figure = step.total ? format(step.value) : signed(step.value, format);
            const readout = `${step.label}: ${figure}`;
            const bottom = auto && step.total ? 0 : y(span.low);
            const top = y(span.high);
            const tone =
              step.tone ??
              (span.kind === 'total' ? 'chart-1' : span.kind === 'fall' ? 'danger' : 'success');
            return (
              <Pressable
                key={`${step.label}-${String(i)}`}
                accessibilityLabel={readout}
                {...(onSelect
                  ? WEB
                    ? { role: 'button' as const, 'aria-pressed': selectedIndex === i }
                    : {
                        accessibilityRole: 'button' as const,
                        accessibilityState: { selected: selectedIndex === i },
                      }
                  : { accessibilityRole: 'image' as const })}
                onPress={() => {
                  if (onSelect) onSelect(step, i);
                  else setInspected(inspected === i ? undefined : i);
                }}
                className="relative h-full min-w-0 flex-1"
              >
                <View
                  {...decor}
                  className={cn(
                    'absolute right-[8%] left-[8%] rounded-[6px]',
                    bgTone[tone],
                    ringed && 'outline-2 outline-offset-2 outline-fg',
                  )}
                  style={{ bottom: pct(bottom), height: pct(Math.max(top - bottom, 0.8)) }}
                />
                <CssText
                  {...decor}
                  numberOfLines={1}
                  className={cn(
                    'absolute -right-1 -left-1 text-center text-[11px] leading-none font-bold tabular-nums',
                    ringed ? 'text-fg' : 'text-fg-muted',
                  )}
                  style={{ bottom: pct(top), marginBottom: 6 }}
                >
                  {figure}
                </CssText>
              </Pressable>
            );
          })}
        </View>
      </View>
      <AxisLabels columns gap={4} labels={data.map((step) => step.label)} />
    </ChartFrame>
  );
}
