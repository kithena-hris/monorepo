import { Clock } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { Text as CssText, TextInput, View } from 'react-native-css/components';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { usePlatform } from '../../provider.tsx';
import { Button } from '../button/button.tsx';
import { PickerDialog } from '../date-picker/picker-dialog.tsx';
import { Dialog, DialogTrigger } from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input, useFieldState } from '../input/input.tsx';
import { RadioGroup, RadioGroupItem } from '../radio-group/radio-group.tsx';
import { formatTime, fromMinutes, parseTime, toMinutes, usesTwelveHours } from './times.ts';

export { formatDuration, formatTime, parseTime } from './times.ts';

/**
 * A time of day. The value is `HH:MM`, 24-hour, whatever the locale shows.
 *
 * It can always be typed, in any shape `parseTime` reads. The clock button
 * beside it opens the platform's own way of choosing one: on iOS the wheel,
 * in place under the field, as iOS's inline pickers open; on Android Material
 * 3's time input, two large boxes for the hour and the minute in a centred
 * dialog, the choice a draft until OK.
 */

const WEB = Platform.OS === 'web';

export type TimePickerProps = {
  /** `HH:MM`, 24-hour, or `null`. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** The control's name. A `Field`'s label wins. */
  label: string;
  /** Minutes between the wheel's choices. 15 by default. */
  step?: number;
  /** Whose clock: `en-US` reads in twelve hours. The device's by default. */
  locale?: string;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  invalid?: boolean;
  /** Before the clock button: a time zone, say. */
  endAdornment?: ReactNode;
  /** Opens with the wheel or dialog showing. */
  defaultOpen?: boolean;
  /** Draw Android's dialog in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  className?: string | undefined;
};

export function TimePicker({
  value,
  onChange,
  label,
  step = 15,
  locale,
  placeholder = '--:--',
  size = 'md',
  disabled: disabledProp,
  invalid: invalidProp,
  endAdornment,
  defaultOpen = false,
  portalHost,
  className,
}: TimePickerProps): React.JSX.Element {
  const state = useFieldState({ invalid: invalidProp, disabled: disabledProp });
  const name = state.name ?? label;
  const android = usePlatform() === 'android';
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const unreadable = text !== null && text.trim() !== '' && parseTime(text) === null;
  const twelve = usesTwelveHours(locale);

  const toggle = (
    <Button
      variant="ghost"
      size="xs"
      disabled={state.disabled}
      accessibilityLabel={`Choose ${name.toLowerCase()}`}
      startIcon={<Icon icon={Clock} size={19} tone="muted" />}
      {...(android
        ? {}
        : {
            onPress: () => {
              setOpen(!open);
            },
          })}
    />
  );

  const field = (
    <Input
      type="time"
      size={size}
      value={text ?? (value ? formatTime(value, locale) : '')}
      onChange={(next) => {
        setText(next);
        const parsed = parseTime(next);
        if (parsed) onChange(parsed);
        else if (next.trim() === '') onChange(null);
      }}
      onBlur={() => {
        if (!unreadable) setText(null);
      }}
      placeholder={placeholder}
      accessibilityLabel={name}
      {...(unreadable ? { accessibilityHint: 'Not a time this field can read' } : {})}
      invalid={state.invalid || unreadable}
      disabled={state.disabled}
      className="tabular-nums"
      tight
      endAdornment={
        <View className="flex-row items-center gap-1.5">
          {endAdornment}
          {android ? (
            <DialogTrigger asChild disabled={state.disabled}>
              {toggle}
            </DialogTrigger>
          ) : (
            toggle
          )}
        </View>
      }
    />
  );

  if (android) {
    const shown = draft ?? value ?? '09:00';
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next && !state.disabled);
          setDraft(null);
        }}
      >
        <View className={cn(className)}>{field}</View>
        <PickerDialog
          title={`Enter ${name.toLowerCase()}`}
          headline={formatTime(shown, locale)}
          portalHost={portalHost}
          onCancel={() => {
            setOpen(false);
            setDraft(null);
          }}
          onConfirm={() => {
            if (draft) onChange(draft);
            setText(null);
            setOpen(false);
            setDraft(null);
          }}
        >
          <TimeInput value={shown} onChange={setDraft} twelve={twelve} />
        </PickerDialog>
      </Dialog>
    );
  }

  return (
    <View className={cn('gap-2.5', className)}>
      {field}
      {open && !state.disabled ? (
        <TimeWheel
          value={value ?? '09:00'}
          onChange={(next) => {
            setText(null);
            onChange(next);
          }}
          step={step}
          twelve={twelve}
          label={name}
        />
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------ iOS wheel */

const pad = (n: number): string => String(n).padStart(2, '0');

const ROW = 40;
const VISIBLE = 5;

/**
 * iOS's wheel: a column for the hour, one for the minute, and one for AM and
 * PM on a twelve-hour clock. Each column snaps to a row, and each is one
 * adjustable control to VoiceOver, stepped by swiping up and down, and by the
 * arrow keys from a keyboard.
 */
export function TimeWheel({
  value,
  onChange,
  step = 15,
  twelve = false,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  step?: number;
  twelve?: boolean;
  /** What is being picked, read before each column's name. */
  label: string;
}): React.JSX.Element {
  const minutes = toMinutes(value);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const minuteValues = useMemo(
    () => Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step),
    [step],
  );
  const set = (h: number, m: number): void => {
    onChange(fromMinutes(h * 60 + m));
  };
  const nearestMinute = minuteValues.reduce(
    (best, m) => (Math.abs(m - minute) < Math.abs(best - minute) ? m : best),
    0,
  );
  const pm = hour >= 12;
  const hours = twelve ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i)) : null;

  return (
    <View
      className="h-[200px] flex-row justify-center gap-1 overflow-hidden rounded-[22px] bg-surface shadow-sm"
      role="group"
      aria-label={label}
    >
      <View
        aria-hidden
        className="absolute top-1/2 right-3 left-3 -mt-5 h-10 rounded-[12px] bg-surface-sunken"
      />
      {hours ? (
        <WheelColumn
          label={`${label}, hour`}
          items={hours.map(String)}
          index={hour % 12}
          onIndex={(i) => {
            set((i % 12) + (pm ? 12 : 0), minute);
          }}
        />
      ) : (
        <WheelColumn
          label={`${label}, hour`}
          items={Array.from({ length: 24 }, (_, i) => pad(i))}
          index={hour}
          onIndex={(i) => {
            set(i, minute);
          }}
        />
      )}
      <WheelColumn
        label={`${label}, minutes`}
        items={minuteValues.map(pad)}
        index={minuteValues.indexOf(nearestMinute)}
        onIndex={(i) => {
          set(hour, minuteValues[i] ?? 0);
        }}
      />
      {twelve ? (
        <WheelColumn
          label={`${label}, AM or PM`}
          items={['AM', 'PM']}
          index={pm ? 1 : 0}
          onIndex={(i) => {
            set((hour % 12) + (i === 1 ? 12 : 0), minute);
          }}
        />
      ) : null}
    </View>
  );
}

const KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowUp: -1 };

function WheelColumn({
  label,
  items,
  index,
  onIndex,
}: {
  label: string;
  items: readonly string[];
  index: number;
  onIndex: (index: number) => void;
}): React.JSX.Element {
  const scroller = useAnimatedRef<Animated.ScrollView>();
  // Where the wheel is, on the UI thread: the rows scale and fade from it
  // without a render per frame. The value changes once, when it lands.
  const offset = useSharedValue(index * ROW);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ring = useFocusRing();
  const last = items.length - 1;

  // Follows the value when it changes from elsewhere: typed, or stepped.
  useEffect(() => {
    scroller.current?.scrollTo({
      y: index * ROW,
      animated: false,
    });
    offset.value = index * ROW;
  }, [index, offset, scroller]);
  useEffect(
    () => () => {
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  const land = useCallback(
    (y: number): void => {
      const next = Math.max(0, Math.min(last, Math.round(y / ROW)));
      if (next !== index) onIndex(next);
      else
        scroller.current?.scrollTo({
          y: next * ROW,
          animated: true,
        });
    },
    [last, index, onIndex, scroller],
  );
  // The web has no momentum events: land once the scrolling has stopped.
  const settleWeb = useCallback(
    (y: number): void => {
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => {
        land(y);
      }, 120);
    },
    [land],
  );
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      offset.value = e.contentOffset.y;
      if (WEB) scheduleOnRN(settleWeb, e.contentOffset.y);
    },
    onEndDrag: (e) => {
      // A drag that stops dead has no momentum to end.
      if (!WEB && Math.abs(e.velocity?.y ?? 0) < 0.05) scheduleOnRN(land, e.contentOffset.y);
    },
    onMomentumEnd: (e) => {
      if (!WEB) scheduleOnRN(land, e.contentOffset.y);
    },
  });
  const stepBy = (by: 1 | -1): void => {
    const next = Math.max(0, Math.min(last, index + by));
    if (next !== index) onIndex(next);
  };

  return (
    <View className="w-[72px]">
      <Animated.ScrollView
        ref={scroller}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={items[index]}
        aria-orientation="vertical"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: last, now: index, text: items[index] ?? '' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          stepBy(e.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
        {...(WEB
          ? {
              tabIndex: 0,
              onKeyDown: (event: { key: string; preventDefault: () => void }) => {
                const by = KEYS[event.key];
                if (by === undefined) return;
                event.preventDefault();
                stepBy(by);
              },
            }
          : {})}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: index * ROW }}
        contentContainerStyle={{ paddingVertical: ((VISIBLE - 1) / 2) * ROW }}
        onScroll={onScroll}
        // The focus ring is drawn below; the browser's own outline is not.
        style={{ height: VISIBLE * ROW, outlineWidth: 0 }}
      >
        {items.map((item, i) => (
          <WheelRow
            key={`${item}-${String(i)}`}
            item={item}
            row={i}
            chosen={i === index}
            offset={offset}
          />
        ))}
      </Animated.ScrollView>

      {ring.focused ? (
        <View
          style={{ pointerEvents: 'none' }}
          className="absolute top-1/2 right-0 left-0 -mt-[23px] h-[46px] rounded-[14px] border-[3px] border-border-focus"
        />
      ) : null}
    </View>
  );
}

/** One row of a wheel: full size on the line, smaller and fainter away from it. */
function WheelRow({
  item,
  row,
  chosen,
  offset,
}: {
  item: string;
  row: number;
  chosen: boolean;
  offset: SharedValue<number>;
}): React.JSX.Element {
  const style = useAnimatedStyle(() => {
    const distance = Math.min(2, Math.abs(row - offset.value / ROW));
    return {
      opacity: 1 - distance * 0.28,
      // 22 on the line, 18 a row away, 16 two away.
      transform: [{ scale: interpolate(distance, [0, 1, 2], [1, 18 / 22, 16 / 22]) }],
    };
  });
  return (
    <View aria-hidden className="h-10 items-center justify-center">
      {/* The motion on a bare Animated.View, the classes inside it (RMB-001). */}
      <Animated.View style={style}>
        <CssText
          className={cn(
            'text-[22px] leading-none tabular-nums',
            chosen ? 'font-semibold text-fg' : 'font-normal text-fg-subtle',
          )}
        >
          {item}
        </CssText>
      </Animated.View>
    </View>
  );
}

/* ---------------------------------------------- Android's time input */

/**
 * Material 3's time input: the hour and the minute in two large boxes, typed
 * on the number pad, and AM and PM beside them on a twelve-hour clock.
 */
function TimeInput({
  value,
  onChange,
  twelve,
}: {
  value: string;
  onChange: (value: string) => void;
  twelve: boolean;
}): React.JSX.Element {
  const minutes = toMinutes(value);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const pm = hour >= 12;
  const shownHour = twelve ? (hour % 12 === 0 ? 12 : hour % 12) : hour;
  return (
    <View className="gap-3 pt-1 pb-2">
      <View className="flex-row items-start gap-3">
        <Box
          label="Hour"
          value={twelve ? String(shownHour) : pad(shownHour)}
          max={twelve ? 12 : 23}
          onValue={(h) => {
            const real = twelve ? (h % 12) + (pm ? 12 : 0) : h;
            onChange(fromMinutes(real * 60 + minute));
          }}
        />
        <CssText aria-hidden className="h-[72px] text-[44px] leading-[72px] text-fg">
          :
        </CssText>
        <Box
          label="Minute"
          value={pad(minute)}
          max={59}
          onValue={(m) => {
            onChange(fromMinutes(hour * 60 + m));
          }}
        />
      </View>
      {twelve ? (
        <RadioGroup
          orientation="horizontal"
          accessibilityLabel="AM or PM"
          value={pm ? 'PM' : 'AM'}
          onValueChange={(half) => {
            if ((half === 'PM') !== pm)
              onChange(fromMinutes(minutes + (half === 'PM' ? 720 : -720)));
          }}
          className="self-center"
        >
          <RadioGroupItem value="AM">AM</RadioGroupItem>
          <RadioGroupItem value="PM">PM</RadioGroupItem>
        </RadioGroup>
      ) : null}
    </View>
  );
}

function Box({
  label,
  value,
  max,
  onValue,
}: {
  label: string;
  value: string;
  max: number;
  onValue: (value: number) => void;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  return (
    <View className="flex-1 gap-1.5">
      <TextInput
        value={text ?? value}
        onChangeText={(next) => {
          const digits = next.replace(/\D/g, '').slice(0, 2);
          setText(digits);
          const n = Number(digits);
          if (digits && n <= max) onValue(n);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
          setText(null);
        }}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={2}
        selectTextOnFocus
        accessibilityLabel={label}
        className={cn(
          'h-[72px] rounded-[8px] p-0 text-center text-[44px] tabular-nums outline-none',
          focused
            ? 'border-2 border-accent bg-accent-subtle text-accent-fg'
            : 'bg-surface-sunken text-fg',
        )}
      />
      <CssText aria-hidden className="text-[12px] text-fg-muted">
        {label}
      </CssText>
    </View>
  );
}
