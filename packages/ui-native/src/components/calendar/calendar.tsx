import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { Button } from '../button/button.tsx';
import { Icon } from '../icon/icon.tsx';
import {
  addMonths,
  formatIsoDate,
  monthGrid,
  parseIsoDate,
  startOfMonth,
  type DateRange,
  type IsoDate,
} from './dates.ts';

export {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  parseDate,
  type DateRange,
  type IsoDate,
} from './dates.ts';

/**
 * A month grid for picking days, the web's Calendar under a thumb: 44pt days
 * with a 40pt circle, the month and its arrows above. Leave, holidays and
 * blocked days are on it, so nobody has to guess.
 *
 * Everything is an ISO `YYYY-MM-DD` string, never a `Date` (see `dates.ts`).
 * Today is injected, never read from the clock.
 */

const WEB = Platform.OS === 'web';

export type CalendarTone = 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** A dot under a day. Its `label` is read after the date: a dot alone says nothing. */
export type CalendarMarker = { tone: CalendarTone; label?: string };

const dot: Record<CalendarTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
};

type CalendarBaseProps = {
  /** The month shown, as any day in it. Uncontrolled if omitted. */
  month?: IsoDate;
  onMonthChange?: (month: IsoDate) => void;
  /** Inclusive bounds. Days outside are drawn struck and cannot be picked. */
  min?: IsoDate;
  max?: IsoDate;
  /** Per-day veto: weekends, public holidays, a blackout. */
  isDateDisabled?: (date: IsoDate) => boolean;
  /** Why a disabled day is disabled, read after its date. */
  disabledLabel?: (date: IsoDate) => string | undefined;
  /** Dots under days: leave already booked, a holiday, something pending. */
  markers?: Readonly<Record<IsoDate, CalendarMarker>>;
  /** 0 is Sunday. Monday by default: the ISO week, and every European payroll's. */
  weekStartsOn?: 0 | 1;
  locale?: string;
  /** Today, injected: a component that reads the clock cannot be screenshot-tested. */
  today?: IsoDate;
  /** The grid's name, such as "Leave start date". */
  label?: string;
  className?: string | undefined;
};

export type CalendarProps = CalendarBaseProps &
  (
    | {
        mode?: 'single';
        selected?: IsoDate | null;
        onSelect?: (value: IsoDate | null) => void;
      }
    | {
        mode: 'range';
        selected?: DateRange | null;
        onSelect?: (value: DateRange) => void;
      }
  );

export function Calendar(props: CalendarProps): React.JSX.Element {
  const {
    month,
    onMonthChange,
    min,
    max,
    isDateDisabled,
    disabledLabel,
    markers,
    weekStartsOn = 1,
    locale,
    today = formatIsoDate(Date.now()),
    label = 'Calendar',
    className,
  } = props;
  const [own, setOwn] = useState(() =>
    startOfMonth(
      month ?? (props.mode === 'range' ? props.selected?.start : props.selected) ?? today,
    ),
  );
  const shown = month ? startOfMonth(month) : own;
  const setMonth = (next: IsoDate): void => {
    if (!month) setOwn(next);
    onMonthChange?.(next);
  };

  const formats = useMemo(
    () => ({
      title: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      day: new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
      weekday: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }),
    }),
    [locale],
  );
  const heads = useMemo(() => {
    // 2024-01-01 was a Monday.
    const monday = Date.UTC(2024, 0, 1);
    return Array.from({ length: 7 }, (_, i) => {
      const offset = weekStartsOn === 1 ? i : (i + 6) % 7;
      return formats.weekday.format(new Date(monday + offset * 86_400_000)).slice(0, 2);
    });
  }, [formats, weekStartsOn]);
  const weeks = useMemo(() => monthGrid(shown, weekStartsOn), [shown, weekStartsOn]);

  const outside = (date: IsoDate): boolean =>
    (min !== undefined && date < min) || (max !== undefined && date > max);
  const disabled = (date: IsoDate): boolean => outside(date) || (isDateDisabled?.(date) ?? false);

  const range = props.mode === 'range' ? (props.selected ?? { start: null, end: null }) : null;
  const single = props.mode === 'range' ? null : (props.selected ?? null);

  const pick = (date: IsoDate): void => {
    if (props.mode !== 'range') {
      props.onSelect?.(date === single ? null : date);
      return;
    }
    const current = range ?? { start: null, end: null };
    if (!current.start || current.end) {
      props.onSelect?.({ start: date, end: null });
      return;
    }
    // Picking the end before the start is a normal thing to do: swap.
    props.onSelect?.(
      date < current.start
        ? { start: date, end: current.start }
        : { start: current.start, end: date },
    );
  };

  const title = formats.title.format(new Date(parseIsoDate(shown)));
  const before = min !== undefined && addMonths(shown, -1).slice(0, 7) < min.slice(0, 7);
  const after = max !== undefined && addMonths(shown, 1).slice(0, 7) > max.slice(0, 7);

  return (
    <View
      role="group"
      aria-label={label}
      accessibilityLabel={label}
      className={cn('w-full', className)}
    >
      <View className="mb-2 flex-row items-center justify-between">
        <CssText
          accessibilityLiveRegion="polite"
          aria-live="polite"
          className="pl-1.5 text-[17px] leading-none font-semibold text-fg"
        >
          {title}
        </CssText>
        <View className="flex-row gap-0.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={before}
            accessibilityLabel="Previous month"
            startIcon={<Icon icon={ChevronLeft} />}
            onPress={() => {
              setMonth(addMonths(shown, -1));
            }}
          />
          <Button
            variant="ghost"
            size="xs"
            disabled={after}
            accessibilityLabel="Next month"
            startIcon={<Icon icon={ChevronRight} />}
            onPress={() => {
              setMonth(addMonths(shown, 1));
            }}
          />
        </View>
      </View>
      <View className="flex-row" aria-hidden>
        {heads.map((head, i) => (
          <CssText
            key={`${head}-${String(i)}`}
            className="h-7 flex-1 text-center align-middle text-[11px] leading-7 font-semibold text-fg-subtle"
          >
            {head}
          </CssText>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={week.find(Boolean) ?? String(w)} className="flex-row">
          {week.map((date, d) =>
            date ? (
              <Day
                key={date}
                date={date}
                spoken={[
                  formats.day.format(new Date(parseIsoDate(date))),
                  markers?.[date]?.label,
                  disabled(date) ? (disabledLabel?.(date) ?? 'unavailable') : undefined,
                ]
                  .filter(Boolean)
                  .join(', ')}
                selected={
                  date === single ||
                  (range !== null && (date === range.start || date === range.end))
                }
                start={range?.end ? range.start === date : false}
                end={range?.start && range.end !== range.start ? range.end === date : false}
                between={Boolean(
                  range?.start && range.end && date > range.start && date < range.end,
                )}
                today={date === today}
                disabled={disabled(date)}
                marker={markers?.[date]}
                onPress={() => {
                  pick(date);
                }}
              />
            ) : (
              <View key={`blank-${String(d)}`} className="h-11 flex-1" />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function Day({
  date,
  spoken,
  selected,
  start,
  end,
  between,
  today,
  disabled,
  marker,
  onPress,
}: {
  date: IsoDate;
  spoken: string;
  selected: boolean;
  start: boolean;
  end: boolean;
  between: boolean;
  today: boolean;
  disabled: boolean;
  marker: CalendarMarker | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const ring = useFocusRing();
  const banded = between || start || end;
  return (
    <View className="h-11 flex-1 items-center justify-center">
      {banded ? (
        <View
          aria-hidden
          className={cn(
            'absolute top-[3px] bottom-[3px] bg-accent-subtle',
            start ? 'right-0 left-1/2' : end ? 'right-1/2 left-0' : 'right-0 left-0',
          )}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
        // A pressed button on the web; a selected one to VoiceOver and TalkBack.
        {...(WEB
          ? { 'aria-pressed': selected, 'aria-current': today ? ('date' as const) : undefined }
          : { accessibilityState: { selected, disabled } })}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onPress={onPress}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className={cn(
          'size-10 items-center justify-center rounded-full outline-none',
          selected ? 'bg-accent-solid' : today ? 'border-[1.5px] border-accent' : null,
          !selected && !disabled && 'active:bg-surface-sunken',
        )}
      >
        <CssText
          aria-hidden
          className={cn(
            'text-[16px] leading-none tabular-nums',
            selected || today ? 'font-bold' : 'font-medium',
            selected
              ? 'text-fg-on-accent'
              : disabled
                ? 'text-fg-disabled line-through'
                : today
                  ? 'text-accent-fg'
                  : 'text-fg',
          )}
        >
          {Number(date.slice(8, 10))}
        </CssText>
        {marker ? (
          <View
            aria-hidden
            className={cn(
              'absolute bottom-[5px] size-[5px] rounded-full',
              selected ? 'bg-white' : dot[marker.tone],
            )}
          />
        ) : null}
        {ring.focused ? (
          <View
            style={{ pointerEvents: 'none' }}
            className="absolute -inset-[3px] rounded-full border-[3px] border-border-focus"
          />
        ) : null}
      </Pressable>
    </View>
  );
}

/** What the calendar's dots mean, under it: a colour is never the only signal. */
export function CalendarLegend({
  items,
  className,
}: {
  items: readonly { tone: CalendarTone; label: string }[];
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View className={cn('mt-2.5 flex-row flex-wrap gap-3', className)}>
      {items.map((item) => (
        <View key={item.label} className="flex-row items-center gap-1.5">
          <View className={cn('size-1.5 rounded-full', dot[item.tone])} />
          <CssText className="text-[12px] leading-none font-medium text-fg-muted">
            {item.label}
          </CssText>
        </View>
      ))}
    </View>
  );
}
