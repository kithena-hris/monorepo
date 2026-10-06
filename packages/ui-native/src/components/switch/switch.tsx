import * as SwitchPrimitive from '@rn-primitives/switch';
import { useEffect, useRef } from 'react';
import { styled } from 'react-native-css';
import { Text as CssText, View } from 'react-native-css/components';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { animateTo } from '../../lib/animate.ts';
import { cn } from '../../lib/cn.ts';
import { physics, springs } from '../../lib/motion.ts';
import { flatStyle } from '../../lib/overlay.tsx';
import { useReducedMotion } from '../../provider.tsx';
import { fieldHint, fieldName, useField } from '../field/field.tsx';
import { Spinner } from '../spinner/spinner.tsx';

const Root = styled(flatStyle(SwitchPrimitive.Root));

/** The iOS switch: a 51 × 31 track, a 27pt thumb 2pt in from either end. */
const TRAVEL = 51 - 27 - 4;
/** The switch is 31 tall; `hitSlop` takes it to 44 without spacing a list apart. */
const SLOP = { top: 7, bottom: 7, left: 4, right: 4 };

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The label, on the left. The whole row is then the target. */
  children?: string;
  /** A second line under the label. */
  description?: string;
  /**
   * The write failed. Put `checked` back and say so here: it replaces the
   * description, in danger, and is announced.
   */
  error?: string;
  /**
   * The change is being saved. The thumb carries a spinner and further presses
   * wait for the write, at full strength: it has not been refused, only not yet
   * confirmed.
   */
  loading?: boolean;
  disabled?: boolean;
  /** On and wrong: a danger track. */
  invalid?: boolean;
  /** Without `children` or a `Field`, the name a screen reader hears. */
  accessibilityLabel?: string;
  className?: string | undefined;
};

/** The track and thumb, for a row that is itself the control (a menu item, a list row). */
export function SwitchTrack({
  checked,
  disabled = false,
  invalid = false,
  loading = false,
}: {
  checked: boolean;
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const x = useSharedValue(checked ? TRAVEL : 0);
  // The thumb is the one physical object in a switch, so it moves on the snap
  // spring; colour has no mass and simply changes. Reduced motion: it jumps.
  const mounted = useRef(false);
  useEffect(() => {
    // It mounts where it is; only a change travels.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const to = checked ? TRAVEL : 0;
    x.value = reduced ? to : animateTo(to, physics(springs.snap));
  }, [checked, reduced, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <View
      className={cn(
        'h-[31px] w-[51px] justify-center rounded-full px-0.5',
        checked
          ? disabled
            ? 'bg-surface-active'
            : invalid
              ? 'bg-danger'
              : 'bg-success'
          : 'bg-surface-active',
        disabled && 'opacity-50',
      )}
    >
      <Animated.View style={thumb}>
        <View className="size-[27px] items-center justify-center rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]">
          {loading ? <Spinner size={19} decorative /> : null}
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * On or off, and it applies the moment it moves. If the setting waits for a
 * Save button it is a `Checkbox`.
 *
 * If the write takes a moment, pass `loading`; if it fails, put `checked`
 * back and pass `error`, so nobody walks away believing it saved.
 */
export function Switch({
  checked,
  onCheckedChange,
  children,
  description,
  error,
  loading = false,
  disabled: disabledProp,
  invalid: invalidProp,
  accessibilityLabel,
  className,
}: SwitchProps): React.JSX.Element {
  const field = useField();
  const disabled = disabledProp ?? field?.disabled ?? false;
  const invalid = invalidProp ?? field?.invalid ?? false;
  const label = children ?? accessibilityLabel ?? fieldName(field);
  const hint = error ?? description ?? fieldHint(field);

  return (
    <Root
      checked={checked}
      onCheckedChange={(next: boolean) => {
        if (!loading) onCheckedChange(next);
      }}
      disabled={disabled}
      hitSlop={children ? { top: 8, bottom: 8 } : SLOP}
      {...(label ? { accessibilityLabel: label } : {})}
      {...(hint ? { accessibilityHint: hint } : {})}
      accessibilityState={{ checked, disabled, busy: loading }}
      aria-busy={loading || undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        children ? 'flex-row items-center justify-between gap-3' : 'self-start',
        disabled && children && 'opacity-60',
        className,
      )}
    >
      {children ? (
        <View className="min-w-0 flex-1 gap-0.5">
          <CssText aria-hidden className="text-body leading-[1.4] text-fg">
            {children}
          </CssText>
          {description && !error ? (
            <CssText aria-hidden className="text-subhead leading-[1.5] text-fg-muted">
              {description}
            </CssText>
          ) : null}
          {error ? <SwitchError>{error}</SwitchError> : null}
        </View>
      ) : null}
      <SwitchTrack checked={checked} disabled={disabled} invalid={invalid} loading={loading} />
    </Root>
  );
}

/** A failed write, under the label, announced when it arrives. */
function SwitchError({ children }: { children: string }): React.JSX.Element {
  return (
    <CssText
      accessibilityLiveRegion="polite"
      aria-live="polite"
      className="text-subhead text-danger-fg"
    >
      {children}
    </CssText>
  );
}
