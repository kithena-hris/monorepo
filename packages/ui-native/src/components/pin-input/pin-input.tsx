import { Fragment, useState } from 'react';
import { Text as CssText, TextInput, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';

export type PinInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Fires once the last box is filled. Submit from here, not from a timer. */
  onComplete?: (value: string) => void;
  length?: number;
  /** Required: the name a screen reader hears. "Verification code", not "PIN". */
  label: string;
  /** Under the boxes. */
  hint?: string;
  /** `numeric` gives the number pad. `alphanumeric` allows letters, shown in capitals. */
  type?: 'numeric' | 'alphanumeric';
  /** Masks the characters. For a stored PIN, not for a one-time code. */
  masked?: boolean;
  /** A gap after this many boxes, for a code read in groups. */
  groupAfter?: number;
  disabled?: boolean;
  invalid?: boolean;
  /**
   * The code was checked and accepted: every box rings in success. A full
   * code is not yet a right one, so filling the last box alone does not.
   */
  accepted?: boolean;
  autoFocus?: boolean;
  className?: string | undefined;
};

/**
 * One box for each character. The boxes are a drawing of one real text field
 * lying over them, so typing moves along, backspace moves back, and a pasted
 * or autofilled code (`oneTimeCode`, SMS retriever) fills every box at once.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  hint,
  type = 'numeric',
  masked = false,
  groupAfter,
  disabled = false,
  invalid = false,
  accepted = false,
  autoFocus = false,
  className,
}: PinInputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const allowed = type === 'numeric' ? /\d/ : /[a-z0-9]/i;

  const change = (raw: string): void => {
    const next = Array.from(raw)
      .filter((c) => allowed.test(c))
      .join('')
      .slice(0, length);
    const shown = type === 'alphanumeric' ? next.toUpperCase() : next;
    onChange(shown);
    if (shown.length === length) onComplete?.(shown);
  };

  const ring = (i: number): string | null => {
    if (invalid) return 'border-2 border-danger';
    if (focused && i === Math.min(value.length, length - 1)) return 'border-2 border-accent';
    if (accepted) return 'border-2 border-success';
    return null;
  };

  return (
    <View className={cn('gap-3', className)}>
      <View className={cn('relative flex-row gap-2 self-start', disabled && 'opacity-50')}>
        {Array.from({ length }, (_, i) => {
          const char = value[i];
          const current = focused && i === Math.min(value.length, length - 1);
          return (
            <Fragment key={i}>
              {groupAfter && i > 0 && i % groupAfter === 0 ? (
                <View className="h-0.5 w-2.5 self-center rounded-full bg-fg-subtle" />
              ) : null}
              <View
                className={cn(
                  'h-[58px] w-12 items-center justify-center rounded-[14px]',
                  current ? 'bg-surface' : 'bg-surface-sunken',
                )}
              >
                {char === undefined ? (
                  current ? (
                    <View className="h-6 w-0.5 bg-accent" />
                  ) : null
                ) : masked ? (
                  <View className="size-3 rounded-full bg-fg" />
                ) : (
                  <CssText className="text-[24px] font-bold text-fg tabular-nums">{char}</CssText>
                )}
                {ring(i) ? (
                  <View
                    style={{ pointerEvents: 'none' }}
                    className={cn('absolute inset-0 rounded-[14px]', ring(i))}
                  />
                ) : null}
              </View>
            </Fragment>
          );
        })}
        {/* The real field, invisible, over the boxes: a tap anywhere lands in it. */}
        <TextInput
          value={value}
          onChangeText={change}
          maxLength={length}
          editable={!disabled}
          autoFocus={autoFocus}
          keyboardType={type === 'numeric' ? 'number-pad' : 'default'}
          inputMode={type === 'numeric' ? 'numeric' : 'text'}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          secureTextEntry={masked}
          caretHidden
          accessibilityLabel={`${label}, ${String(length)} characters`}
          {...(hint ? { accessibilityHint: hint } : {})}
          aria-invalid={invalid || undefined}
          aria-disabled={disabled || undefined}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          className="absolute inset-0 text-transparent opacity-0 outline-none"
        />
      </View>
      {hint ? (
        <CssText className={cn('text-subhead', invalid ? 'text-danger-fg' : 'text-fg-muted')}>
          {hint}
        </CssText>
      ) : null}
    </View>
  );
}
