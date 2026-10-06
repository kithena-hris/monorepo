import { springs } from '@reach/ui/motion';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { animateTo } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { physics } from '../../lib/motion.ts';
import { useReducedMotion } from '../../provider.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { segmentItem, segmentText, segmentTrack, segmentTrackFull } from '../toggle/toggle.tsx';

/*
 * Two to five views of the same content, one always on, as the web's: a radio
 * group whose thumb slides between segments on the snap spring, and jumps
 * under reduced motion. Pressing the current segment again does nothing.
 *
 * Segments are 36 tall on a phone (32 compact), padded 42% of the height, the
 * label 15 and semibold; `lg` is desk-only in the design and matches `md` here.
 */
const HEIGHT = { sm: 32, md: 36, lg: 36 } as const;
type Size = keyof typeof HEIGHT;

/** The control's own breathing room around the segments. */
const INSET = 3;
const SNAP = physics(springs.snap);

type Slot = { x: number; width: number };

type State = {
  value: string;
  size: Size;
  fullWidth: boolean;
  select: (value: string) => void;
  place: (value: string, slot: Slot) => void;
};

const Context = createContext<State | null>(null);

export type SegmentedControlProps = {
  children: ReactNode;
  value?: string;
  defaultValue?: string;
  /** Fires with the newly selected segment, never with the current one. */
  onValueChange?: (value: string) => void;
  size?: Size;
  /** Segments share the row equally. */
  fullWidth?: boolean;
  /** Names the group for a screen reader: "Period". */
  accessibilityLabel?: string;
  className?: string | undefined;
};

export function SegmentedControl({
  children,
  value: controlled,
  defaultValue,
  onValueChange,
  size = 'md',
  fullWidth = false,
  accessibilityLabel,
  className,
}: SegmentedControlProps): React.JSX.Element {
  const reduced = useReducedMotion();
  const [own, setOwn] = useState(defaultValue ?? '');
  const value = controlled ?? own;
  const [slots, setSlots] = useState<Partial<Record<string, Slot>>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  // The first placement lands where it is: sliding in from the edge on mount means nothing.
  const placed = useRef(false);

  const slot = slots[value];
  useEffect(() => {
    if (!slot) return;
    if (!placed.current || reduced) {
      x.value = slot.x;
      width.value = slot.width;
      placed.current = true;
      return;
    }
    x.value = animateTo(slot.x, SNAP);
    width.value = animateTo(slot.width, SNAP);
  }, [slot, reduced, x, width]);

  const thumb = useAnimatedStyle(() => ({
    width: width.value,
    transform: [{ translateX: x.value }],
  }));

  const state: State = {
    value,
    size,
    fullWidth,
    select: (next) => {
      if (next === value) return;
      setOwn(next);
      onValueChange?.(next);
    },
    place: (key, next) => {
      setSlots((prev) => {
        const old = prev[key];
        return old && old.x === next.x && old.width === next.width
          ? prev
          : { ...prev, [key]: next };
      });
    },
  };

  return (
    <Context.Provider value={state}>
      <View
        role="radiogroup"
        {...(accessibilityLabel ? { 'aria-label': accessibilityLabel } : {})}
        // One segmented look with ToggleGroup and a horizontal RadioGroup.
        className={cn(segmentTrack, 'items-center', fullWidth && segmentTrackFull, className)}
      >
        {slot ? (
          // The slide on a bare Animated.View, the surface on a view inside it (RMB-001).
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', top: INSET, bottom: INSET, left: 0 }, thumb]}
          >
            <View className="flex-1 rounded-full bg-surface-raised shadow-sm" />
          </Animated.View>
        ) : null}
        {children}
      </View>
    </Context.Provider>
  );
}

export type SegmentedControlItemProps = {
  value: string;
  /** The label. Leave it out for an icon-only segment, which then needs `accessibilityLabel`. */
  children?: string;
  icon?: LucideIcon;
  accessibilityLabel?: string;
  disabled?: boolean;
  className?: string | undefined;
};

export function SegmentedControlItem({
  value,
  children,
  icon,
  accessibilityLabel,
  disabled = false,
  className,
}: SegmentedControlItemProps): React.JSX.Element {
  const state = useContext(Context);
  if (!state) throw new Error('SegmentedControlItem must be inside a SegmentedControl.');
  const on = state.value === value;
  const h = HEIGHT[state.size];
  const iconOnly = !children;
  return (
    <Pressable
      role="radio"
      aria-checked={on}
      accessibilityState={{ checked: on, disabled }}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      disabled={disabled}
      // A 32 or 36 segment is 44 to a finger.
      hitSlop={{ top: (44 - h) / 2, bottom: (44 - h) / 2 }}
      onPress={() => {
        state.select(value);
      }}
      onLayout={(e: LayoutChangeEvent) => {
        const { x, width } = e.nativeEvent.layout;
        state.place(value, { x, width });
      }}
      // The fill is the sliding thumb's, so the segment itself is drawn off.
      className={cn(
        segmentItem({
          on: false,
          size: state.size === 'sm' ? 'sm' : 'md',
          iconOnly,
          fullWidth: state.fullWidth,
        }),
        disabled && 'opacity-45',
        className,
      )}
    >
      {icon ? <Icon icon={icon} size={16} tone={on ? 'default' : 'muted'} /> : null}
      {children ? (
        <CssText numberOfLines={1} className={cn(segmentText(on), 'leading-none')}>
          {children}
        </CssText>
      ) : null}
    </Pressable>
  );
}
