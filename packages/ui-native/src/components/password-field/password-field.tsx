import { Circle, CircleCheck, Eye, EyeOff } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Field, FieldDescription, FieldError, FieldLabel } from '../field/field.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input } from '../input/input.tsx';

export type PasswordRequirement = { id: string; label: string; test: (value: string) => boolean };

export type PasswordFieldProps = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** The label is read, not drawn: for a row that already says what the field is. */
  hideLabel?: boolean;
  hint?: string;
  /** Shown while invalid, in place of the hint. */
  error?: string;
  /**
   * Required, with no default: `current-password` signing in, `new-password`
   * setting one. The wrong one breaks every password manager.
   */
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** Starts with the password shown. */
  defaultRevealed?: boolean;
  /** The strength meter. Only meaningful with `new-password`. */
  showStrength?: boolean;
  /** A live checklist. Advice, not a gate: the server decides. */
  requirements?: readonly PasswordRequirement[];
  className?: string | undefined;
};

export const defaultPasswordRequirements: readonly PasswordRequirement[] = [
  { id: 'length', label: 'At least 12 characters', test: (v) => v.length >= 12 },
  { id: 'case', label: 'Upper and lower case', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: 'number', label: 'A number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'A symbol', test: (v) => /[^\w\s]/.test(v) },
];

const strengthLabel = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
const strengthTone = [
  'bg-danger',
  'bg-danger',
  'bg-warning',
  'bg-success',
  'bg-success',
] as const;

/** The web's estimate, 0 to 4: length, and the kinds of character in it. */
function estimateStrength(value: string): number {
  if (value === '') return 0;
  const variety =
    Number(/[a-z]/.test(value)) +
    Number(/[A-Z]/.test(value)) +
    Number(/\d/.test(value)) +
    Number(/[^\w\s]/.test(value));
  const lengthScore = value.length >= 20 ? 3 : value.length >= 14 ? 2 : value.length >= 10 ? 1 : 0;
  return Math.min(4, lengthScore + Math.max(0, variety - 1));
}

/**
 * Masked by default, with a reveal button. Paste is never blocked: blocking it
 * pushes people off their password manager and onto weaker passwords.
 */
export function PasswordField({
  value,
  onChange,
  label,
  hideLabel = false,
  hint,
  error,
  autoComplete,
  placeholder,
  size = 'md',
  disabled = false,
  invalid = false,
  defaultRevealed = false,
  autoFocus = false,
  showStrength = false,
  requirements,
  className,
}: PasswordFieldProps): React.JSX.Element {
  const [revealed, setRevealed] = useState(defaultRevealed);
  const strength = useMemo(() => estimateStrength(value), [value]);
  const checks = (requirements ?? []).map((rule) => ({
    id: rule.id,
    label: rule.label,
    met: rule.test(value),
  }));
  const met = checks.filter((rule) => rule.met).length;

  return (
    <View className={cn('gap-3', className)}>
      <Field invalid={invalid || Boolean(error)} disabled={disabled}>
        {hideLabel ? null : <FieldLabel>{label}</FieldLabel>}
        <Input
          {...(hideLabel ? { accessibilityLabel: label } : {})}
          type="password"
          secure={!revealed}
          autoComplete={autoComplete}
          textContentType={autoComplete === 'new-password' ? 'newPassword' : 'password'}
          size={size}
          value={value}
          onChange={onChange}
          {...(placeholder === undefined ? {} : { placeholder })}
          autoFocus={autoFocus}
          tight
          endAdornment={
            <Button
              variant="ghost"
              size="xs"
              startIcon={<Icon icon={revealed ? EyeOff : Eye} size={19} tone="muted" />}
              accessibilityLabel={revealed ? `Hide ${label}` : `Show ${label}`}
              disabled={disabled}
              onPress={() => {
                setRevealed(!revealed);
              }}
            />
          }
        />
        {hint ? <FieldDescription>{hint}</FieldDescription> : null}
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>

      {showStrength ? (
        <View
          role="progressbar"
          aria-label={`${label} strength`}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={strength}
          aria-valuetext={value === '' ? 'Empty' : strengthLabel[strength]}
          className="gap-2"
        >
          <View className="flex-row justify-between gap-3">
            <CssText className="text-subhead font-medium text-fg">
              {value === '' ? ' ' : strengthLabel[strength]}
            </CssText>
            {checks.length > 0 ? (
              <CssText className="text-subhead font-medium text-fg-muted tabular-nums">
                {met} of {checks.length}
              </CssText>
            ) : null}
          </View>
          <View className="h-2 overflow-hidden rounded-full bg-surface-active">
            <View
              className={cn('h-full rounded-full', strengthTone[strength])}
              style={{ width: `${String((strength / 4) * 100)}%` as `${number}%` }}
            />
          </View>
        </View>
      ) : null}

      {checks.length > 0 ? (
        <View className="gap-1.5">
          {checks.map((rule) => (
            <View
              key={rule.id}
              accessible
              accessibilityLabel={`${rule.label}, ${rule.met ? 'met' : 'not met'}`}
              className="flex-row items-center gap-2"
            >
              <Icon
                icon={rule.met ? CircleCheck : Circle}
                size={16}
                tone={rule.met ? 'success' : 'subtle'}
              />
              <CssText className={cn('text-subhead', rule.met ? 'text-fg' : 'text-fg-muted')}>
                {rule.label}
              </CssText>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
