'use client';

import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useId, useMemo, useState, type JSX, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A password field.
 *
 * ### The security decisions, and why they go this way
 *
 * **Paste is never blocked.** Blocking it is the single most common
 * anti-pattern here and it makes things strictly worse: it defeats password
 * managers, which pushes people onto passwords they can type, which means
 * short and reused ones. NCSC and NIST both say so explicitly.
 *
 * **`autoComplete` is mandatory and must be right.** `current-password` on a
 * sign-in, `new-password` on a change or a registration. Get it wrong and the
 * manager either fails to offer a saved credential or silently overwrites one.
 * The prop has no default for exactly that reason, a wrong default is worse
 * than a compile error.
 *
 * **Reveal is a toggle, not a mode.** It is `aria-pressed`, it never changes
 * the field's `name` or `autoComplete`, and it does not survive a re-render as
 * some component libraries manage. Revealing is also the accessible answer for
 * anyone who cannot touch-type a 24-character passphrase.
 *
 * **No maximum length, no character-class rules.** Both push entropy down.
 * The strength meter measures length and variety and says so in words; it is
 * advice, never a gate, and the real check belongs on the server against a
 * breached-password list.
 *
 * **Nothing is logged.** The value never leaves the component except through
 * `onChange`. There is no `onCopy` handler, and the strength calculation is
 * local.
 *
 * ### Accessibility
 *
 * The strength meter is a `progressbar` with a text value, the requirement
 * list is a real list with per-item state, and both are wired through
 * `aria-describedby`. Announcements are polite and debounced by the browser's
 * own live-region behaviour, a meter that speaks on every keystroke is a
 * field nobody can fill in with a screen reader.
 */

export interface PasswordRequirement {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hint?: ReactNode;
  /**
   * **Required, and there is no default.** `current-password` when signing in,
   * `new-password` when setting one. The wrong value breaks every password
   * manager in a way nobody notices until support tickets arrive.
   */
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  invalid?: boolean;
  /** Shows the strength meter. Only meaningful with `new-password`. */
  showStrength?: boolean;
  /** Live checklist. Advice, not a gate, the server decides. */
  requirements?: readonly PasswordRequirement[];
  className?: string;
  name?: string;
  id?: string;
}

const sizeClass = {
  sm: 'h-control-sm text-xs px-2.5',
  md: 'h-control-md text-base px-3',
  lg: 'h-control-lg text-md px-3.5',
} as const;

/** The default advice. Length first, because length is what actually matters. */
export const defaultPasswordRequirements: readonly PasswordRequirement[] = [
  { id: 'length', label: 'At least 12 characters', test: (value) => value.length >= 12 },
  {
    id: 'case',
    label: 'Upper and lower case',
    test: (value) => /[a-z]/.test(value) && /[A-Z]/.test(value),
  },
  { id: 'number', label: 'A number', test: (value) => /\d/.test(value) },
  { id: 'symbol', label: 'A symbol', test: (value) => /[^\w\s]/.test(value) },
];

const strengthLabel = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
const strengthTone = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'] as const;

/**
 * A rough estimate, deliberately. Real strength is a dictionary problem, this
 * cannot know that `Tr0ub4dor&3` is weak or that four random words are strong,
 * and it says "estimate" rather than pretending otherwise.
 */
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

export function PasswordField({
  value,
  onChange,
  label,
  hint,
  autoComplete,
  placeholder,
  size = 'md',
  disabled = false,
  invalid = false,
  showStrength = false,
  requirements,
  className,
  name,
  id: providedId,
}: PasswordFieldProps): JSX.Element {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const hintId = `${id}-hint`;
  const strengthId = `${id}-strength`;
  const requirementsId = `${id}-requirements`;
  const [revealed, setRevealed] = useState(false);

  const strength = useMemo(() => estimateStrength(value), [value]);
  // Builds exactly what the list renders rather than spreading the rule and
  // adding to it. The `test` function was being copied into every entry on
  // every keystroke and never read again; only these three are used below.
  const checks = useMemo(
    () =>
      (requirements ?? []).map((rule) => ({
        id: rule.id,
        label: rule.label,
        met: rule.test(value),
      })),
    [requirements, value],
  );

  const describedBy =
    [hint ? hintId : '', showStrength ? strengthId : '', checks.length > 0 ? requirementsId : '']
      .filter(Boolean)
      .join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm leading-none font-medium text-fg">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}

      <div
        className={cn(
          'flex items-center rounded-md border bg-surface',
          'transition-[border-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
          'focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus/30',
          invalid ? 'border-danger' : 'border-border',
          sizeClass[size],
          disabled && 'pointer-events-none opacity-55',
        )}
      >
        <input
          id={id}
          name={name}
          type={revealed ? 'text' : 'password'}
          // Never changed by the reveal toggle: a manager keys off this, and a
          // field that becomes `type="text"` with `autoComplete="off"` mid-edit
          // is a saved credential that silently stops being offered.
          autoComplete={autoComplete}
          // A password is not a sentence. All three would otherwise mangle the
          // first character on a phone.
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-fg-subtle"
        />

        <button
          type="button"
          // `aria-pressed`, so the state is announced. A button whose only
          // signal is which of two similar glyphs it shows is not a state.
          aria-pressed={revealed}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          disabled={disabled}
          onClick={() => {
            setRevealed((current) => !current);
          }}
          className={cn(
            '-me-1 grid size-8 shrink-0 place-items-center rounded-sm text-fg-subtle',
            'transition-colors duration-(--animate-duration-fast)',
            'hover:bg-surface-hover hover:text-fg',
            'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-border-focus',
          )}
        >
          {revealed ? (
            <EyeOff className="size-4 animate-scale-in" aria-hidden />
          ) : (
            <Eye className="size-4 animate-scale-in" aria-hidden />
          )}
        </button>
      </div>

      {showStrength ? (
        <div
          id={strengthId}
          role="progressbar"
          aria-label={`${label} strength`}
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={strength}
          aria-valuetext={value === '' ? 'Empty' : strengthLabel[strength]}
          className="flex items-center gap-2"
        >
          <div aria-hidden className="flex h-1 flex-1 gap-1">
            {[0, 1, 2, 3].map((segment) => (
              <span
                key={segment}
                className={cn(
                  'h-full flex-1 rounded-full transition-colors duration-(--animate-duration-normal) ease-standard',
                  value !== '' && segment < strength ? strengthTone[strength] : 'bg-surface-sunken',
                )}
              />
            ))}
          </div>
          <span className="w-20 text-end text-xs text-fg-muted">
            {value === '' ? '' : strengthLabel[strength]}
          </span>
        </div>
      ) : null}

      {checks.length > 0 ? (
        <ul id={requirementsId} className="mt-0.5 space-y-1">
          {checks.map((rule) => (
            <li key={rule.id} className="flex items-center gap-1.5 text-xs">
              {rule.met ? (
                <Check className="size-3.5 shrink-0 animate-scale-in text-success-fg" aria-hidden />
              ) : (
                <X className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
              )}
              <span className={rule.met ? 'text-fg-muted' : 'text-fg-subtle'}>{rule.label}</span>
              {/* The state in words as well as in a glyph, for the same reason
                  every other status in this system carries a label. */}
              <span className="sr-only">{rule.met ? ',  met' : ',  not met'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
