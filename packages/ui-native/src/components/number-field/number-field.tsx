import { Minus, Plus } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { Button } from '../button/button.tsx';
import { Field, FieldDescription, FieldError, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';
import { formatNumber, parseNumber } from './number-format.ts';

export type NumberFieldProps = {
  /** `null` is empty, which is a different fact from 0. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Required. A number field with no label is a box. */
  label: string;
  hint?: string;
  /** Shown while invalid, in place of the hint. */
  error?: string;
  min?: number;
  max?: number;
  /** The steppers' increment. */
  step?: number;
  /** Decimal places. Money should not be here at all: see `Money`. */
  precision?: number;
  /** How the number is written and read: `0,8` in `de-DE`. The device's locale by default. */
  locale?: string;
  /** Inside the field, before the number: a currency symbol. */
  prefix?: ReactNode;
  /** After it: a unit, days, %. */
  suffix?: ReactNode;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  /** Hides − and +. */
  hideSteppers?: boolean;
  className?: string | undefined;
};

/**
 * A number, with steppers. A text field with the decimal keypad, parsed here
 * in the locale's own marks, so a German `1,5` is one and a half.
 *
 * Clamping happens when the field is left, not on each key: clamping as the
 * person types makes 10 unreachable in a field whose minimum is 5.
 */
export function NumberField({
  value,
  onChange,
  label,
  hint,
  error,
  min,
  max,
  step = 1,
  precision,
  locale,
  prefix,
  suffix,
  placeholder,
  size = 'md',
  disabled = false,
  readOnly = false,
  invalid = false,
  hideSteppers = false,
  className,
}: NumberFieldProps): React.JSX.Element {
  // What is being typed, which is not yet a number: "1," and "-" are both fine.
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number): number => Math.min(max ?? n, Math.max(min ?? n, n));
  const commit = (n: number | null): void => {
    setDraft(null);
    onChange(n === null ? null : clamp(n));
  };
  const stepBy = (direction: 1 | -1): void => {
    const next = clamp((value ?? min ?? 0) + direction * step);
    // 0.1 + 0.2 is not 0.3, and a stepper is exactly where someone watches it.
    commit(Number(next.toFixed(precision ?? 10)));
  };
  const atMin = min !== undefined && value !== null && value <= min;
  const atMax = max !== undefined && value !== null && value >= max;
  const inert = disabled || readOnly;

  const steppers = hideSteppers ? null : (
    <View className="-mr-1.5 flex-row gap-0.5">
      <Button
        variant="ghost"
        size="xs"
        startIcon={<Icon icon={Minus} />}
        accessibilityLabel={`Decrease ${label}`}
        disabled={inert || atMin}
        onPress={() => {
          stepBy(-1);
        }}
      />
      <Button
        variant="ghost"
        size="xs"
        startIcon={<Icon icon={Plus} />}
        accessibilityLabel={`Increase ${label}`}
        disabled={inert || atMax}
        onPress={() => {
          stepBy(1);
        }}
      />
    </View>
  );
  const unit =
    typeof suffix === 'string' ? (
      <CssText className="text-[17px] text-fg-muted">{suffix}</CssText>
    ) : (
      suffix
    );

  return (
    <Field invalid={invalid || Boolean(error)} disabled={disabled} className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={precision === 0 ? 'number' : 'decimal'}
        size={size}
        readOnly={readOnly}
        value={draft ?? formatNumber(value, locale, precision)}
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={setDraft}
        onBlur={() => {
          if (draft !== null) commit(parseNumber(draft, locale));
        }}
        onSubmitEditing={() => {
          if (draft !== null) commit(parseNumber(draft, locale));
        }}
        autoComplete="off"
        role="spinbutton"
        {...(min === undefined ? {} : { 'aria-valuemin': min })}
        {...(max === undefined ? {} : { 'aria-valuemax': max })}
        {...(value === null ? { 'aria-valuetext': 'Empty' } : { 'aria-valuenow': value })}
        className="tabular-nums"
        startAdornment={prefix}
        endAdornment={
          unit && steppers ? (
            <View className="flex-row items-center gap-1.5">
              {unit}
              {steppers}
            </View>
          ) : (
            (unit ?? steppers)
          )
        }
      />
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}
