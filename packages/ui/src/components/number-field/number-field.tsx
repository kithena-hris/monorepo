'use client';

import { Minus, Plus } from 'lucide-react';
import { useId, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import {
  fieldHintClass,
  fieldLabelClass,
  fieldShell,
  floatLabel,
  floatRoot,
  floatShell,
  floatValue,
} from '../field/field-styles';

/**
 * A number, with steppers.
 *
 * ### Why not `<input type="number">`
 *
 * It is one of the least reliable controls on the platform:
 *
 * - a scroll wheel over a focused field silently changes the value, which on a
 *   long form is a corrupted record nobody noticed;
 * - Chrome and Firefox disagree about whether letters can be typed at all, and
 *   both return an empty string for an invalid value, so `""` means both
 *   "empty" and "the user typed `1e`";
 * - the spinner cannot be styled, and disappears entirely on a phone;
 * - locale is ignored: a German user typing `1,5` gets nothing.
 *
 * This is `inputMode="decimal"` on a text input, with the parsing done here.
 * The keyboard on a phone is still numeric, the arrow keys still step, and the
 * value is a `number | null`, with `null` for empty, which is a different fact
 * from zero and matters when zero is a legitimate salary component.
 *
 * ### Clamping happens on blur, not on keystroke
 *
 * Clamping as the user types makes `10` unreachable in a field with a minimum
 * of 5: the `1` is corrected to 5 before the `0` arrives. The value is
 * constrained when the field is left, and the constraint is announced.
 */

export interface NumberFieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Required. A number field with no label is a box. */
  label: string;
  hint?: ReactNode;
  min?: number;
  max?: number;
  /** Arrow-key and stepper increment. Shift multiplies it by ten. */
  step?: number;
  /** Decimal places. Money should not be here at all: see `Money`. */
  precision?: number;
  /** Rendered inside the field, before the number: a currency symbol, a %. */
  prefix?: ReactNode;
  /** Rendered after: a unit: days, hours, %. */
  suffix?: ReactNode;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  /** Hides the +/− buttons. The arrow keys still step. */
  hideSteppers?: boolean;
  className?: string;
  name?: string;
}

/** Accepts both decimal separators, because half of Europe types a comma. */
function parse(input: string): number | null {
  const normalised = input.replace(',', '.').trim();
  if (normalised === '') return null;
  const parsed = Number(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

export function NumberField({
  value,
  onChange,
  label,
  hint,
  min,
  max,
  step = 1,
  precision,
  prefix,
  suffix,
  placeholder,
  size = 'md',
  disabled = false,
  readOnly = false,
  invalid = false,
  hideSteppers = false,
  className,
  name,
}: NumberFieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  // The text the user is typing, which is not the same thing as the value:
  // "1." and "-" are both valid intermediate states and neither is a number.
  const [draft, setDraft] = useState<string | null>(null);

  const format = (input: number): string =>
    precision === undefined ? String(input) : input.toFixed(precision);

  const display = draft ?? (value === null ? '' : format(value));

  const clamp = (input: number): number => {
    const lower = min === undefined ? input : Math.max(min, input);
    return max === undefined ? lower : Math.min(max, lower);
  };

  const commit = (next: number | null): void => {
    setDraft(null);
    onChange(next === null ? null : clamp(next));
  };

  const stepBy = (direction: 1 | -1, multiplier = 1): void => {
    if (disabled || readOnly) return;
    const base = value ?? min ?? 0;
    const next = clamp(base + direction * step * multiplier);
    // Floating point: 0.1 + 0.2 is not 0.3, and a stepper is exactly where a
    // user watches that happen.
    const rounded =
      precision === undefined ? Number(next.toFixed(10)) : Number(next.toFixed(precision));
    setDraft(null);
    onChange(rounded);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepBy(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey ? 10 : 1);
      return;
    }
    if (event.key === 'Enter') commit(parse(display));
  };

  const float = size !== 'sm' && !prefix;
  const atMin = min !== undefined && value !== null && value <= min;
  const atMax = max !== undefined && value !== null && value >= max;

  return (
    <div className={cn('group/field flex flex-col gap-1.5', floatRoot, className)}>
      <label htmlFor={id} className={cn(fieldLabelClass, floatLabel)}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}

      <div
        // The label floats inside only when nothing sits at the leading edge
        // where it would start: a prefix keeps it above. The steppers sit
        // together at the trailing edge, − then +, so they never do.
        data-float={float ? '' : undefined}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        className={cn(
          fieldShell({ size }),
          'items-stretch gap-0',
          !hideSteppers && 'pe-1 touch:pe-1.5',
          float && floatShell,
          readOnly && 'bg-transparent ring-1 ring-border ring-inset',
        )}
      >
        {prefix ? (
          <span className="grid place-items-center pe-1.5 text-fg-muted">{prefix}</span>
        ) : null}

        <input
          id={id}
          // `text` with `inputMode`, not `type="number"`: see the docblock.
          // The mobile keyboard is still numeric; the desktop misbehaviour is
          // not inherited.
          type="text"
          inputMode={precision === 0 ? 'numeric' : 'decimal'}
          // Announced as a spinner with its bounds, which is what
          // `type="number"` would have given and what this must not lose.
          role="spinbutton"
          aria-valuenow={value ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={value === null ? 'Empty' : undefined}
          aria-describedby={hint ? hintId : undefined}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          value={display}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={disabled}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = parse(event.target.value);
            // Reported unclamped while typing: clamping per keystroke makes 10
            // unreachable in a field whose minimum is 5.
            onChange(parsed);
          }}
          onBlur={() => {
            commit(parse(display));
          }}
          onKeyDown={onKeyDown}
          // The scroll-wheel bug, closed. A wheel over a focused number input
          // changes the value in every browser that implements the spinner.
          onWheel={(event) => {
            event.currentTarget.blur();
          }}
          className={cn(
            'w-full min-w-0 bg-transparent text-fg tabular-nums outline-none',
            'placeholder:text-fg-subtle',
            float && floatValue,
          )}
        />

        {suffix ? (
          <span className="grid place-items-center ps-1.5 text-fg-muted">{suffix}</span>
        ) : null}

        {!hideSteppers ? (
          <span className="flex shrink-0 items-center gap-0.5 ps-1.5">
            <Stepper
              label={`Decrease ${label}`}
              disabled={disabled || readOnly || atMin}
              onPress={() => {
                stepBy(-1);
              }}
            >
              <Minus aria-hidden />
            </Stepper>
            <Stepper
              label={`Increase ${label}`}
              disabled={disabled || readOnly || atMax}
              onPress={() => {
                stepBy(1);
              }}
            >
              <Plus aria-hidden />
            </Stepper>
          </span>
        ) : null}
      </div>

      {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
    </div>
  );
}

function Stepper({
  label,
  disabled,
  onPress,
  children,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      // `tabIndex={-1}`: the field is one tab stop and the arrow keys already
      // step it. Two extra stops per number on a form of twenty is forty
      // presses to cross.
      tabIndex={-1}
      aria-label={label}
      aria-hidden
      disabled={disabled}
      onClick={onPress}
      className={cn(
        // A round, quiet button inside the fill, centred on the field's
        // height. Out of the tab order (see above), so no target floor: the
        // keyboard steps and the field itself is the tap target.
        'grid size-8 shrink-0 place-items-center self-center rounded-full text-fg-muted touch:size-10',
        'transition-colors duration-(--animate-duration-fast)',
        'hover:bg-surface-active hover:text-fg active:bg-surface-active',
        'disabled:pointer-events-none disabled:opacity-40',
        '[&_svg]:size-4',
      )}
    >
      {children}
    </button>
  );
}
