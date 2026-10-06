import { ChevronDown, CircleX, Search } from 'lucide-react-native';
import { useRef, useState } from 'react';
import type { TextInput as RNTextInput } from 'react-native';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';
import { Input, type InputProps } from '../input/input.tsx';
import { RadioGroup, RadioGroupItem } from '../radio-group/radio-group.tsx';
import { decimalsFor, formatMinor, parseMinor, symbolFor } from './money.ts';

export { formatMinor, parseMinor } from './money.ts';

/*
 * The fields whose behaviour differs by type, not only their keyboard. Email,
 * URL, phone, IBAN, postcode, date, time and duration are `Input` with a
 * `type`, which brings the keyboard and autofill. These three need code: a
 * search box that empties, money that never touches a float, and a phone
 * number that is two fields travelling as one string.
 */

/* ----------------------------------------------------------------- search */

export type SearchFieldProps = Omit<
  InputProps,
  'type' | 'value' | 'onChange' | 'onChangeText' | 'startAdornment' | 'endAdornment' | 'tight'
> & {
  value: string;
  onValueChange: (value: string) => void;
  /** On the keyboard's search key, and when the field is cleared. */
  onSearch?: (value: string) => void;
  /** The name a screen reader hears. A magnifier is not one. */
  label?: string;
  /** Where the surrounding screen already says "search". */
  hideIcon?: boolean;
};

/**
 * A search box that can be emptied. The clear button appears only when there
 * is something to clear, and focus goes back to the field after it, so the
 * next thing typed is the next search.
 */
export function SearchField({
  value,
  onValueChange,
  onSearch,
  label = 'Search',
  hideIcon = false,
  ...props
}: SearchFieldProps): React.JSX.Element {
  const input = useRef<RNTextInput>(null);
  return (
    <Input
      ref={input}
      type="search"
      value={value}
      onChange={onValueChange}
      accessibilityLabel={label}
      onSubmitEditing={() => onSearch?.(value)}
      startAdornment={hideIcon ? undefined : <Icon icon={Search} size={19} tone="muted" />}
      tight={value !== ''}
      endAdornment={
        value === '' ? undefined : (
          <Button
            variant="ghost"
            size="xs"
            startIcon={<Icon icon={CircleX} size={18} tone="subtle" />}
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            onPress={() => {
              onValueChange('');
              onSearch?.('');
              input.current?.focus();
            }}
          />
        )
      }
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ money */

const MINUS = '−';

export type CurrencyFieldProps = Omit<
  InputProps,
  'type' | 'value' | 'onChange' | 'onChangeText' | 'startAdornment' | 'endAdornment'
> & {
  /**
   * Minor units as a string: `'124050'` is €1,240.50; `''` is blank. Never a
   * number: 0.1 + 0.2 is not 0.3, and a payslip notices.
   */
  value: string;
  onValueChange: (minorUnits: string) => void;
  /** ISO 4217: the symbol and how many decimals. */
  currency: string;
  /** Offer these instead: the code after the amount opens a list of them. */
  currencies?: readonly string[];
  onCurrencyChange?: (currency: string) => void;
  /** Grouping and the decimal mark. The device's by default. */
  locale?: string;
};

/**
 * Money, typed in major units on the decimal pad and reported in minor units.
 * A negative amount is shown with a true minus sign, before the symbol.
 */
export function CurrencyField({
  value,
  onValueChange,
  currency,
  currencies,
  onCurrencyChange,
  locale,
  onBlur,
  ...props
}: CurrencyFieldProps): React.JSX.Element {
  const decimals = decimalsFor(currency, locale);
  const [draft, setDraft] = useState<string | null>(null);
  const negative = value.startsWith('-');
  const symbol = `${negative ? MINUS : ''}${symbolFor(currency, locale)}`;
  return (
    <Input
      type="decimal"
      value={draft ?? formatMinor(value, decimals, locale)}
      onChange={(text) => {
        setDraft(text);
        onValueChange(parseMinor(text, decimals, locale));
      }}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
      className="tabular-nums"
      startAdornment={symbol}
      tight={Boolean(currencies)}
      endAdornment={
        currencies && onCurrencyChange ? (
          <ChoiceButton
            label="Currency"
            value={currency}
            options={currencies.map((code) => ({ value: code, label: code }))}
            onChange={onCurrencyChange}
            className="text-[13px] font-semibold text-fg-muted"
          />
        ) : undefined
      }
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ phone */

export type DialCode = { country: string; code: string; label: string };

export const commonDialCodes: readonly DialCode[] = [
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

/** The flag, from the two regional-indicator letters of an ISO country code. */
function flagOf(country: string): string {
  const code = country.toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(0x1f1a5 + code.charCodeAt(0), 0x1f1a5 + code.charCodeAt(1));
}

export type PhoneFieldProps = Omit<
  InputProps,
  'type' | 'value' | 'onChange' | 'onChangeText' | 'startAdornment'
> & {
  /** The national number as typed, without the dial code. */
  value: string;
  onValueChange: (value: string) => void;
  /** The selected country, ISO 3166 alpha-2: two countries share +1. */
  country: string;
  onCountryChange: (country: string) => void;
  dialCodes?: readonly DialCode[];
};

/**
 * A phone number: a country's dial code and the number, on the phone pad. The
 * dial code opens a centred list. It does not validate: numbering plans change
 * and a regex rejects real numbers, so a check belongs with the server.
 */
export function PhoneField({
  value,
  onValueChange,
  country,
  onCountryChange,
  dialCodes = commonDialCodes,
  ...props
}: PhoneFieldProps): React.JSX.Element {
  const selected = dialCodes.find((d) => d.country === country) ?? dialCodes[0];
  return (
    <Input
      type="tel"
      value={value}
      onChange={onValueChange}
      startAdornment={
        <ChoiceButton
          label="Country code"
          value={selected?.country ?? country}
          options={dialCodes.map((d) => ({
            value: d.country,
            label: `${flagOf(d.country)}  ${d.label} ${d.code}`,
          }))}
          onChange={onCountryChange}
          display={selected ? `${flagOf(selected.country)} ${selected.code}` : country}
          spokenValue={selected ? `${selected.label} ${selected.code}` : country}
          className="text-[17px] font-medium text-fg"
          divided
        />
      }
      {...props}
    />
  );
}

/* ----------------------------------------------------------- the picker */

type Option = { value: string; label: string };

/**
 * A value inside a field that opens a centred list of the others: a currency's
 * code, a country's dial code, a time zone. For a field's adornment.
 */
export function ChoiceButton({
  label,
  value,
  options,
  onChange,
  display,
  spokenValue,
  className,
  divided = false,
}: {
  label: string;
  value: string;
  options: readonly Option[];
  onChange: (value: string) => void;
  display?: string;
  spokenValue?: string;
  className: string;
  divided?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${spokenValue ?? value}`}
        hitSlop={{ top: 12, bottom: 12 }}
        onPress={() => {
          setOpen(true);
        }}
        className={cn(
          'flex-row items-center gap-1.5 self-stretch',
          divided && 'border-r border-border-strong pr-2.5',
        )}
      >
        <CssText className={className}>{display ?? value}</CssText>
        <Icon icon={ChevronDown} size={13} tone="muted" />
      </Pressable>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <View className="max-h-[360px]">
            <RadioGroup
              value={value}
              onValueChange={(next) => {
                onChange(next);
                setOpen(false);
              }}
              accessibilityLabel={label}
            >
              {options.map((option) => (
                <RadioGroupItem key={option.value} value={option.value}>
                  {option.label}
                </RadioGroupItem>
              ))}
            </RadioGroup>
          </View>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
