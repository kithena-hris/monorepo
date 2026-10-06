import { Copy, Maximize2, ZoomIn, ZoomOut } from 'lucide-react-native';
import { useCallback, useState, type ReactNode } from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import { useCssElement } from 'react-native-css';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Svg from 'react-native-svg';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { useClipboard } from '../clipboard/clipboard.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';
import { List, ListItem } from '../list-item/list-item.tsx';
import { bgTone, borderTone, type ChartTone } from './tones.ts';

/**
 * The parts every chart is built from: the card, the frame that carries the
 * accessibility contract and the long-press menu, the grid, the axis labels,
 * the legend, and `Ink`, an SVG layer drawn in a token's colour.
 *
 * Bars, cells, bands and steps are views, as the web draws them in HTML:
 * they lay out with the card, take a token as a class, and can be real
 * buttons. Lines, areas and arcs are SVG on `react-native-svg`, measured once
 * with `onLayout` and drawn in points, so a stroke is never stretched and a
 * dot is never an ellipse.
 */

export const WEB = Platform.OS === 'web';

export interface ChartPoint {
  /** The category or period. Read as the row's name in the hidden table. */
  label: string;
  value: number;
  /**
   * What the axis prints where the label does not fit: a month's initial on a
   * phone. The readout and the hidden table still say the label.
   */
  axisLabel?: string;
}

/** A share of the parent, as a style length. */
export function pct(value: number): `${number}%` {
  return `${String(Number.isFinite(value) ? value : 0)}%` as `${number}%`;
}

/** Hides decoration from a screen reader on both platforms: the hidden summary says it instead. */
export const decor = WEB
  ? ({ 'aria-hidden': true } as const)
  : ({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    } as const);

/** A view's own width, once it has one. */
export function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  }, []);
  return [width, onLayout];
}

const inkMapping = {
  className: { target: 'style', nativeStyleMapping: { color: 'color' } },
} as const;

/**
 * An SVG layer whose marks draw in `currentColor`, coloured by a `text-*`
 * class. React Native passes no colour down, so a chart with three series is
 * three layers, one colour each: the same way `Icon` and `Progress` colour
 * their strokes.
 */
export function Ink({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className: string;
  children: ReactNode;
}): React.JSX.Element {
  const svg = useCssElement(
    Svg,
    {
      width,
      height,
      viewBox: `0 0 ${String(width)} ${String(height)}`,
      className,
      children,
    },
    inkMapping,
  );
  return (
    <View {...decor} className="pointer-events-none absolute top-0 left-0">
      {svg}
    </View>
  );
}

/**
 * Soft gridlines behind a plot: hairlines in the quiet border colour, with the
 * baseline one step stronger so the zero the bars stand on reads as a floor.
 */
export function ChartGrid({ lines = 4 }: { lines?: number }): React.JSX.Element {
  return (
    <View {...decor} className="pointer-events-none absolute inset-0 justify-between">
      {Array.from({ length: Math.max(lines - 1, 0) }, (_, index) => (
        <View key={index} className="h-px bg-border" />
      ))}
      <View className="h-px bg-border-strong" />
    </View>
  );
}

/** The 11pt label under an axis: a period, a category, a tick. */
export function AxisText({
  children,
  strong = false,
  align = 'center',
  className,
}: {
  children: ReactNode;
  strong?: boolean;
  align?: 'center' | 'left' | 'right';
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <CssText
      numberOfLines={1}
      className={cn(
        'text-[11px] leading-[1.1] font-medium',
        strong ? 'text-fg' : 'text-fg-subtle',
        align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </CssText>
  );
}

/**
 * Labels along the bottom. `columns` gives each label its column's width, under
 * its bar; otherwise they spread from edge to edge, under a line's ticks.
 */
export function AxisLabels({
  labels,
  columns = false,
  highlightIndex,
  gap = 6,
  className,
}: {
  labels: readonly string[];
  columns?: boolean;
  highlightIndex?: number | undefined;
  gap?: number;
  className?: string | undefined;
}): React.JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <View
      {...decor}
      className={cn('mt-2 flex-row', !columns && 'justify-between', className)}
      style={columns ? { gap } : undefined}
    >
      {labels.map((label, index) => (
        <View key={`${label}-${String(index)}`} className={cn(columns && 'min-w-0 flex-1')}>
          <AxisText strong={highlightIndex === index}>{label}</AxisText>
        </View>
      ))}
    </View>
  );
}

/** The value a tapped mark says, in a dark pill: the phone's tooltip. */
export function ChartReadout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      {...decor}
      className={cn('pointer-events-none', 'rounded-[8px] bg-invert px-2 py-[5px]', className)}
    >
      <CssText className="text-[12px] leading-none font-bold text-fg-on-invert tabular-nums">
        {children}
      </CssText>
    </View>
  );
}

export interface ChartLegendItem {
  label: string;
  tone: ChartTone;
  /** Drawn as a dashed stroke: a plan, a forecast, anything not yet measured. */
  dashed?: boolean;
  /** A swatch class for a mark not drawn in a tone: a quiet bar, a band. */
  swatch?: string | undefined;
}

/** A toggle's state: `aria-pressed` on the web, a checked toggle button to VoiceOver and TalkBack. */
function toggleProps(on: boolean) {
  return WEB
    ? ({ role: 'button', 'aria-pressed': on } as const)
    : ({ accessibilityRole: 'togglebutton', accessibilityState: { checked: on } } as const);
}

/**
 * The key under a chart. With `onHiddenChange` each entry is a pill that
 * switches its series on and off: a hidden series stays in the legend, struck
 * through, so there is always a way back.
 */
export function ChartLegend({
  items,
  hidden = [],
  onHiddenChange,
  marker = 'square',
  className,
}: {
  items: readonly ChartLegendItem[];
  hidden?: readonly string[];
  onHiddenChange?: (hidden: readonly string[]) => void;
  marker?: 'square' | 'line';
  className?: string | undefined;
}): React.JSX.Element {
  const toggles = onHiddenChange !== undefined;
  return (
    <View className={cn('mt-3.5 flex-row flex-wrap gap-x-4 gap-y-2', className)}>
      {items.map((item) => {
        const off = hidden.includes(item.label);
        const swatch = item.dashed ? (
          <View
            className={cn(
              'h-0 w-2.5 border-t-2 border-dashed',
              off ? 'border-fg-disabled' : borderTone[item.tone],
            )}
          />
        ) : (
          <View
            className={cn(
              'w-2.5 rounded-[3px]',
              marker === 'line' ? 'h-[3px]' : 'h-2.5',
              off ? 'bg-surface-active' : (item.swatch ?? bgTone[item.tone]),
            )}
          />
        );
        const text = (
          <CssText
            className={cn(
              'text-[12px] leading-none font-medium',
              off ? 'text-fg-subtle line-through' : 'text-fg-muted',
            )}
          >
            {item.label}
          </CssText>
        );
        if (!toggles) {
          return (
            <View key={item.label} className="flex-row items-center gap-1.5">
              {swatch}
              {text}
            </View>
          );
        }
        return (
          <Pressable
            key={item.label}
            {...toggleProps(!off)}
            accessibilityLabel={item.label}
            // 28 drawn, 44 to a finger.
            hitSlop={8}
            onPress={() => {
              onHiddenChange(
                off ? hidden.filter((entry) => entry !== item.label) : [...hidden, item.label],
              );
            }}
            className="h-7 flex-row items-center gap-1.5 rounded-full bg-surface-sunken px-2.5"
          >
            {swatch}
            {text}
          </Pressable>
        );
      })}
    </View>
  );
}

export type ChartCardProps = {
  /** What the chart measures, in words: "Headcount by team". */
  title: ReactNode;
  /** The headline figure, printed large above the chart. */
  value?: ReactNode;
  /** One line of context under the title or figure. */
  description?: ReactNode;
  /** Top-right slot: a period picker, a segmented control, zoom buttons. */
  action?: ReactNode;
  children?: ReactNode;
  className?: string | undefined;
};

/**
 * The card a chart sits in: the title first and quiet, the figure large,
 * then the chart. The phone's card: 22 round, 18 in, lifted off the canvas.
 */
export function ChartCard({
  title,
  value,
  description,
  action,
  children,
  className,
}: ChartCardProps): React.JSX.Element {
  return (
    <View className={cn('min-w-0 rounded-m-card bg-surface p-[18px] shadow-sm', className)}>
      <View
        className={cn(
          'flex-row flex-wrap items-start justify-between gap-3',
          value === undefined ? 'mb-4' : 'mb-5',
        )}
      >
        <View className="min-w-0 shrink">
          <CssText className="text-subhead leading-[1.4] font-medium text-fg-muted">
            {title}
          </CssText>
          {value === undefined ? null : (
            <CssText className="mt-1.5 text-[30px] leading-[1.1] font-bold tracking-[-0.9px] text-fg tabular-nums">
              {value}
            </CssText>
          )}
          {description === undefined ? null : (
            <CssText className="mt-1 text-subhead leading-[1.5] text-fg-muted">
              {description}
            </CssText>
          )}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}

/** Off the screen and still read: a screen reader's copy of what the chart draws. */
const hiddenStyle = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  borderWidth: 0,
} as const;

/**
 * Every value the chart draws, as rows: a table on the web, one line a row on
 * a phone. The whole series, never only the zoomed window.
 */
export function ChartDataTable({
  caption,
  data,
  valueLabel = 'Value',
  format = (value) => String(value),
}: {
  caption: string;
  data: readonly ChartPoint[];
  valueLabel?: string;
  format?: (value: number) => string;
}): React.JSX.Element {
  if (!WEB) {
    return (
      <View style={hiddenStyle}>
        <CssText accessible>
          {[caption, ...data.map((point) => `${point.label}: ${format(point.value)}`)].join('. ')}
        </CssText>
      </View>
    );
  }
  return (
    <View style={hiddenStyle} role="table" aria-label={caption}>
      <View role="row">
        <CssText role="columnheader">Period</CssText>
        <CssText role="columnheader">{valueLabel}</CssText>
      </View>
      {data.map((point, index) => (
        <View key={`${point.label}-${String(index)}`} role="row">
          <CssText role="rowheader">{point.label}</CssText>
          <CssText role="cell">{format(point.value)}</CssText>
        </View>
      ))}
    </View>
  );
}

export interface ChartWindow {
  /** Inclusive index of the first visible item. */
  start: number;
  /** Inclusive index of the last visible item. */
  end: number;
}

export interface UseChartWindowResult {
  window: ChartWindow;
  setWindow: (next: ChartWindow) => void;
  zoom: (factor: number) => void;
  pan: (direction: -1 | 1) => void;
  reset: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  windowed: boolean;
  /** `[start, end]` sliced out of any array of the same length. */
  slice: <T>(items: readonly T[]) => T[];
}

/**
 * The visible slice of an ordered axis, controlled or not, with the clamping
 * in one place: never fewer than two items, never past either end. The web's
 * hook, line for line.
 */
export function useChartWindow(
  total: number,
  controlled?: ChartWindow,
  onChange?: (next: ChartWindow) => void,
  initial?: ChartWindow,
): UseChartWindowResult {
  const [internal, setInternal] = useState<ChartWindow>(
    initial ?? { start: 0, end: Math.max(0, total - 1) },
  );
  const active = controlled ?? internal;

  const setWindow = useCallback(
    (next: ChartWindow): void => {
      const start = Math.max(0, Math.min(next.start, total - 2));
      const end = Math.max(start + 1, Math.min(next.end, total - 1));
      const clamped = { start, end };
      if (controlled === undefined) setInternal(clamped);
      onChange?.(clamped);
    },
    [controlled, onChange, total],
  );

  const zoom = useCallback(
    (factor: number): void => {
      const centre = (active.start + active.end) / 2;
      const half = ((active.end - active.start) / 2) * factor;
      setWindow({ start: Math.round(centre - half), end: Math.round(centre + half) });
    },
    [active, setWindow],
  );

  const pan = useCallback(
    (direction: -1 | 1): void => {
      const width = active.end - active.start;
      const delta = Math.max(1, Math.round(width / 3)) * direction;
      if (direction === -1 && active.start === 0) return;
      if (direction === 1 && active.end === total - 1) return;
      const start = Math.max(0, Math.min(active.start + delta, total - 1 - width));
      setWindow({ start, end: start + width });
    },
    [active, setWindow, total],
  );

  const reset = useCallback((): void => {
    setWindow({ start: 0, end: Math.max(0, total - 1) });
  }, [setWindow, total]);

  const slice = useCallback(
    <T,>(items: readonly T[]): T[] => items.slice(active.start, active.end + 1),
    [active.start, active.end],
  );

  return {
    window: active,
    setWindow,
    zoom,
    pan,
    reset,
    canZoomIn: active.end - active.start > 1,
    canZoomOut: active.start > 0 || active.end < total - 1,
    windowed: active.start > 0 || active.end < total - 1,
    slice,
  };
}

/**
 * The buttons behind every zoom gesture: a pinch is unreachable by a switch,
 * VoiceOver or an unsteady hand, so these are the primitive and the pinch is
 * the accelerator.
 */
export function ChartZoomControls({
  state,
  className,
}: {
  state: UseChartWindowResult;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View className={cn('flex-row items-center gap-1', className)}>
      <Button
        size="xs"
        accessibilityLabel="Zoom out"
        startIcon={<Icon icon={ZoomOut} />}
        disabled={!state.canZoomOut}
        onPress={() => {
          state.zoom(2);
        }}
      />
      <Button
        size="xs"
        accessibilityLabel="Zoom in"
        startIcon={<Icon icon={ZoomIn} />}
        disabled={!state.canZoomIn}
        onPress={() => {
          state.zoom(0.5);
        }}
      />
      <Button size="xs" variant="ghost" disabled={!state.windowed} onPress={state.reset}>
        Reset
      </Button>
    </View>
  );
}

/** Quoted, escaped, and de-fanged against a spreadsheet's formula parsing. */
function csvField(value: string): string {
  const neutralised = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly ChartPoint[]): string {
  return ['label,value', ...rows.map((row) => `${csvField(row.label)},${String(row.value)}`)].join(
    '\n',
  );
}

export interface ChartMenuItem {
  label: string;
  onPress: () => void;
}

export interface ChartFrameProps {
  /** Names the chart: read first, and the menu's title. */
  label: string;
  /**
   * One or two sentences saying what the chart shows: the trend, the outlier,
   * the answer. Read after the name, before the values.
   */
  summary?: string | undefined;
  /** Every value, for the hidden table and "Copy as CSV". */
  rows: readonly ChartPoint[];
  valueLabel?: string | undefined;
  format?: ((value: number) => string) | undefined;
  /** Present when the chart has an axis to window. */
  window?: UseChartWindowResult | undefined;
  /** Extra commands, after the chart's own. */
  menuItems?: readonly ChartMenuItem[] | undefined;
  /** The long-press menu, controlled. Uncontrolled when omitted. */
  menuOpen?: boolean | undefined;
  onMenuOpenChange?: ((open: boolean) => void) | undefined;
  /** For a story or a screen whose own overlay host should hold the menu. */
  portalHost?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}

/**
 * What every chart is wrapped in: the hidden summary and table a screen reader
 * reads instead of the marks, and the menu a long-press opens where the web
 * right-clicks (zoom, reset, copy as CSV). The menu is a screen-reader action
 * too, so it is never behind a gesture alone, and it opens centred: a short
 * task on a phone is a dialog, not a sheet.
 */
export function ChartFrame({
  label,
  summary,
  rows,
  valueLabel,
  format,
  window: windowState,
  menuItems = [],
  menuOpen,
  onMenuOpenChange,
  portalHost,
  children,
  className,
}: ChartFrameProps): React.JSX.Element {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = menuOpen ?? ownOpen;
  const setOpen = (next: boolean): void => {
    if (menuOpen === undefined) setOwnOpen(next);
    onMenuOpenChange?.(next);
  };
  const { copy, status } = useClipboard();

  const commands: (ChartMenuItem & { icon?: typeof Copy; disabled?: boolean })[] = [
    ...(windowState
      ? [
          {
            label: 'Zoom in',
            icon: ZoomIn,
            disabled: !windowState.canZoomIn,
            onPress: () => {
              windowState.zoom(0.5);
            },
          },
          {
            label: 'Zoom out',
            icon: ZoomOut,
            disabled: !windowState.canZoomOut,
            onPress: () => {
              windowState.zoom(2);
            },
          },
          {
            label: 'Reset zoom',
            icon: Maximize2,
            disabled: !windowState.windowed,
            onPress: windowState.reset,
          },
        ]
      : []),
    {
      label: status === 'copied' ? 'Copied' : 'Copy as CSV',
      icon: Copy,
      onPress: () => {
        void copy(toCsv(rows));
      },
    },
    ...menuItems,
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Pressable
        // The frame is not a control: its marks are, and the summary is read.
        accessible={false}
        focusable={false}
        delayLongPress={450}
        onLongPress={() => {
          setOpen(true);
        }}
        className={cn('min-w-0', className)}
        {...(WEB ? { role: 'figure', 'aria-label': label } : {})}
      >
        {WEB ? (
          summary ? (
            <View style={hiddenStyle}>
              <CssText>{summary}</CssText>
            </View>
          ) : null
        ) : (
          <View style={hiddenStyle}>
            <CssText
              accessible
              accessibilityLabel={summary ? `${label}. ${summary}` : label}
              accessibilityHint="Chart options are in the actions"
              accessibilityActions={[{ name: 'menu', label: 'Chart options' }]}
              onAccessibilityAction={() => {
                setOpen(true);
              }}
            >
              {summary ?? ''}
            </CssText>
          </View>
        )}
        {children}
        <ChartDataTable
          caption={label}
          data={rows}
          {...(valueLabel === undefined ? {} : { valueLabel })}
          {...(format === undefined ? {} : { format })}
        />
      </Pressable>
      <DialogContent
        {...(portalHost === undefined ? {} : { portalHost })}
        className="gap-2 px-0 pb-2"
      >
        <DialogHeader className="px-5">
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <List className="rounded-none bg-transparent shadow-none">
          {commands.map((command) => (
            <ListItem
              key={command.label}
              disabled={command.disabled ?? false}
              {...(command.icon
                ? {
                    leading: (
                      <Icon icon={command.icon} tone={command.disabled ? 'disabled' : 'muted'} />
                    ),
                  }
                : {})}
              onPress={() => {
                command.onPress();
                if (command.label !== 'Copy as CSV') setOpen(false);
              }}
            >
              {command.label}
            </ListItem>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}
