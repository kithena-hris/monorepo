import * as RadioGroupPrimitive from '@rn-primitives/radio-group';
import { createContext, useContext, type ReactNode } from 'react';
import { styled } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { flatStyle } from '../../lib/overlay.tsx';
import { useField, fieldName } from '../field/field.tsx';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { segmentItem, segmentText, segmentTrack, segmentTrackFull } from '../toggle/toggle.tsx';

const Root = styled(flatStyle(RadioGroupPrimitive.Root));
const Item = styled(flatStyle(RadioGroupPrimitive.Item));

/** The 24pt dot's row reaches 44 with this much above and below. */
const SLOP = { top: 10, bottom: 10 };

type GroupContextValue = {
  value: string | undefined;
  disabled: boolean;
  invalid: boolean;
  horizontal: boolean;
};
const GroupContext = createContext<GroupContextValue>({
  value: undefined,
  disabled: false,
  invalid: false,
  horizontal: false,
});

export type RadioGroupProps = {
  value: string | undefined;
  onValueChange: (value: string) => void;
  children: ReactNode;
  /**
   * `horizontal` is a row of options; on a phone a row of radios does not fit
   * a thumb, so it becomes a segmented control, still read as radio buttons.
   * Keep it to four short options.
   */
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  invalid?: boolean;
  /** What is being chosen. Inside a `Field`, its label. */
  accessibilityLabel?: string;
  className?: string | undefined;
};

/**
 * One choice from two to five, every option in view. Options with
 * consequences say them in a `description`: a dropdown would hide exactly
 * that. Two options that are opposites are a `Switch`.
 */
export function RadioGroup({
  value,
  onValueChange,
  children,
  orientation = 'vertical',
  disabled: disabledProp,
  invalid: invalidProp,
  accessibilityLabel,
  className,
}: RadioGroupProps): React.JSX.Element {
  const field = useField();
  const disabled = disabledProp ?? field?.disabled ?? false;
  const invalid = invalidProp ?? field?.invalid ?? false;
  const horizontal = orientation === 'horizontal';
  const label = accessibilityLabel ?? fieldName(field);
  return (
    <GroupContext value={{ value, disabled, invalid, horizontal }}>
      <Root
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        {...(label ? { accessibilityLabel: label } : {})}
        aria-orientation={orientation}
        className={cn(
          horizontal ? cn(segmentTrack, segmentTrackFull) : 'gap-3',
          horizontal && disabled && 'opacity-50',
          className,
        )}
      >
        {children}
      </Root>
    </GroupContext>
  );
}

/** The dot: a 24pt ring, filled with the accent and a white centre when chosen. */
export function RadioDot({
  checked,
  disabled = false,
  invalid = false,
}: {
  checked: boolean;
  disabled?: boolean;
  invalid?: boolean;
}): React.JSX.Element {
  if (checked)
    return (
      <View
        className={cn(
          'size-6 items-center justify-center rounded-full',
          disabled ? 'bg-surface-active' : 'bg-accent-solid',
        )}
      >
        <View className="size-2.5 rounded-full bg-white" />
      </View>
    );
  return (
    <View
      className={cn(
        'size-6 rounded-full border-[1.5px]',
        invalid ? 'border-danger' : 'border-border-strong',
      )}
    />
  );
}

export type RadioGroupItemProps = {
  value: string;
  /** The label. A string, or a `Text` to weigh it; either is read as the name. */
  children: ReactNode;
  /** A second line, for what choosing this does, or why it cannot be chosen. */
  description?: string;
  disabled?: boolean;
  className?: string | undefined;
};

/** One option: the dot, its label and description, the whole row the target. */
export function RadioGroupItem({
  value,
  children,
  description,
  disabled: disabledProp = false,
  className,
}: RadioGroupItemProps): React.JSX.Element {
  const group = useContext(GroupContext);
  const press = usePress();
  const checked = group.value === value;
  const disabled = group.disabled || disabledProp;

  if (group.horizontal)
    return (
      <Item
        value={value}
        disabled={disabled}
        hitSlop={{ top: 4, bottom: 4 }}
        accessibilityState={{ checked, disabled }}
        className={cn(segmentItem({ on: checked, fullWidth: true }), className)}
      >
        <CssText numberOfLines={1} className={segmentText(checked)}>
          {children}
        </CssText>
      </Item>
    );

  return (
    <Item
      value={value}
      disabled={disabled}
      hitSlop={SLOP}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityState={{ checked, disabled }}
      className={cn('flex-row items-start gap-2.5', className)}
    >
      {/* A disabled option dims its dot and label, never its description: that
          line is usually why it cannot be chosen, and has to stay readable. */}
      <Animated.View style={press.style} className={cn(disabled && 'opacity-50')}>
        <RadioDot checked={checked} disabled={disabled} invalid={group.invalid} />
      </Animated.View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className={cn(disabled && 'opacity-50')}>
          {typeof children === 'string' ? (
            <CssText className="text-body leading-[1.4] text-fg">{children}</CssText>
          ) : (
            children
          )}
        </View>
        {description ? (
          <CssText className="text-subhead leading-[1.5] text-fg-muted">{description}</CssText>
        ) : null}
      </View>
    </Item>
  );
}

export type RadioCardProps = RadioGroupItemProps & {
  /** At the card's end: what the option is, at a glance. The dot stays. */
  icon?: LucideIcon;
};

/**
 * The same choice as a card, for one that deserves the weight: a pay
 * schedule, a delivery speed. The whole card is the target.
 */
export function RadioCard({
  value,
  children,
  description,
  icon,
  disabled: disabledProp = false,
  className,
}: RadioCardProps): React.JSX.Element {
  const group = useContext(GroupContext);
  const press = usePress();
  const checked = group.value === value;
  const disabled = group.disabled || disabledProp;
  return (
    <Item
      value={value}
      disabled={disabled}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      accessibilityState={{ checked, disabled }}
      className={cn('rounded-[18px]', disabled && 'opacity-50', className)}
    >
      <Animated.View style={press.style}>
        <View
          className={cn(
            'flex-row items-center gap-3 rounded-[18px] p-4',
            checked ? 'bg-accent-subtle' : 'bg-surface shadow-sm',
          )}
        >
          <RadioDot checked={checked} disabled={disabled} invalid={group.invalid} />
          <View className="min-w-0 flex-1">
            {typeof children === 'string' ? (
              <CssText className="text-body font-semibold leading-[1.4] text-fg">
                {children}
              </CssText>
            ) : (
              children
            )}
            {description ? (
              <CssText className="text-subhead leading-[1.5] text-fg-muted">{description}</CssText>
            ) : null}
          </View>
          {icon ? <Icon icon={icon} size={20} tone="muted" /> : null}
          {checked ? (
            <View
              style={{ pointerEvents: 'none' }}
              className="absolute inset-0 rounded-[18px] border-2 border-accent"
            />
          ) : null}
        </View>
      </Animated.View>
    </Item>
  );
}
