import { Fragment, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

/**
 * Interviews, rotas and meetings by the hour, as the web's `Scheduler`, drawn
 * for a phone: a strip of dates and one day's column under it (a week's
 * columns only fit a phone held sideways), or an agenda list. Overlapping
 * events share the width side by side, and a real clash has a red outline.
 * Drag down an empty stretch to pick a slot (times snap to 15 minutes), or
 * tap an hour to pick that hour.
 */

/** Minutes from midnight. */
export type Minutes = number;

export type SchedulerTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';

export type SchedulerColumn = {
  id: string;
  /** "Wed 14". */
  label: string;
  /** The strip's two lines: "W" and "14". */
  weekday?: string;
  day?: string;
};

export type SchedulerEvent = {
  id: string;
  column: string;
  start: Minutes;
  end: Minutes;
  title: string;
  detail?: string;
  tone?: SchedulerTone;
  /** A real conflict, not just an overlap. */
  clash?: boolean;
  allDay?: boolean;
};

export type SchedulerSlot = { column: string; start: Minutes; end: Minutes };

export type SchedulerProps = {
  columns: readonly SchedulerColumn[];
  events: readonly SchedulerEvent[];
  /** The schedule's accessible name. */
  label: string;
  /** `agenda`: a list grouped by column, in time order. */
  view?: 'day' | 'agenda';
  /** The day shown; the strip chooses it. */
  selected?: string;
  onSelect?: (column: string) => void;
  /** Hides the strip of dates, for a single day. */
  strip?: boolean;
  startHour?: number;
  endHour?: number;
  today?: string;
  /** The current time: a red line across today. */
  now?: Minutes;
  /** Dragging down an empty stretch, or tapping an hour. */
  onPickSlot?: (slot: SchedulerSlot) => void;
  className?: string | undefined;
};

const HOUR = 48;
const SNAP = 15;

const TONE: Record<SchedulerTone, { fill: string; bar: string; ink: string }> = {
  accent: { fill: 'bg-accent-subtle', bar: 'bg-accent', ink: 'text-accent-fg' },
  info: { fill: 'bg-info-subtle', bar: 'bg-info', ink: 'text-info-fg' },
  success: { fill: 'bg-success-subtle', bar: 'bg-success', ink: 'text-success-fg' },
  warning: { fill: 'bg-warning-subtle', bar: 'bg-warning', ink: 'text-warning-fg' },
  danger: { fill: 'bg-danger-subtle', bar: 'bg-danger', ink: 'text-danger-fg' },
  neutral: { fill: 'bg-surface-sunken', bar: 'bg-fg-subtle', ink: 'text-fg' },
};

/** "09:00", "All day". */
export function formatMinutes(minutes: Minutes): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Side-by-side lanes for overlapping events: each event's lane and how many share its time. */
export function layoutLanes(
  events: readonly SchedulerEvent[],
): Map<string, { lane: number; lanes: number }> {
  const sorted = events.toSorted((a, b) => a.start - b.start || b.end - a.end);
  const out = new Map<string, { lane: number; lanes: number }>();
  let group: SchedulerEvent[] = [];
  let groupEnd = -1;
  const flush = (): void => {
    const ends: number[] = [];
    const lanes = new Map<string, number>();
    for (const e of group) {
      const free = ends.findIndex((end) => end <= e.start);
      const lane = free === -1 ? ends.length : free;
      ends[lane] = e.end;
      lanes.set(e.id, lane);
    }
    for (const e of group) out.set(e.id, { lane: lanes.get(e.id) ?? 0, lanes: ends.length });
    group = [];
  };
  for (const e of sorted) {
    if (e.start >= groupEnd && group.length > 0) flush();
    group.push(e);
    groupEnd = Math.max(groupEnd, e.end);
  }
  if (group.length > 0) flush();
  return out;
}

export function Scheduler({
  columns,
  events,
  label,
  view = 'day',
  selected: selectedProp,
  onSelect,
  strip = true,
  startHour = 9,
  endHour = 17,
  today,
  now,
  onPickSlot,
  className,
}: SchedulerProps): React.JSX.Element {
  const [own, setOwn] = useState(selectedProp ?? today ?? columns[0]?.id ?? '');
  const selected = selectedProp ?? own;
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);

  if (view === 'agenda') return <Agenda columns={columns} events={events} label={label} className={className} />;

  const column = columns.find((c) => c.id === selected) ?? columns[0];
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const top = startHour * 60;
  const y = (m: Minutes): number => ((m - top) / 60) * HOUR;
  const snap = (px: number): Minutes =>
    Math.max(top, Math.min(endHour * 60, top + Math.round(((px / HOUR) * 60) / SNAP) * SNAP));
  const dayEvents = events.filter((e) => e.column === column?.id && !e.allDay);
  const lanes = layoutLanes(dayEvents);

  const pan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-8, 8])
    .onBegin((e) => {
      const at = snap(e.y);
      setDraft({ from: at, to: at });
    })
    .onUpdate((e) => {
      setDraft((d) => (d ? { ...d, to: snap(e.y) } : d));
    })
    .onEnd(() => {
      setDraft((d) => {
        if (d && column && d.to !== d.from) {
          onPickSlot?.({
            column: column.id,
            start: Math.min(d.from, d.to),
            end: Math.max(d.from, d.to),
          });
        }
        return null;
      });
    })
    .onFinalize(() => {
      setDraft(null);
    });

  const grid = (
    <View className="relative">
      {hours.map((h) => (
        <View key={h} className="flex-row" style={{ height: HOUR }}>
          <CssText className="w-12 border-t border-border pt-1 pr-2 text-right text-[11px] leading-none font-medium text-fg-subtle">
            {`${String(h)}:00`}
          </CssText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${column?.label ?? ''}, ${formatMinutes(h * 60)}`}
            accessibilityHint={onPickSlot ? 'Picks this hour' : undefined}
            disabled={!onPickSlot}
            onPress={() => {
              if (column) onPickSlot?.({ column: column.id, start: h * 60, end: (h + 1) * 60 });
            }}
            className="flex-1 border-t border-l border-border"
          />
        </View>
      ))}
      {/* Over the hour cells, past the hour labels: events, the slot being picked, the time now. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 48, right: 0 }}>
      {dayEvents.map((e) => {
        const place = lanes.get(e.id) ?? { lane: 0, lanes: 1 };
        const tone = TONE[e.tone ?? 'accent'];
        return (
          <View
            key={e.id}
            className="absolute px-[3px]"
            style={{
              top: y(e.start) + 2,
              height: y(e.end) - y(e.start) - 4,
              left: `${String((place.lane / place.lanes) * 100)}%` as `${number}%`,
              width: `${String(100 / place.lanes)}%` as `${number}%`,
            }}
          >
          <View
            accessible
            accessibilityLabel={`${e.title}${e.detail ? `, ${e.detail}` : ''}, ${formatMinutes(e.start)} to ${formatMinutes(e.end)}${e.clash ? ', clashes' : ''}`}
            className={cn(
              'flex-1 overflow-hidden rounded-[8px] py-1.5 pr-2 pl-[11px]',
              tone.fill,
              e.clash && 'border-2 border-danger',
            )}
          >
            <View className={cn('absolute inset-y-0 left-0 w-[3px]', tone.bar)} />
            <CssText className={cn('text-[12px] leading-[1.25] font-semibold', tone.ink)}>
              {e.title}
            </CssText>
            {e.detail ? (
              <CssText className={cn('text-[12px] leading-[1.25]', tone.ink)}>{e.detail}</CssText>
            ) : null}
          </View>
          </View>
        );
      })}
      {draft && draft.to !== draft.from ? (
        <View
          pointerEvents="none"
          className="absolute rounded-[8px] border-2 border-dashed border-accent bg-accent-subtle"
          style={{
            top: y(Math.min(draft.from, draft.to)),
            height: Math.abs(y(draft.to) - y(draft.from)),
            left: 3,
            right: 3,
          }}
        />
      ) : null}
      {now !== undefined && column?.id === today && now >= top && now <= endHour * 60 ? (
        <View
          aria-hidden
          className="absolute right-0 left-0 h-0.5 bg-danger"
          style={{ top: y(now) }}
        />
      ) : null}
      </View>
    </View>
  );

  return (
    <View className={cn('gap-2.5', className)}>
      {strip ? (
        <View role="radiogroup" aria-label={`${label}: day`} className="flex-row gap-1.5">
          {columns.map((c) => {
            const on = c.id === selected;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityLabel={c.label}
                accessibilityState={{ checked: on }}
                aria-checked={on}
                onPress={() => {
                  setOwn(c.id);
                  onSelect?.(c.id);
                }}
                className={cn(
                  'h-14 flex-1 items-center justify-center gap-1 rounded-[14px]',
                  on ? 'bg-accent' : 'bg-surface-sunken',
                )}
              >
                <CssText
                  className={cn(
                    'text-[12px] leading-none font-medium opacity-80',
                    on ? 'text-fg-on-accent' : 'text-fg',
                  )}
                >
                  {c.weekday ?? c.label.split(' ')[0]?.[0] ?? ''}
                </CssText>
                <CssText
                  className={cn(
                    'text-[17px] leading-none font-bold',
                    on ? 'text-fg-on-accent' : 'text-fg',
                  )}
                >
                  {c.day ?? c.label.split(' ')[1] ?? ''}
                </CssText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View
        role="group"
        aria-label={`${label}, ${column?.label ?? ''}`}
        className="overflow-hidden rounded-[18px] bg-surface shadow-sm"
      >
        <View className="flex-row border-b border-border">
          <View className="w-12" />
          <CssText
            className={cn(
              'flex-1 px-1.5 py-2.5 text-center text-[12px] leading-[1.2] font-semibold',
              column?.id === today ? 'text-accent-fg' : 'text-fg-muted',
            )}
          >
            {column?.label ?? ''}
          </CssText>
        </View>
        {onPickSlot ? <GestureDetector gesture={pan}>{grid}</GestureDetector> : grid}
      </View>
    </View>
  );
}

function Agenda({
  columns,
  events,
  label,
  className,
}: {
  columns: readonly SchedulerColumn[];
  events: readonly SchedulerEvent[];
  label: string;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      aria-label={label}
      className={cn('overflow-hidden rounded-m-card bg-surface shadow-sm', className)}
    >
      {columns.map((c) => {
        const day = events
          .filter((e) => e.column === c.id)
          .toSorted((a, b) => Number(b.allDay ?? false) - Number(a.allDay ?? false) || a.start - b.start);
        if (day.length === 0) return null;
        return (
          <Fragment key={c.id}>
            <CssText
              accessibilityRole="header"
              className="px-4 pt-3 pb-1.5 text-[12px] leading-none font-semibold text-fg-subtle"
            >
              {c.label}
            </CssText>
            <View role="list" aria-label={c.label}>
              {day.map((e) => {
                const tone = TONE[e.tone ?? 'accent'];
                const time = e.allDay ? 'All day' : formatMinutes(e.start);
                return (
                  <View
                    key={e.id}
                    role="listitem"
                    className="flex-row items-stretch gap-3 px-4 py-2.5"
                  >
                    <CssText className="w-14 self-center text-[13px] leading-none font-semibold text-fg-muted tabular-nums">
                      {time}
                    </CssText>
                    <View className={cn('w-[4px] rounded-[4px]', tone.bar)} />
                    <View className="flex-1">
                      <CssText className="text-callout leading-[1.3] font-semibold text-fg">
                        {e.title}
                      </CssText>
                      {e.detail ? (
                        <CssText className="text-[13px] leading-[1.3] text-fg-muted">
                          {e.detail}
                        </CssText>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </Fragment>
        );
      })}
    </View>
  );
}
