import { cva } from 'class-variance-authority';
import { Check, X } from 'lucide-react-native';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Platform, ScrollView as RNScrollView } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { Icon, type IconProps, type LucideIcon } from '../icon/icon.tsx';

/**
 * A compact, tappable value, as the web's: a **filter chip** narrows a list
 * and several can be on, a **choice chip** picks one, an **input chip** holds
 * a value and removes it, a dashed **suggestion chip** offers a next step.
 * Not a Badge: a badge cannot be pressed; a chip always can.
 *
 * 36 tall on a phone, the label 15, the icon 14, and a 44pt target all round.
 */
const chip = cva('h-9 flex-row items-center gap-1.5 rounded-full pl-3', {
  variants: {
    variant: {
      filled: 'bg-surface-sunken',
      dashed: 'border-[1.5px] border-border-strong bg-transparent',
      /** A saved view among views: the chosen one inverted. */
      view: 'bg-surface-sunken px-3.5',
    },
    on: { true: '', false: '' },
    invalid: { true: 'border-[1.5px] border-danger bg-danger-subtle', false: '' },
    removable: { true: 'pr-1.5', false: 'pr-3' },
    pressed: { true: '', false: '' },
    disabled: { true: 'opacity-45', false: '' },
  },
  compoundVariants: [
    { variant: 'filled', on: true, class: 'bg-accent-subtle' },
    { variant: 'view', on: true, class: 'bg-invert' },
    { variant: ['filled', 'view'], on: false, pressed: true, class: 'bg-surface-hover' },
    { variant: 'filled', on: true, pressed: true, class: 'bg-accent-subtle-hover' },
    { variant: 'dashed', pressed: true, class: 'bg-surface-hover' },
  ],
  defaultVariants: { variant: 'filled', on: false, invalid: false, removable: false },
});

type Variant = 'filled' | 'dashed' | 'view';
type Ink = { text: string; wash: string; icon: NonNullable<IconProps['tone']> };

function inkOf(variant: Variant, on: boolean, invalid: boolean): Ink {
  if (invalid) return { text: 'text-danger-fg', wash: 'bg-danger-fg', icon: 'danger' };
  if (variant === 'dashed') return { text: 'text-fg-muted', wash: 'bg-fg-muted', icon: 'muted' };
  if (on && variant === 'view')
    return { text: 'text-fg-on-invert', wash: 'bg-fg-on-invert', icon: 'on-invert' };
  if (on) return { text: 'text-accent-fg', wash: 'bg-accent-fg', icon: 'accent' };
  return { text: 'text-fg', wash: 'bg-fg', icon: 'default' };
}

const WEB = Platform.OS === 'web';

/** A toggle's state: `aria-pressed` on the web, a checked toggle button to VoiceOver and TalkBack. */
function toggleProps(on: boolean) {
  return WEB
    ? { role: 'button' as const, 'aria-pressed': on }
    : { accessibilityRole: 'togglebutton' as const, accessibilityState: { checked: on } };
}

type ChipContentProps = {
  /** A lucide icon before the label, drawn at 14 in the chip's ink. */
  icon?: LucideIcon | undefined;
  /** Anything else before the label: an `Avatar` at 24. */
  startIcon?: ReactNode;
  /** The filter this chip holds, muted before its value: "Team Engineering". */
  field?: string | undefined;
};

function Content({
  icon,
  startIcon,
  field,
  tick,
  ink,
  children,
}: ChipContentProps & { tick: boolean; ink: Ink; children: ReactNode }): React.JSX.Element {
  return (
    <>
      {tick && !icon && !startIcon ? <Icon icon={Check} size={14} tone={ink.icon} /> : null}
      {startIcon}
      {icon ? <Icon icon={icon} size={14} tone={ink.icon} /> : null}
      <CssText numberOfLines={1} className={cn('text-subhead font-medium leading-none', ink.text)}>
        {field ? <CssText className="text-fg-muted">{field} </CssText> : null}
        {children}
      </CssText>
    </>
  );
}

export type ChipProps = ChipContentProps & {
  children: ReactNode;
  variant?: Variant;
  /** Not valid: a value someone typed that cannot be used. */
  invalid?: boolean;
  /**
   * The filter-chip state. Present, the chip is a toggle and a tick shows when
   * on, so the state never rests on colour alone. With `onRemove`, only the
   * look of an applied value.
   */
  selected?: boolean;
  onPress?: () => void;
  /**
   * Makes this an input chip: the value and a trailing button that removes it.
   * The body stops being a target, so a pill never removes things by accident.
   */
  onRemove?: () => void;
  /** Read for the remove button. Defaults to "Remove" and the chip's text. */
  removeLabel?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  className?: string | undefined;
};

/** 36 drawn, 44 to a finger. */
const SLOP = 4;

export function Chip({
  children,
  variant = 'filled',
  invalid = false,
  selected,
  onPress,
  onRemove,
  removeLabel,
  disabled = false,
  icon,
  startIcon,
  field,
  accessibilityLabel,
  className,
}: ChipProps): React.JSX.Element {
  const press = usePress();
  const on = selected === true;
  const ink = inkOf(variant, on, invalid);
  const text = [field, typeof children === 'string' ? children : null].filter(Boolean).join(' ');

  if (onRemove) {
    return (
      <View className={cn(chip({ variant, on, invalid, removable: true, disabled }), className)}>
        <Content icon={icon} startIcon={startIcon} field={field} tick={false} ink={ink}>
          {children}
        </Content>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? `Remove ${text}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={10}
          onPress={onRemove}
          className="size-6 items-center justify-center"
        >
          <View className={cn('absolute inset-0 rounded-full opacity-[0.12]', ink.wash)} />
          <Icon icon={X} size={12} tone={ink.icon} />
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      {...(selected === undefined ? { accessibilityRole: 'button' as const } : toggleProps(on))}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      accessibilityState={{ disabled, ...(selected === undefined ? {} : { checked: on }) }}
      disabled={disabled}
      hitSlop={SLOP}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      className={cn('rounded-full', className)}
    >
      <Animated.View style={press.style}>
        <View className={cn(chip({ variant, on, invalid, disabled, pressed: press.pressed }))}>
          <Content icon={icon} startIcon={startIcon} field={field} tick={on} ink={ink}>
            {children}
          </Content>
        </View>
      </Animated.View>
    </Pressable>
  );
}

type GroupState = {
  type: 'single' | 'multiple';
  isOn: (value: string) => boolean;
  toggle: (value: string) => void;
  disabled: boolean;
};

const Group = createContext<GroupState | null>(null);

type SingleProps = {
  type: 'single';
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
};
type MultipleProps = {
  type: 'multiple';
  value?: string[];
  defaultValue?: string[];
  onValueChange?: (value: string[]) => void;
};

export type ChipGroupProps = (SingleProps | MultipleProps) & {
  children: ReactNode;
  /** Names the group for a screen reader: "Teams". */
  accessibilityLabel: string;
  /** One row that scrolls sideways from edge to edge, as a long filter row does on a phone. */
  scroll?: boolean;
  disabled?: boolean;
  className?: string | undefined;
};

/**
 * Chips sharing one value. `multiple` is a row of filter chips, each a toggle
 * with a tick when on. `single` is choice chips: a radio group, exactly one
 * on, no tick, because the fill already says which.
 */
export function ChipGroup(props: ChipGroupProps): React.JSX.Element {
  const { children, accessibilityLabel, scroll = false, disabled = false, className } = props;
  const [own, setOwn] = useState<string[]>(() => {
    const initial = props.value ?? props.defaultValue;
    return initial === undefined ? [] : ([] as string[]).concat(initial);
  });
  const current = props.value === undefined ? own : ([] as string[]).concat(props.value);

  const state: GroupState = {
    type: props.type,
    disabled,
    isOn: (value) => current.includes(value),
    toggle: (value) => {
      if (props.type === 'single') {
        // A choice is never cleared by pressing it again: one is always on.
        if (current[0] === value) return;
        setOwn([value]);
        props.onValueChange?.(value);
      } else {
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        setOwn(next);
        props.onValueChange?.(next);
      }
    },
  };

  const row = (
    <View
      role={props.type === 'single' ? 'radiogroup' : 'group'}
      aria-label={accessibilityLabel}
      className={cn('flex-row items-center gap-2', !scroll && 'flex-wrap', className)}
    >
      {children}
    </View>
  );

  return (
    <Group.Provider value={state}>
      {scroll ? (
        <RNScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Edge to edge: the row runs under the page margin and pads itself back.
          style={{ marginHorizontal: -16 }}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          {row}
        </RNScrollView>
      ) : (
        row
      )}
    </Group.Provider>
  );
}

export type ChipGroupItemProps = ChipContentProps & {
  value: string;
  children: ReactNode;
  /** `view` for a row of saved views, the chosen one inverted. */
  variant?: 'filled' | 'view';
  disabled?: boolean;
  className?: string | undefined;
};

export function ChipGroupItem({
  value,
  children,
  variant = 'filled',
  disabled: own = false,
  icon,
  startIcon,
  field,
  className,
}: ChipGroupItemProps): React.JSX.Element {
  const group = useContext(Group);
  if (!group) throw new Error('ChipGroupItem must be inside a ChipGroup.');
  const press = usePress();
  const on = group.isOn(value);
  const disabled = own || group.disabled;
  const single = group.type === 'single';
  const ink = inkOf(variant, on, false);
  return (
    <Pressable
      {...(single
        ? {
            role: 'radio' as const,
            'aria-checked': on,
            accessibilityState: { checked: on, disabled },
          }
        : { ...toggleProps(on), accessibilityState: { checked: on, disabled } })}
      disabled={disabled}
      hitSlop={SLOP}
      onPress={() => {
        group.toggle(value);
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      className={cn('rounded-full', className)}
    >
      <Animated.View style={press.style}>
        <View className={cn(chip({ variant, on, disabled, pressed: press.pressed }))}>
          <Content icon={icon} startIcon={startIcon} field={field} tick={on && !single} ink={ink}>
            {children}
          </Content>
        </View>
      </Animated.View>
    </Pressable>
  );
}
