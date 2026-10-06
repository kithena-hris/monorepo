import { CalendarDays } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { useFocusRing } from '../../lib/focus-ring.ts';
import { usePlatform } from '../../provider.tsx';
import { Button } from '../button/button.tsx';
import {
  Calendar,
  formatDate,
  parseDate,
  type CalendarProps,
  type DateRange,
  type IsoDate,
} from '../calendar/calendar.tsx';
import { Dialog, DialogTrigger } from '../dialog/dialog.tsx';
import { Icon } from '../icon/icon.tsx';
import { FieldBox, fieldText, Input, useFieldState } from '../input/input.tsx';
import { Toggle } from '../toggle/toggle.tsx';
import { PickerDialog } from './picker-dialog.tsx';

/**
 * A field that opens a calendar. A single date can always be typed instead,
 * in any shape `parseDate` reads; the calendar button beside it opens the
 * month centred, as iOS's compact picker does. On Android the dialog is
 * Material 3's date picker, the choice a draft until OK.
 */

export type DatePickerPreset = { label: string; range: DateRange };

type DatePickerBaseProps = Omit<CalendarProps, 'selected' | 'onSelect' | 'mode' | 'className'> & {
  /** The control's name, and the picker's title. A `Field`'s label wins. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** `sm` 44pt; `md` and `lg` 56 under a thumb. */
  size?: 'sm' | 'md' | 'lg';
  /** How the field writes a date. `14 Oct 2026` by default. */
  format?: Intl.DateTimeFormatOptions;
  defaultOpen?: boolean;
  /** Draw in the `OverlayHost` of this name instead of the root one. */
  portalHost?: string;
  className?: string | undefined;
};

export type DatePickerProps = DatePickerBaseProps &
  (
    | { mode?: 'single'; value: IsoDate | null; onChange: (value: IsoDate | null) => void }
    | {
        mode: 'range';
        value: DateRange | null;
        onChange: (value: DateRange) => void;
        /** Quick ranges over the grid. */
        presets?: readonly DatePickerPreset[];
      }
  );

export function DatePicker(props: DatePickerProps): React.JSX.Element {
  const {
    label,
    placeholder = props.mode === 'range' ? 'Pick dates' : 'Pick a date',
    disabled: disabledProp,
    invalid: invalidProp,
    size = 'md',
    format,
    defaultOpen = false,
    portalHost,
    className,
    locale,
    month,
    onMonthChange,
    min,
    max,
    isDateDisabled,
    disabledLabel,
    markers,
    weekStartsOn,
    today,
  } = props;
  const state = useFieldState({ invalid: invalidProp, disabled: disabledProp });
  const name = state.name ?? label;
  const android = usePlatform() === 'android';
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<IsoDate | DateRange | null>(null);
  const write = (iso: IsoDate): string => formatDate(iso, locale, format);

  // Only what was given: undefined is not the same as absent to these props.
  const calendarProps = Object.fromEntries(
    Object.entries({
      month,
      onMonthChange,
      min,
      max,
      isDateDisabled,
      disabledLabel,
      markers,
      weekStartsOn,
      today,
      locale,
    }).filter(([, v]) => v !== undefined),
  ) as Omit<CalendarProps, 'mode' | 'selected' | 'onSelect'>;

  if (props.mode === 'range') {
    const range = (open ? (draft as DateRange | null) : null) ?? props.value;
    const shown =
      props.value?.start && props.value.end
        ? `${write(props.value.start)} – ${write(props.value.end)}`
        : '';
    const commit = (next: DateRange): void => {
      if (android) setDraft(next);
      else props.onChange(next);
    };
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next && !state.disabled);
          setDraft(null);
        }}
      >
        <RangeTrigger
          name={name}
          hint={state.hint}
          shown={shown}
          placeholder={placeholder}
          size={size}
          disabled={state.disabled}
          invalid={state.invalid}
          open={open}
          className={className}
        />
        <PickerDialog
          title={name}
          headline={
            range?.start
              ? `${formatDate(range.start, locale, { day: 'numeric', month: 'short' })} – ${
                  range.end
                    ? formatDate(range.end, locale, { day: 'numeric', month: 'short' })
                    : 'End'
                }`
              : 'Start – End'
          }
          portalHost={portalHost}
          onCancel={() => {
            setOpen(false);
            setDraft(null);
          }}
          onConfirm={() => {
            if (android && draft) props.onChange(draft as DateRange);
            setOpen(false);
            setDraft(null);
          }}
        >
          {props.presets?.length ? (
            <View className="flex-row flex-wrap gap-0.5 pb-2">
              {props.presets.map((preset) => (
                <Toggle
                  key={preset.label}
                  variant="ghost"
                  size="sm"
                  pressed={range?.start === preset.range.start && range.end === preset.range.end}
                  onPressedChange={() => {
                    commit(preset.range);
                  }}
                >
                  {preset.label}
                </Toggle>
              ))}
            </View>
          ) : null}
          <Calendar
            {...calendarProps}
            label={name}
            mode="range"
            selected={range}
            onSelect={commit}
          />
        </PickerDialog>
      </Dialog>
    );
  }

  const value = props.value;
  const picked = (open ? (draft as IsoDate | null) : null) ?? value;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next && !state.disabled);
        setDraft(null);
      }}
    >
      <TypedDate
        value={value}
        onChange={props.onChange}
        write={write}
        locale={locale}
        name={name}
        placeholder={placeholder}
        size={size}
        disabled={state.disabled}
        invalid={state.invalid}
        className={className}
      />
      <PickerDialog
        title={name}
        headline={
          picked
            ? formatDate(picked, locale, { weekday: 'short', day: 'numeric', month: 'short' })
            : 'No date'
        }
        portalHost={portalHost}
        onCancel={() => {
          setOpen(false);
          setDraft(null);
        }}
        {...(android
          ? {
              onConfirm: () => {
                if (draft !== null) props.onChange(draft as IsoDate);
                setOpen(false);
                setDraft(null);
              },
            }
          : {})}
      >
        <Calendar
          {...calendarProps}
          label={name}
          selected={picked}
          onSelect={(next) => {
            if (android) {
              setDraft(next);
              return;
            }
            props.onChange(next);
            setOpen(false);
          }}
        />
      </PickerDialog>
    </Dialog>
  );
}

/** A single date, typed, with the calendar a button away. */
function TypedDate({
  value,
  onChange,
  write,
  locale,
  name,
  placeholder,
  size,
  disabled,
  invalid,
  className,
}: {
  value: IsoDate | null;
  onChange: (value: IsoDate | null) => void;
  write: (iso: IsoDate) => string;
  locale: string | undefined;
  name: string;
  placeholder: string;
  size: 'sm' | 'md' | 'lg';
  disabled: boolean;
  invalid: boolean;
  className: string | undefined;
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const unreadable = text !== null && text.trim() !== '' && parseDate(text, locale) === null;
  return (
    <Input
      type="date"
      size={size}
      value={text ?? (value ? write(value) : '')}
      onChange={(next) => {
        setText(next);
        const iso = parseDate(next, locale);
        if (iso) onChange(iso);
        else if (next.trim() === '') onChange(null);
      }}
      onBlur={() => {
        // A date that reads goes back to the locale's own writing of it; one
        // that does not stays as typed, ringed, until it is fixed.
        if (!unreadable) setText(null);
      }}
      placeholder={placeholder}
      accessibilityLabel={name}
      {...(unreadable ? { accessibilityHint: 'Not a date this field can read' } : {})}
      invalid={invalid || unreadable}
      disabled={disabled}
      tight
      containerClassName={className}
      endAdornment={
        <DialogTrigger asChild disabled={disabled}>
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled}
            accessibilityLabel={`Choose ${name.toLowerCase()} from a calendar`}
            startIcon={<Icon icon={CalendarDays} size={19} tone="muted" />}
          />
        </DialogTrigger>
      }
    />
  );
}

/** A range is chosen, not typed: two dates in one field read badly as text. */
function RangeTrigger({
  name,
  hint,
  shown,
  placeholder,
  size,
  disabled,
  invalid,
  open,
  className,
}: {
  name: string;
  hint: string | undefined;
  shown: string;
  placeholder: string;
  size: 'sm' | 'md' | 'lg';
  disabled: boolean;
  invalid: boolean;
  open: boolean;
  className: string | undefined;
}): React.JSX.Element {
  const ring = useFocusRing();
  return (
    <DialogTrigger asChild disabled={disabled}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${shown || 'no dates chosen'}`}
        {...(hint ? { accessibilityHint: hint } : {})}
        accessibilityState={{ disabled }}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onFocus={ring.onFocus}
        onBlur={ring.onBlur}
        className={cn('rounded-[16px] outline-none', className)}
      >
        <FieldBox
          size={size}
          focused={ring.focused || open}
          invalid={invalid}
          disabled={disabled}
          endAdornment={<Icon icon={CalendarDays} size={19} tone="muted" />}
        >
          <CssText
            aria-hidden
            numberOfLines={1}
            className={cn(fieldText, 'tabular-nums', !shown && 'text-fg-subtle')}
          >
            {shown || placeholder}
          </CssText>
        </FieldBox>
      </Pressable>
    </DialogTrigger>
  );
}
