import { useState, type ReactNode, type Ref } from 'react';
import type { TextInput as RNTextInput, TextInputProps as RNTextInputProps } from 'react-native';
import { Text as CssText, TextInput, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import {
  FloatingLabel,
  StateGlyph,
  fieldHint,
  fieldName,
  useField,
  useFloatingLabel,
} from '../field/field.tsx';

/*
 * The look every text-like control shares: Input, Textarea, NumberField,
 * PasswordField, Select's trigger, DatePicker, TimePicker. Filled, not
 * outlined: the sunken fill, lifting to the surface with a 2pt accent ring
 * while focused; a danger ring when invalid, amber for a caution; no fill and
 * a hairline when read-only. 56pt under a thumb, 44 compact, radius 16.
 */

export type FieldBoxState = {
  focused?: boolean;
  invalid?: boolean;
  caution?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
};

export type FieldBoxProps = FieldBoxState & {
  /** The value: a `TextInput`, or a `Text` for a control that opens a picker. */
  children: ReactNode;
  /** `sm` 44pt; `md` and `lg` both 56 under a thumb. */
  size?: 'sm' | 'md' | 'lg';
  /** Grows with its content from 112pt; the label stays above. */
  multiline?: boolean;
  /** Before the value: an `<Icon>`, a currency symbol, a country code. Text is muted. */
  startAdornment?: ReactNode;
  /** After it: a unit, a clear or reveal button, a spinner. */
  endAdornment?: ReactNode;
  /** A trailing button sits 4pt from the edge rather than 16. */
  tight?: boolean;
  className?: string | undefined;
};

function Adornment({ children }: { children: ReactNode }): React.JSX.Element | null {
  if (children == null || children === false) return null;
  if (typeof children === 'string' || typeof children === 'number')
    return (
      <CssText numberOfLines={1} className="text-[17px] text-fg-muted">
        {children}
      </CssText>
    );
  return <>{children}</>;
}

/** A field's shell, its ring, its floating label and its adornments, around a value. */
export function FieldBox({
  children,
  size = 'md',
  multiline = false,
  startAdornment,
  endAdornment,
  tight = false,
  focused = false,
  invalid = false,
  caution = false,
  disabled = false,
  readOnly = false,
  className,
}: FieldBoxProps): React.JSX.Element {
  const field = useField();
  const floats = !multiline && Boolean(field?.parts.label);
  useFloatingLabel(!multiline);
  const ring = focused
    ? 'border-2 border-accent'
    : invalid
      ? 'border-2 border-danger'
      : caution
        ? 'border-2 border-warning'
        : readOnly
          ? 'border border-border'
          : null;
  return (
    <View
      // Says the dimmed text belongs to an inactive control, which is what
      // exempts it from the contrast minimum, as the web's shell does.
      aria-disabled={disabled || undefined}
      className={cn(
        'relative flex-row gap-2.5 rounded-[16px] pl-4',
        tight ? 'pr-1' : 'pr-4',
        multiline ? 'min-h-28 items-start' : size === 'sm' ? 'h-11 items-center' : 'h-m-field items-center',
        focused ? 'bg-surface' : readOnly ? 'bg-transparent' : 'bg-surface-sunken',
        disabled && 'opacity-50',
        className,
      )}
    >
      <Adornment>{startAdornment}</Adornment>
      <View className={cn('min-w-0 flex-1', multiline ? 'self-stretch pt-2.5' : 'gap-0.5')}>
        {floats ? <FloatingLabel focused={focused} invalid={invalid} /> : null}
        {children}
      </View>
      <StateGlyph invalid={invalid} caution={caution} />
      <Adornment>{endAdornment}</Adornment>
      {/* The ring is inset, drawn over the box, so focusing never moves the value. */}
      {ring ? (
        <View
          style={{ pointerEvents: 'none' }}
          className={cn('absolute inset-0 rounded-[16px]', ring)}
        />
      ) : null}
    </View>
  );
}

/** The field's state, from the control's own props or else the `Field` it sits in. */
export function useFieldState(props: {
  invalid?: boolean | undefined;
  disabled?: boolean | undefined;
  caution?: boolean | undefined;
}): {
  invalid: boolean;
  disabled: boolean;
  caution: boolean;
  name: string | undefined;
  hint: string | undefined;
} {
  const field = useField();
  return {
    invalid: props.invalid ?? field?.invalid ?? false,
    disabled: props.disabled ?? field?.disabled ?? false,
    caution: props.caution ?? Boolean(field?.parts.caution),
    name: fieldName(field),
    hint: fieldHint(field),
  };
}

/** The value inside a field: 17pt, the accent caret, a muted placeholder. */
export const fieldText =
  'min-w-0 flex-1 p-0 text-[17px] text-fg placeholder:text-fg-subtle caret-accent outline-none';

/**
 * What a keyboard, autofill and a password manager need to get a field right,
 * from its type: the web's profiles, in React Native's words. Anything passed
 * explicitly still wins.
 */
const profiles = {
  text: {},
  email: {
    keyboardType: 'email-address',
    inputMode: 'email',
    autoComplete: 'email',
    textContentType: 'emailAddress',
    enterKeyHint: 'next',
    autoCapitalize: 'none',
    autoCorrect: false,
    spellCheck: false,
  },
  tel: {
    keyboardType: 'phone-pad',
    inputMode: 'tel',
    autoComplete: 'tel',
    textContentType: 'telephoneNumber',
    enterKeyHint: 'next',
  },
  url: {
    keyboardType: 'url',
    inputMode: 'url',
    autoComplete: 'url',
    textContentType: 'URL',
    enterKeyHint: 'go',
    autoCapitalize: 'none',
    autoCorrect: false,
    spellCheck: false,
  },
  search: {
    inputMode: 'search',
    enterKeyHint: 'search',
    autoCapitalize: 'none',
    autoCorrect: false,
  },
  number: { keyboardType: 'number-pad', inputMode: 'numeric' },
  decimal: { keyboardType: 'decimal-pad', inputMode: 'decimal' },
  password: {
    secureTextEntry: true,
    autoComplete: 'current-password',
    textContentType: 'password',
    autoCapitalize: 'none',
    autoCorrect: false,
    spellCheck: false,
  },
} as const satisfies Record<string, Partial<RNTextInputProps>>;

export type InputType = keyof typeof profiles;

export type InputProps = Omit<
  RNTextInputProps,
  'style' | 'editable' | 'multiline' | 'secureTextEntry' | 'onChange'
> & {
  /** Sets up the keyboard, autofill and autocorrect for the kind of value. */
  type?: InputType;
  /** `sm` 44pt; `md` and `lg` 56 under a thumb. */
  size?: 'sm' | 'md' | 'lg';
  /** Plain callback for the text; `onChangeText` does the same. */
  onChange?: (text: string) => void;
  startAdornment?: ReactNode;
  endAdornment?: ReactNode;
  /** The end adornment is a button: it sits 4pt from the edge. */
  tight?: boolean;
  invalid?: boolean;
  /** Allowed but unusual: an amber ring. Inside a `Field`, a warning `FieldDescription` sets it. */
  caution?: boolean;
  disabled?: boolean;
  /** A value to read, not a field to fill: no fill, a hairline. */
  readOnly?: boolean;
  /** Masks the text. Prefer `PasswordField`. */
  secure?: boolean;
  ref?: Ref<RNTextInput>;
  /** Applied to the shell; the look is the field's. */
  containerClassName?: string | undefined;
  className?: string | undefined;
};

/**
 * Single-line text. Use it inside `Field` unless it labels itself, as a
 * search box does, and then give it an `accessibilityLabel`.
 */
export function Input({
  type = 'text',
  size = 'md',
  onChange,
  onChangeText,
  startAdornment,
  endAdornment,
  tight,
  invalid: invalidProp,
  caution: cautionProp,
  disabled: disabledProp,
  readOnly = false,
  secure,
  onFocus,
  onBlur,
  containerClassName,
  className,
  accessibilityLabel,
  accessibilityHint,
  placeholder,
  ref,
  ...props
}: InputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const { invalid, disabled, caution, name, hint } = useFieldState({
    invalid: invalidProp,
    disabled: disabledProp,
    caution: cautionProp,
  });
  const label = accessibilityLabel ?? name ?? placeholder;
  const help = accessibilityHint ?? hint;
  return (
    <FieldBox
      size={size}
      focused={focused && !readOnly}
      invalid={invalid}
      caution={caution}
      disabled={disabled}
      readOnly={readOnly}
      startAdornment={startAdornment}
      endAdornment={endAdornment}
      tight={tight ?? false}
      className={containerClassName}
    >
      <TextInput
        ref={ref}
        {...profiles[type]}
        {...(secure === undefined ? {} : { secureTextEntry: secure })}
        {...props}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(label ? { accessibilityLabel: label } : {})}
        {...(help ? { accessibilityHint: help } : {})}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        accessibilityState={{ disabled }}
        editable={!disabled && !readOnly}
        readOnly={readOnly}
        onChangeText={(text) => {
          onChangeText?.(text);
          onChange?.(text);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        className={cn(fieldText, 'self-stretch', className)}
      />
    </FieldBox>
  );
}

export type TextareaProps = Omit<InputProps, 'type' | 'size' | 'startAdornment' | 'tight'> & {
  /** The starting height in lines; it grows with what is typed. */
  rows?: number;
};

/** Several lines. The label stays above it, and it grows as it fills. */
export function Textarea({
  rows = 4,
  onChange,
  onChangeText,
  endAdornment,
  invalid: invalidProp,
  caution: cautionProp,
  disabled: disabledProp,
  readOnly = false,
  onFocus,
  onBlur,
  containerClassName,
  className,
  accessibilityLabel,
  accessibilityHint,
  placeholder,
  ref,
  ...props
}: TextareaProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  const { invalid, disabled, caution, name, hint } = useFieldState({
    invalid: invalidProp,
    disabled: disabledProp,
    caution: cautionProp,
  });
  const label = accessibilityLabel ?? name ?? placeholder;
  const help = accessibilityHint ?? hint;
  return (
    <FieldBox
      multiline
      focused={focused && !readOnly}
      invalid={invalid}
      caution={caution}
      disabled={disabled}
      readOnly={readOnly}
      endAdornment={endAdornment}
      className={containerClassName}
    >
      <TextInput
        ref={ref}
        multiline
        numberOfLines={rows}
        textAlignVertical="top"
        {...props}
        {...(placeholder === undefined ? {} : { placeholder })}
        {...(label ? { accessibilityLabel: label } : {})}
        {...(help ? { accessibilityHint: help } : {})}
        aria-invalid={invalid || undefined}
        aria-disabled={disabled || undefined}
        accessibilityState={{ disabled }}
        editable={!disabled && !readOnly}
        readOnly={readOnly}
        onChangeText={(text) => {
          onChangeText?.(text);
          onChange?.(text);
        }}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        className={cn(fieldText, 'min-h-[92px] pb-2.5 leading-[1.45]', className)}
      />
    </FieldBox>
  );
}
