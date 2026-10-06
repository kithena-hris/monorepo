import * as CheckboxPrimitive from '@rn-primitives/checkbox';
import { Check, Minus } from 'lucide-react-native';
import { styled } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Animated from 'react-native-reanimated';

import { usePress } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { flatStyle } from '../../lib/overlay.tsx';
import { usePlatform } from '../../provider.tsx';
import { fieldHint, fieldName, useField } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';

const Root = styled(flatStyle(CheckboxPrimitive.Root));

/** 24pt under a thumb; `hitSlop` makes the target 44 without spacing rows apart. */
const BOX = 24;
const SLOP = (44 - BOX) / 2;

export type CheckedState = boolean | 'indeterminate';

export type CheckboxProps = {
  /** `"indeterminate"` is a real state: it is read as "mixed", as a select-all over a partial selection is. */
  checked: CheckedState;
  /** Pressing a mixed box checks it. */
  onCheckedChange: (checked: boolean) => void;
  /** The label beside the box. The whole row is then the target. */
  children?: string;
  /** A second line under the label, for what choosing this means. */
  description?: string;
  disabled?: boolean;
  /** Required and not yet ticked: a danger ring. Say why in a `FieldError`. */
  invalid?: boolean;
  /** Without `children` or a `Field` around it, the name a screen reader hears. */
  accessibilityLabel?: string;
  className?: string | undefined;
};

/** The box itself: what a table's select-all or a list row draws. */
export function CheckboxBox({
  checked,
  disabled = false,
  invalid = false,
  pressed = false,
  focused = false,
}: {
  checked: CheckedState;
  disabled?: boolean;
  invalid?: boolean;
  pressed?: boolean;
  /** Keyboard focus: a 3pt ring, 2pt out from the box. */
  focused?: boolean;
}): React.JSX.Element {
  const on = checked !== false;
  // Material 3's on Android: an 18pt square with 2pt corners and a 2pt
  // outline, in the same 24pt cell so rows line up either way.
  const android = usePlatform() === 'android';
  return (
    <View className="size-6 items-center justify-center">
      <View
        className={cn(
          android
            ? 'size-[18px] items-center justify-center rounded-[2px]'
            : 'size-6 items-center justify-center rounded-[8px]',
          on
            ? disabled
              ? 'bg-surface-active'
              : pressed
                ? 'bg-accent-active'
                : 'bg-accent-solid'
            : cn(
                android ? 'border-2' : 'border-[1.5px]',
                invalid ? 'border-danger' : android ? 'border-fg-muted' : 'border-border-strong',
              ),
        )}
      >
        {on ? (
          <Icon
            icon={checked === 'indeterminate' ? Minus : Check}
            size={android ? 14 : 18}
            tone="on-accent"
          />
        ) : null}
      </View>
      {focused ? (
        <View
          style={{ pointerEvents: 'none' }}
          className={cn(
            'absolute border-[3px] border-border-focus',
            android ? '-inset-[2px] rounded-[6px]' : '-inset-[5px] rounded-[13px]',
          )}
        />
      ) : null}
    </View>
  );
}

/**
 * On or off, as part of a form that is then saved. A setting that applies the
 * moment it moves is a `Switch`.
 *
 * Give it its label as children and the label is part of the target, which is
 * what a 24pt box needs under a thumb. Bare, it reads its name from the `Field`
 * around it, or from `accessibilityLabel`, and grows its target to 44.
 */
export function Checkbox({
  checked,
  onCheckedChange,
  children,
  description,
  disabled: disabledProp,
  invalid: invalidProp,
  accessibilityLabel,
  className,
}: CheckboxProps): React.JSX.Element {
  const field = useField();
  const press = usePress();
  const ring = useFocusRing();
  const disabled = disabledProp ?? field?.disabled ?? false;
  const invalid = invalidProp ?? field?.invalid ?? false;
  const mixed = checked === 'indeterminate';
  const label = children ?? accessibilityLabel ?? fieldName(field);
  const hint = description ?? fieldHint(field);
  // A labelled row is already wide: it only needs height.
  const slop = children ? { top: SLOP, bottom: SLOP } : SLOP;

  const box = (
    <Animated.View style={press.style}>
      <CheckboxBox
        checked={checked}
        disabled={disabled}
        invalid={invalid}
        pressed={press.pressed}
        focused={ring.focused}
      />
    </Animated.View>
  );

  return (
    <Root
      checked={checked === true}
      onCheckedChange={() => {
        // A mixed box becomes checked: "select all" is what pressing it means.
        onCheckedChange(mixed ? true : !checked);
      }}
      disabled={disabled}
      hitSlop={slop}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onFocus={ring.onFocus}
      onBlur={ring.onBlur}
      {...(label ? { accessibilityLabel: label } : {})}
      {...(hint ? { accessibilityHint: hint } : {})}
      // What the primitive cannot say: mixed, and invalid.
      aria-checked={mixed ? 'mixed' : checked}
      accessibilityState={{ checked: mixed ? 'mixed' : checked, disabled }}
      aria-invalid={invalid || undefined}
      className={cn(
        children ? 'flex-row items-start gap-2.5' : 'self-start',
        disabled && children && 'opacity-50',
        className,
      )}
    >
      {children ? (
        <>
          {box}
          <View className="min-w-0 flex-1 gap-0.5" aria-hidden>
            <CssText className="text-body leading-[1.4] text-fg">{children}</CssText>
            {description ? (
              <CssText className="text-subhead leading-[1.5] text-fg-muted">{description}</CssText>
            ) : null}
          </View>
        </>
      ) : (
        box
      )}
    </Root>
  );
}
