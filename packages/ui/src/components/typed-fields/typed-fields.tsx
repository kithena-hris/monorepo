'use client';

import { useId, useRef, useState, type ComponentPropsWithoutRef, type JSX } from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '../../lib/cn';
import { Input, type InputProps } from '../input/input';

/**
 * The fields whose *behaviour* differs by type, not just their attributes.
 *
 * Everything that is only a matter of the right `inputMode` and
 * `autoComplete`: email, tel, url, date: is already handled by `Input`,
 * which derives them from `type`. These three need code:
 *
 * - a search box has to be clearable, and the clear has to be reachable;
 * - money must never touch a float;
 * - a phone number is two fields that have to travel as one string.
 */

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export interface SearchFieldProps extends Omit<
  InputProps,
  'type' | 'value' | 'onChange' | 'startAdornment' | 'endAdornment'
> {
  value: string;
  onValueChange: (value: string) => void;
  /** Fires on Enter, and when the field is cleared. */
  onSearch?: (value: string) => void;
  /** Accessible name. A magnifier glyph is not one. */
  label?: string;
  /** Hides the leading magnifier where the surrounding UI already says "search". */
  hideIcon?: boolean;
}

/**
 * A search box that can be emptied.
 *
 * `type="search"` gives you the semantics and, in WebKit, a clear button that
 * no keyboard can reach and no screen reader announces. This renders its own:
 * a real `<button>` with a name, which appears only when there is something to
 * clear, a permanent clear button on an empty field is a control that does
 * nothing, and people press it to find out.
 *
 * Focus returns to the input after clearing. Leaving focus on a button that
 * has just removed itself sends it to `<body>`, and the next Tab starts from
 * the top of the page.
 */
export function SearchField({
  value,
  onValueChange,
  onSearch,
  label = 'Search',
  hideIcon = false,
  className,
  ...props
}: SearchFieldProps): JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <Input
      ref={input}
      type="search"
      aria-label={label}
      value={value}
      onChange={(event) => {
        onValueChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSearch?.(value);
        // Escape clears, which is what every search field on the platform does.
        if (event.key === 'Escape' && value !== '') {
          event.preventDefault();
          onValueChange('');
          onSearch?.('');
        }
      }}
      {...(hideIcon ? {} : { startAdornment: <Search aria-hidden /> })}
      endAdornment={
        value === '' ? null : (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => {
              onValueChange('');
              onSearch?.('');
              input.current?.focus();
            }}
            className={cn(
              'flex size-tap items-center justify-center rounded-sm text-fg-subtle',
              'hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            )}
          >
            <X aria-hidden className="size-4" />
          </button>
        )
      }
      className={className}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

export interface CurrencyFieldProps extends Omit<
  InputProps,
  'type' | 'value' | 'onChange' | 'startAdornment' | 'inputMode'
> {
  /**
   * Minor units, as a string: `'142000'` is €1,420.00. Empty string for blank.
   *
   * Not a number, and not a decimal string. `0.1 + 0.2` is `0.30000000000004`,
   * and a payroll system that rounds a cent the wrong way once a fortnight for
   * four thousand people has an audit finding, not a bug.
   */
  value: string;
  onValueChange: (minorUnits: string) => void;
  /** ISO 4217, used for the symbol and the number of decimal places. */
  currency: string;
  /** Overrides the locale used for grouping. Defaults to the reader's. */
  locale?: string;
}

/** How many minor units make one major unit, per ISO 4217. */
function decimalsFor(currency: string, locale: string | undefined): number {
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency });
  // Optional in the DOM types, always present for a currency format. Two is
  // the right guess for the handful a runtime does not know.
  return format.resolvedOptions().maximumFractionDigits ?? 2;
}

function symbolFor(currency: string, locale: string | undefined): string {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? currency;
}

/**
 * Which characters this reader's locale uses to group and to separate.
 *
 * Guessing is not an option: `1,420` is one thousand four hundred and twenty in
 * London and one and forty-two hundredths in Berlin. Treating the comma as a
 * decimal point either way turns a €1,420 salary into €1.42: silently, and in
 * the direction nobody notices until payday.
 */
function separators(locale: string | undefined): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12_345.6);
  return {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
}

/** `'142000'` with 2 decimals → `'1420.00'`, in the reader's own notation. */
function toMajor(minor: string, decimals: number, decimal: string): string {
  if (minor === '') return '';
  const negative = minor.startsWith('-');
  const digits = (negative ? minor.slice(1) : minor).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals) || '0';
  const fraction = decimals === 0 ? '' : `${decimal}${digits.slice(digits.length - decimals)}`;
  return `${negative ? '-' : ''}${whole}${fraction}`;
}

/**
 * `'1,420.5'` with 2 decimals → `'142050'`. Never parses to a float.
 *
 * Group separators are dropped and the locale's decimal separator becomes the
 * point; everything else that is not a digit or a minus goes. Extra decimals
 * are truncated rather than rounded, a field that quietly rounds what you
 * typed is a field that disagrees with the payslip.
 */
function toMinor(
  major: string,
  decimals: number,
  { group, decimal }: { group: string; decimal: string },
): string {
  const withoutGroups = major.split(group).join('');
  const normalised = withoutGroups.split(decimal).join('.');
  const cleaned = normalised.replaceAll(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return '';
  const negative = cleaned.startsWith('-');
  const [whole = '0', fraction = ''] = cleaned.replace('-', '').split('.');
  const padded = fraction.padEnd(decimals, '0').slice(0, decimals);
  const digits = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${digits}`;
}

/**
 * Money, in minor units, never as a float.
 *
 * The field shows major units because that is what people type; the value it
 * reports is minor units as a string, because that is what may be stored. The
 * conversion is string arithmetic on both sides, the number `14.20` cannot be
 * represented exactly in binary and no amount of rounding at the edges fixes
 * that.
 *
 * `inputMode="decimal"` rather than `type="number"`: a number input rejects
 * grouping separators as you type, and its spinner turns a salary into a
 * scroll target.
 */
export function CurrencyField({
  value,
  onValueChange,
  currency,
  locale,
  className,
  ...props
}: CurrencyFieldProps): JSX.Element {
  const decimals = decimalsFor(currency, locale);
  const marks = separators(locale);
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <Input
      // Text, not number: a `type="number"` field rejects the grouping
      // separators people paste in, and offers a spinner nobody wants on a
      // salary. `inputMode="decimal"` still gets the right keypad.
      type="text"
      inputMode="decimal"
      autoComplete="off"
      startAdornment={<span className="text-xs">{symbolFor(currency, locale)}</span>}
      // While it has focus the field shows exactly what was typed. Reformatting
      // mid-entry moves the caret, and a caret that jumps as you type a salary
      // is how people end up entering it twice.
      value={draft ?? toMajor(value, decimals, marks.decimal)}
      onChange={(event) => {
        setDraft(event.target.value);
        onValueChange(toMinor(event.target.value, decimals, marks));
      }}
      onBlur={(event) => {
        setDraft(null);
        props.onBlur?.(event);
      }}
      className={cn('tabular-nums', className)}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Phone                                                                       */
/* -------------------------------------------------------------------------- */

export interface DialCode {
  /** ISO 3166-1 alpha-2, used as the option's value and for the flag-free label. */
  country: string;
  /** Including the `+`. */
  code: string;
  label: string;
}

/** A starting set. Pass your own for anything beyond a first release. */
export const commonDialCodes: DialCode[] = [
  { country: 'GB', code: '+44', label: 'United Kingdom' },
  { country: 'IE', code: '+353', label: 'Ireland' },
  { country: 'DE', code: '+49', label: 'Germany' },
  { country: 'FR', code: '+33', label: 'France' },
  { country: 'ES', code: '+34', label: 'Spain' },
  { country: 'NL', code: '+31', label: 'Netherlands' },
  { country: 'PL', code: '+48', label: 'Poland' },
  { country: 'US', code: '+1', label: 'United States' },
  { country: 'CA', code: '+1', label: 'Canada' },
  { country: 'IN', code: '+91', label: 'India' },
  { country: 'AU', code: '+61', label: 'Australia' },
  { country: 'NG', code: '+234', label: 'Nigeria' },
  { country: 'ZA', code: '+27', label: 'South Africa' },
  { country: 'BR', code: '+55', label: 'Brazil' },
  { country: 'JP', code: '+81', label: 'Japan' },
  { country: 'SG', code: '+65', label: 'Singapore' },
];

export interface PhoneFieldProps extends Omit<
  ComponentPropsWithoutRef<'input'>,
  'type' | 'value' | 'onChange' | 'size' | 'prefix'
> {
  /** The whole number, dial code included: `'+44 7700 900123'`. */
  value: string;
  onValueChange: (value: string) => void;
  /** Which dial code is selected. Uncontrolled when omitted. */
  dialCode?: string;
  onDialCodeChange?: (dialCode: string) => void;
  defaultDialCode?: string;
  dialCodes?: readonly DialCode[];
  size?: InputProps['size'];
  /** Accessible name for the number itself. */
  label?: string;
  className?: string;
  containerClassName?: string;
}

/**
 * A phone number: a dial code and a national number that travel as one string.
 *
 * ### The dial code is a native `<select>`
 *
 * Deliberately. On a phone it opens the platform picker, which is scrollable
 * with a thumb, searchable by keyboard on a desktop, and translated by the OS.
 * A custom listbox of two hundred countries is a worse version of a control
 * every device already ships.
 *
 * ### It does not validate
 *
 * Numbering plans differ by country and change; a regex that "validates" a
 * phone number rejects real ones. `inputMode="tel"` gets the right keypad, the
 * field accepts what people type, and anything stricter belongs on the server
 * with a library that tracks the plans.
 */
export function PhoneField({
  value,
  onValueChange,
  dialCode,
  onDialCodeChange,
  defaultDialCode = '+44',
  dialCodes = commonDialCodes,
  size = 'md',
  label = 'Phone number',
  className,
  containerClassName,
  ...props
}: PhoneFieldProps): JSX.Element {
  const [ownCode, setOwnCode] = useState(defaultDialCode);
  const selectId = useId();
  const active = dialCode ?? ownCode;

  const national = value.startsWith(active) ? value.slice(active.length).trimStart() : value;

  const setCode = (next: string): void => {
    if (dialCode === undefined) setOwnCode(next);
    onDialCodeChange?.(next);
    onValueChange(`${next} ${national}`.trim());
  };

  return (
    <Input
      type="tel"
      aria-label={label}
      size={size}
      value={national}
      onChange={(event) => {
        onValueChange(`${active} ${event.target.value}`.trim());
      }}
      {...(containerClassName === undefined ? {} : { containerClassName })}
      className={cn('tabular-nums', className)}
      startAdornment={
        <>
          <label htmlFor={selectId} className="sr-only">
            Country dialling code
          </label>
          <select
            id={selectId}
            value={active}
            onChange={(event) => {
              setCode(event.target.value);
            }}
            className={cn(
              'min-h-tap cursor-pointer rounded-sm bg-transparent py-0 pe-1 text-xs tabular-nums text-fg',
              'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            )}
          >
            {dialCodes.map((entry) => (
              <option key={`${entry.country}-${entry.code}`} value={entry.code}>
                {entry.country} {entry.code}
              </option>
            ))}
          </select>
          <span aria-hidden className="text-fg-subtle">
            |
          </span>
        </>
      }
      {...props}
    />
  );
}
