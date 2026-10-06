import * as TogglePrimitive from '@rn-primitives/toggle';
import * as ToggleGroupPrimitive from '@rn-primitives/toggle-group';
import { cva } from 'class-variance-authority';
import { createContext, useContext, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { flatStyle } from '../../lib/overlay.tsx';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

const ToggleRoot = styled(flatStyle(TogglePrimitive.Root));
const GroupRoot = styled(flatStyle(ToggleGroupPrimitive.Root));
const GroupItem = styled(flatStyle(ToggleGroupPrimitive.Item));

const HEIGHT = { sm: 32, md: 40 } as const;

/*
 * The mobile design's toggle: 40 under a thumb, 32 compact, a pill, 14pt
 * semibold. `fill` sits in the sunken fill and takes the accent wash when on;
 * `ghost` has no fill at rest; `outline` a hairline, and a stronger fill on.
 */
const toggle = cva('flex-row items-center justify-center gap-1.5', {
  variants: {
    variant: { fill: '', ghost: '', outline: 'border-[1.5px] border-border-strong' },
    size: { sm: 'h-8 px-[13px]', md: 'h-10 px-4' },
    iconOnly: { true: 'px-0', false: '' },
    /** `square`: a rounded square, for a run of formatting buttons. */
    shape: { pill: 'rounded-full', square: 'rounded-[10px]' },
    on: { true: '', false: '' },
  },
  compoundVariants: [
    { iconOnly: true, size: 'sm', class: 'w-8' },
    { iconOnly: true, size: 'md', class: 'w-10' },
    { on: false, variant: 'fill', class: 'bg-surface-sunken' },
    { on: true, variant: ['fill', 'ghost'], class: 'bg-accent-subtle' },
    { on: true, variant: 'outline', class: 'bg-surface-active' },
  ],
});

type Tone = Extract<NonNullable<IconProps['tone']>, 'muted' | 'default' | 'accent'>;

function tone(on: boolean, variant: 'fill' | 'ghost' | 'outline'): Tone {
  if (!on) return 'muted';
  return variant === 'outline' ? 'default' : 'accent';
}

const textTone: Record<Tone, string> = {
  muted: 'text-fg-muted',
  default: 'text-fg',
  accent: 'text-accent-fg',
};

export type ToggleProps = {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** The label: what the button does, which stays true pressed or not. */
  children?: string;
  icon?: LucideIcon;
  /** Required without `children`. */
  accessibilityLabel?: string;
  variant?: 'fill' | 'ghost' | 'outline';
  /** `square` for a run of formatting buttons; a pill otherwise. */
  shape?: 'pill' | 'square';
  /** `md` 40pt, `sm` 32; both reach 44 under a finger. */
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string | undefined;
};

/**
 * A button that stays pressed, for a view option or a formatting state, never a
 * setting. It is read as a pressed button, not a checkbox: the label says what
 * it does and the pressed state says whether it is on.
 */
export function Toggle({
  pressed,
  onPressedChange,
  children,
  icon,
  accessibilityLabel,
  variant = 'fill',
  shape = 'pill',
  size = 'md',
  disabled = false,
  className,
}: ToggleProps): React.JSX.Element {
  const press = usePress();
  const fg = tone(pressed, variant);
  const iconOnly = !children;
  const slop = (44 - HEIGHT[size]) / 2;
  return (
    <ToggleRoot
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      hitSlop={iconOnly ? slop : { top: slop, bottom: slop }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityLabel={accessibilityLabel ?? children}
      accessibilityState={{ selected: pressed, disabled }}
      aria-pressed={pressed}
      className={cn(
        'self-start',
        shape === 'square' ? 'rounded-[10px]' : 'rounded-full',
        disabled && 'opacity-45',
        className,
      )}
    >
      <Animated.View style={press.style}>
        <View className={toggle({ variant, size, iconOnly, shape, on: pressed })}>
          {icon ? <Icon icon={icon} size={17} tone={fg} className="shrink-0" /> : null}
          {children ? (
            <CssText numberOfLines={1} className={cn('text-[14px] font-semibold', textTone[fg])}>
              {children}
            </CssText>
          ) : null}
        </View>
      </Animated.View>
    </ToggleRoot>
  );
}

/*
 * The segmented look: a sunken pill holding segments, the chosen ones lifted
 * onto the raised surface. ToggleGroup draws it, and so does a horizontal
 * RadioGroup on a phone; a segmented control should draw it too.
 */
export const segmentTrack = 'flex-row gap-0.5 self-start rounded-full bg-surface-sunken p-[3px]';
export const segmentTrackFull = 'self-stretch';
export function segmentItem({
  on,
  size = 'md',
  iconOnly = false,
  fullWidth = false,
}: {
  on: boolean;
  size?: 'sm' | 'md';
  iconOnly?: boolean;
  fullWidth?: boolean;
}): string {
  return cn(
    'flex-row items-center justify-center gap-1.5 rounded-full',
    size === 'sm' ? 'h-8' : 'h-9',
    iconOnly ? (size === 'sm' ? 'w-8' : 'w-9') : size === 'sm' ? 'px-[13px]' : 'px-[15px]',
    fullWidth && 'flex-1',
    on && 'bg-surface-raised shadow-sm',
  );
}
export const segmentText = (on: boolean): string =>
  cn('text-[15px] font-semibold', on ? 'text-fg' : 'text-fg-muted');

type GroupContextValue = {
  type: 'single' | 'multiple';
  size: 'sm' | 'md';
  fullWidth: boolean;
  values: readonly string[];
};
const GroupContext = createContext<GroupContextValue>({
  type: 'single',
  size: 'md',
  fullWidth: false,
  values: [],
});

type GroupBase = {
  children: ReactNode;
  /** `md` 36pt segments, `sm` 32. */
  size?: 'sm' | 'md';
  /** Fill the row, the segments sharing it equally. */
  fullWidth?: boolean;
  disabled?: boolean;
  /** What the group is: "View", "Formatting". */
  accessibilityLabel: string;
  className?: string | undefined;
};

export type ToggleGroupProps = GroupBase &
  (
    | {
        type: 'single';
        value: string | undefined;
        onValueChange: (value: string | undefined) => void;
      }
    | { type: 'multiple'; value: string[]; onValueChange: (value: string[]) => void }
  );

/**
 * A segmented control. `single` is one value with a few options ("list or
 * grid"), read as a set of radio buttons; `multiple` is formatting or a
 * filter, where several can be on, each its own toggle.
 *
 * Above four or five segments it stops fitting a phone: that is a `Select`.
 */
export function ToggleGroup(props: ToggleGroupProps): React.JSX.Element {
  const { children, size = 'md', fullWidth = false, disabled = false, className } = props;
  const values: readonly string[] =
    props.type === 'single' ? (props.value === undefined ? [] : [props.value]) : props.value;
  const root =
    props.type === 'single'
      ? { type: 'single' as const, value: props.value, onValueChange: props.onValueChange }
      : { type: 'multiple' as const, value: props.value, onValueChange: props.onValueChange };
  return (
    <GroupContext value={{ type: props.type, size, fullWidth, values }}>
      <GroupRoot
        {...root}
        disabled={disabled}
        accessibilityLabel={props.accessibilityLabel}
        className={cn(
          segmentTrack,
          fullWidth && segmentTrackFull,
          disabled && 'opacity-45',
          className,
        )}
      >
        {children}
      </GroupRoot>
    </GroupContext>
  );
}

export type ToggleGroupItemProps = {
  value: string;
  children?: string;
  icon?: LucideIcon;
  /** Required without `children`. */
  accessibilityLabel?: string;
  disabled?: boolean;
  className?: string | undefined;
};

export function ToggleGroupItem({
  value,
  children,
  icon,
  accessibilityLabel,
  disabled = false,
  className,
}: ToggleGroupItemProps): React.JSX.Element {
  const { type, size, fullWidth, values } = useContext(GroupContext);
  const on = values.includes(value);
  const iconOnly = !children;
  // 36 inside the 3pt track is 42; 1pt more each side reaches the 44 floor.
  const slop = (44 - (size === 'sm' ? 32 : 36)) / 2;
  return (
    <GroupItem
      value={value}
      disabled={disabled}
      hitSlop={iconOnly ? slop : { top: slop, bottom: slop }}
      accessibilityLabel={accessibilityLabel ?? children}
      // One of several is a radio; several at once, each a pressed button.
      // The primitive says "button" for both, so say it here.
      {...(type === 'single'
        ? { role: 'radio' as const, accessibilityState: { checked: on, disabled } }
        : { 'aria-pressed': on, accessibilityState: { selected: on, disabled } })}
      className={cn(segmentItem({ on, size, iconOnly, fullWidth }), className)}
    >
      {icon ? (
        <Icon icon={icon} size={size === 'sm' ? 14 : 16} tone={on ? 'default' : 'muted'} />
      ) : null}
      {children ? (
        <CssText numberOfLines={1} className={segmentText(on)}>
          {children}
        </CssText>
      ) : null}
    </GroupItem>
  );
}
