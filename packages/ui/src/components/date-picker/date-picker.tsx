'use client';

import { CalendarDays } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Field, FieldControl, FieldError, FieldLabel } from '../field/field';
import { fieldShell, floatShell, floatValue } from '../field/field-styles';
import { Input } from '../input/input';
import {
  Calendar,
  formatIsoDate,
  parseIsoDate,
  parseTypedDate,
  type CalendarProps,
  type DateRange,
  type IsoDate,
} from '../calendar/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';
import { t } from '../../lib/i18n';

/**
 * A calendar behind a trigger, for a form field.
 *
 * The presets are not padding. "This month" and "Last quarter" are what a
 * person filtering a payroll register actually wants, and every one of them
 * saved is two months of paging on a phone.
 *
 * ### This replaces `<input type="date">` everywhere in the system
 *
 * The native control is a different widget in every browser, a wheel on iOS,
 * a grid in Chrome, a bare text box in Firefox, which is exactly the thing
 * a design system exists to stop. It also cannot mark a day (a public holiday,
 * a colleague already away), cannot express a range as one decision, and
 * hands back a value in the browser's locale rather than an ISO string.
 *
 * The trade is real and worth naming: on a phone, for one unconstrained date
 * with nothing to mark, iOS's wheel genuinely beats any grid. It is not worth
 * three different pickers across one product, so the system takes the
 * consistent one and makes the grid good on touch instead.
 */

export type DatePickerPreset = { label: string; range: DateRange };

/** The parts of a date picker that do not depend on what a selection is. */
interface DatePickerBaseProps extends Omit<
  CalendarProps,
  'selected' | 'onSelect' | 'mode' | 'className'
> {
  /** Accessible name and the label the trigger falls back to. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /**
   * Open as it mounts: for a picker that stands in for a lighter control
   * until it is pressed (a cell in a long grid).
   */
  defaultOpen?: boolean;
  /**
   * Set by `FieldControl`, so a `Field`'s label, description and error reach
   * the trigger as they reach an `Input`. Not for use on their own.
   */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

/**
 * Discriminated on `mode`, for the same reason `CalendarProps` is: the mode
 * decides what `value` holds and what `onChange` reports, so leaving them
 * independent lets a single-date picker be handed a range and forces the
 * component to assert its way back out.
 *
 * `presets` moves inside the range branch. They were documented as "only
 * meaningful in range mode" and then accepted in both, which is a comment doing
 * a type's job, the picker now refuses them on a single-date instance.
 */
export type DatePickerProps = DatePickerBaseProps &
  (
    | {
        mode?: 'single';
        value: IsoDate | null;
        onChange: (value: IsoDate | null) => void;
      }
    | {
        mode: 'range';
        value: DateRange | null;
        onChange: (value: DateRange) => void;
        /** Quick ranges, shown beside the grid. */
        presets?: readonly DatePickerPreset[];
      }
  );

/** Day 0 of the next month is the last day of this one. */
const endOfMonth = (year: number, month: number): IsoDate =>
  formatIsoDate(Date.UTC(year, month + 1, 0));

/** Sensible defaults, computed from an injected "today" rather than the clock. */
export function defaultPresets(today: IsoDate): readonly DatePickerPreset[] {
  const now = new Date(parseIsoDate(today));
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const quarter = Math.floor(month / 3);
  return [
    {
      label: t('components.date-picker.date-picker.this_month', 'This month'),
      range: { start: formatIsoDate(Date.UTC(year, month, 1)), end: today },
    },
    {
      label: t('components.date-picker.date-picker.last_month', 'Last month'),
      range: {
        start: formatIsoDate(Date.UTC(year, month - 1, 1)),
        end: endOfMonth(year, month - 1),
      },
    },
    {
      label: t('components.date-picker.date-picker.this_quarter', 'This quarter'),
      range: { start: formatIsoDate(Date.UTC(year, quarter * 3, 1)), end: today },
    },
    {
      label: t('components.date-picker.date-picker.year_to_date', 'Year to date'),
      range: { start: formatIsoDate(Date.UTC(year, 0, 1)), end: today },
    },
  ];
}

export function DatePicker(props: DatePickerProps): JSX.Element {
  // `mode`, `value`, `onChange` and `presets` stay on `props`: destructuring
  // them apart is what loses the relationship the union encodes.
  const {
    label,
    placeholder = t('components.date-picker.date-picker.pick_a_date', 'Pick a date'),
    disabled = false,
    size = 'md',
    className,
    defaultOpen = false,
    locale = 'en-GB',
    id,
    'aria-describedby': describedBy,
    'aria-invalid': invalid,
    // Discarded, not unused: this destructure keeps the three discriminated
    // props out of `calendarProps`, which is spread onto `Calendar`.
    mode: _mode,
    value: _value,
    onChange: _onChange,
    ...calendarProps
  } = props;
  const mode = props.mode ?? 'single';
  const presets = props.mode === 'range' ? props.presets : undefined;
  const [open, setOpenState] = useState(defaultOpen);
  // The month on show once typing or Today moved it; the calendar's own until then.
  const [shown, setShown] = useState<IsoDate | undefined>(undefined);
  const [typed, setTyped] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    if (!next) {
      // Opened again, it starts from what is chosen, not where it was left.
      setShown(undefined);
      setTyped('');
      setProblem(null);
    }
  };
  const today = calendarProps.today ?? formatIsoDate(Date.now());
  const allowed = (iso: IsoDate): boolean =>
    (calendarProps.min === undefined || iso >= calendarProps.min) &&
    (calendarProps.max === undefined || iso <= calendarProps.max) &&
    !(calendarProps.isDateDisabled?.(iso) ?? false);
  /** A typed date: chosen at once, or for a range its next end; the grid moves to it either way. */
  const commitTyped = (): void => {
    if (typed.trim() === '') return;
    const iso = parseTypedDate(typed, locale);
    if (iso === null) {
      setProblem(
        t('components.date-picker.date-picker.type_a_date_like', 'Type a date like {{value}}', {
          value: locale.toLowerCase() === 'en-us' ? '03/14/1996' : '14/03/1996',
        }),
      );
      return;
    }
    if (!allowed(iso)) {
      setProblem(
        t(
          'components.date-picker.date-picker.cant_be_chosen_here',
          '{{format}} can’t be chosen here',
          { format: format(iso) },
        ),
      );
      setShown(iso);
      return;
    }
    setProblem(null);
    setTyped('');
    setShown(iso);
    if (props.mode !== 'range') {
      props.onChange(iso);
      setOpen(false);
      return;
    }
    const range = props.value;
    if (!range?.start || range.end) {
      props.onChange({ start: iso, end: null });
      return;
    }
    props.onChange(
      iso < range.start ? { start: iso, end: range.start } : { start: range.start, end: iso },
    );
    setOpen(false);
  };
  const month = calendarProps.month ?? shown;
  const onMonthChange = (next: IsoDate): void => {
    setShown(next);
    calendarProps.onMonthChange?.(next);
  };

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [locale],
  );

  const format = (iso: IsoDate): string => formatter.format(new Date(parseIsoDate(iso)));

  const display = ((): string => {
    if (props.mode !== 'range') return props.value ? format(props.value) : placeholder;
    const range = props.value;
    if (!range?.start) return placeholder;
    if (!range.end) return `${format(range.start)} – …`;
    return t('components.date-picker.date-picker.text', '{{format}} – {{format2}}', {
      format: format(range.start),
      format2: format(range.end),
    });
  })();

  const empty = props.mode === 'range' ? !props.value?.start : !props.value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        // The label, then what the trigger shows: a name that holds the visible
        // text is one a voice user can say (WCAG 2.5.3, Label in Name).
        aria-label={t('components.date-picker.date-picker.text_2', '{{label}}: {{display}}', {
          label,
          display,
        })}
        aria-describedby={describedBy}
        // The icon trails, as on every field, so under a thumb the label can
        // float inside the trigger where the value starts.
        data-float={size === 'sm' ? undefined : ''}
        data-invalid={invalid || undefined}
        className={cn(
          fieldShell({ size }),
          size !== 'sm' && floatShell,
          'cursor-pointer text-start focus-visible:outline-none',
          'data-[state=open]:bg-surface data-[state=open]:ring-2 data-[state=open]:ring-accent data-[state=open]:ring-inset',
          className,
        )}
      >
        <span className={cn('flex min-w-0 flex-1 items-center self-stretch', floatValue)}>
          <span className={cn('truncate tabular-nums', empty && 'text-fg-subtle')}>{display}</span>
        </span>
        <CalendarDays className="size-[1.125rem] shrink-0 text-fg-muted" aria-hidden />
      </PopoverTrigger>

      <PopoverContent aria-label={label} className="w-auto p-3 touch:p-4">
        {/* Typed, a date decades away is one line; the grid follows it. */}
        <Field invalid={problem !== null} className="mb-3">
          <FieldLabel className="sr-only">
            {t('components.date-picker.date-picker.type', 'Type {{label}}', {
              label: label.toLowerCase(),
            })}
          </FieldLabel>
          <FieldControl>
            <Input
              size="sm"
              value={typed}
              placeholder={
                props.mode === 'range' && props.value?.start && !props.value.end
                  ? t('components.date-picker.date-picker.type_the_end_date', 'Type the end date')
                  : t(
                      'components.date-picker.date-picker.type_a_date_like_2',
                      'Type a date, like {{value}}',
                      { value: locale.toLowerCase() === 'en-us' ? '03/14/1996' : '14/03/1996' },
                    )
              }
              inputMode="text"
              autoComplete="off"
              onChange={(e) => {
                setTyped(e.target.value);
                if (problem !== null) setProblem(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTyped();
                }
              }}
              onBlur={commitTyped}
            />
          </FieldControl>
          <FieldError>{problem}</FieldError>
        </Field>
        {/* Presets sit beside the grid at a desk and under it on a phone,
            where the grid already takes the width. */}
        <div className="flex gap-3 touch:flex-col">
          {presets && mode === 'range' ? (
            <div className="flex w-32 flex-col gap-1 touch:order-last touch:w-auto touch:flex-row touch:flex-wrap">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => {
                    // Presets only exist on the range branch, so this narrows
                    // rather than asserting `onChange` accepts a range.
                    if (props.mode === 'range') props.onChange(preset.range);
                    setOpen(false);
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          ) : null}

          {/*
            The two modes are rendered separately rather than through one
            element with a computed `mode`. `Calendar`'s props are a union, and
            its `onSelect` has a different parameter type in each branch, so a
            single shared handler could only satisfy both by asserting, which is
            the thing being removed. Written out, each handler is checked
            against the mode it actually belongs to.
          */}
          {props.mode === 'range' ? (
            <Calendar
              {...calendarProps}
              {...(month === undefined ? {} : { month })}
              onMonthChange={onMonthChange}
              locale={locale}
              label={label}
              mode="range"
              selected={props.value}
              onSelect={(next) => {
                props.onChange(next);
                // A range is not a complete answer until the second click, so
                // the panel stays open until there is an end.
                if (next.end) setOpen(false);
              }}
            />
          ) : (
            <Calendar
              {...calendarProps}
              {...(month === undefined ? {} : { month })}
              onMonthChange={onMonthChange}
              locale={locale}
              label={label}
              mode="single"
              selected={props.value}
              onSelect={(next) => {
                props.onChange(next);
                // A single date is a complete answer.
                setOpen(false);
              }}
            />
          )}
        </div>
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setShown(today);
            }}
          >
            {t('components.date-picker.date-picker.go_to_today', 'Go to today')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
