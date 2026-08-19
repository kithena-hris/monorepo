'use client';

import { Star } from 'lucide-react';
import { useId, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A star rating.
 *
 * ### It is a radio group, not a row of buttons
 *
 * Five buttons that each set a value is five tab stops, five announcements,
 * and no indication that they are alternatives. This renders
 * `role="radiogroup"` with one tab stop: arrow keys move between values, Home
 * and End jump to the ends, and a screen reader says "3 of 5, radio, selected"
 * rather than "star, button".
 *
 * Native `<input type="radio">` would be better still, and is what
 * `RadioGroup` uses, but a star rating needs *half* the glyph filled for a
 * fractional average, and a radio input cannot be split. So the ARIA is ours,
 * which is why the keyboard handling below is explicit.
 *
 * ### Reading and writing are different components
 *
 * `readOnly` is not a disabled state. A displayed average is not a control at
 * all: it renders as an `<img>`-role element with a text alternative
 * ("4.2 out of 5"), takes no tab stop, and supports fractions. An interactive
 * rating never shows a fraction, because nobody can click 4.2.
 *
 * ### Colour is never the only signal
 *
 * The value is always available as text. `showValue`, or the accessible name.
 * A row of gold shapes is not a number to someone who cannot separate gold
 * from grey.
 */

export interface RatingProps {
  /** Current value. Fractions are only rendered in `readOnly` mode. */
  value?: number;
  onChange?: (value: number) => void;
  /** How many symbols. Five is conventional; three and ten both exist. */
  max?: number;
  /** Required. "Interview performance", not "Rating". */
  label: string;
  /**
   * Word per value, announced instead of the bare number. A rating with
   * meanings attached is a rating people use consistently, "3 of 5" means
   * nothing until it means "Meets expectations".
   */
  valueLabels?: readonly string[];
  size?: 'sm' | 'md' | 'lg';
  /** Prints the number, and the label for the hovered value, beside the stars. */
  showValue?: boolean;
  /** Allows clearing back to zero by re-picking the current value. */
  clearable?: boolean;
  /** Display only: no tab stop, fractions rendered, announced as text. */
  readOnly?: boolean;
  disabled?: boolean;
  /** Replaces the star. Anything that reads as a scale, a heart, a flame. */
  symbol?: ReactNode;
  tone?: 'warning' | 'accent' | 'success' | 'danger';
  className?: string;
  /** Form field name, for an uncontrolled submit. */
  name?: string;
}

const symbolSize = { sm: 'size-4', md: 'size-5', lg: 'size-7' } as const;
const gapSize = { sm: 'gap-0.5', md: 'gap-1', lg: 'gap-1.5' } as const;
// The `-fg` end of each ramp, not the base. A base tone is mixed to sit on its
// own tinted background; amber-600 on white measures 2.76:1, and a filled star
// is the one part of this control that has to be readable at a glance.
const toneClass = {
  warning: 'text-warning-fg',
  accent: 'text-accent-fg',
  success: 'text-success-fg',
  danger: 'text-danger-fg',
} as const;

export function Rating({
  value = 0,
  onChange,
  max = 5,
  label,
  valueLabels,
  size = 'md',
  showValue = false,
  clearable = true,
  readOnly = false,
  disabled = false,
  symbol,
  tone = 'warning',
  className,
  name,
}: RatingProps): JSX.Element {
  const groupId = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const interactive = !readOnly && !disabled;
  // While hovering, the stars preview the value under the pointer. The
  // committed value comes back the moment the pointer leaves, a preview that
  // sticks is a value the user did not choose.
  const shown = hovered ?? value;

  const describe = (rating: number): string =>
    valueLabels?.[rating - 1] ?? `${String(rating)} of ${String(max)}`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!interactive) return;
    const keys: Record<string, number> = {
      ArrowRight: Math.min(value + 1, max),
      ArrowUp: Math.min(value + 1, max),
      ArrowLeft: Math.max(value - 1, 0),
      ArrowDown: Math.max(value - 1, 0),
      Home: clearable ? 0 : 1,
      End: max,
    };
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onChange?.(next);
  };

  /* ---------------------------------------------------------------- read */

  if (readOnly) {
    const rounded = Math.round(value * 10) / 10;
    return (
      <div
        // `img` with a label: one announcement of the whole thing, rather than
        // five children a screen reader has to assemble into a number.
        role="img"
        aria-label={`${label}: ${String(rounded)} out of ${String(max)}`}
        className={cn('inline-flex items-center', gapSize[size], className)}
      >
        {Array.from({ length: max }, (_, index) => {
          const fill = Math.max(0, Math.min(1, value - index));
          return (
            <span key={index} aria-hidden className="relative inline-block">
              <span className="text-icon-muted">
                {symbol ?? <Star className={symbolSize[size]} />}
              </span>
              {fill > 0 ? (
                // The partial star is a clipped overlay, not a different
                // glyph. Half-star icons only exist at one fraction, and an
                // average of 4.2 is not a half.
                <span
                  className={cn('absolute inset-0 overflow-hidden', toneClass[tone])}
                  style={{ width: `${String(fill * 100)}%` }}
                >
                  <span className="fill-current">
                    {symbol ?? <Star className={cn(symbolSize[size], 'fill-current')} />}
                  </span>
                </span>
              ) : null}
            </span>
          );
        })}
        {showValue ? (
          <span className="ms-1.5 text-sm tabular-nums text-fg-muted">{rounded}</span>
        ) : null}
      </div>
    );
  }

  /* --------------------------------------------------------------- write */

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <div
        role="radiogroup"
        aria-label={label}
        aria-disabled={disabled || undefined}
        // One tab stop for the group, as the radio pattern requires. Landing
        // on the group with nothing selected still has to be possible, which
        // is why the tabindex is on the container rather than on a child.
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onMouseLeave={() => {
          setHovered(null);
        }}
        className={cn(
          'inline-flex rounded-sm',
          gapSize[size],
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          disabled && 'pointer-events-none opacity-55',
        )}
      >
        {Array.from({ length: max }, (_, index) => {
          const rating = index + 1;
          const active = rating <= shown;
          return (
            <span
              key={rating}
              id={`${groupId}-${String(rating)}`}
              role="radio"
              aria-checked={value === rating}
              aria-label={describe(rating)}
              onClick={() => {
                onChange?.(clearable && value === rating ? 0 : rating);
              }}
              onMouseEnter={() => {
                setHovered(rating);
              }}
              className={cn(
                'cursor-pointer',
                // The tap floor as a pseudo-element: five 20px stars in a row
                // are five targets a thumb cannot separate, and 44px stars
                // would be a different design.
                'relative touch:after:absolute touch:after:inset-y-[-0.6rem] touch:after:inset-x-[-0.15rem] touch:after:content-[""]',
                'transition-[color,transform] duration-(--animate-duration-fast) ease-standard',
                'hover:scale-110 active:scale-95',
                active ? toneClass[tone] : 'text-icon-muted',
              )}
            >
              <span aria-hidden className={active ? 'fill-current' : undefined}>
                {symbol ?? <Star className={cn(symbolSize[size], active && 'fill-current')} />}
              </span>
            </span>
          );
        })}
      </div>

      {showValue ? (
        // Polite, and it carries the *word* where there is one: "3 of 5" tells
        // a reviewer nothing that "Meets expectations" does not tell them
        // better.
        <span aria-live="polite" className="min-w-24 text-sm text-fg-muted">
          {shown === 0 ? 'Not rated' : describe(shown)}
        </span>
      ) : null}

      {name ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
}
