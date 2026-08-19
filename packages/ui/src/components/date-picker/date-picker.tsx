'use client';

import { CalendarDays } from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import {
  Calendar,
  formatIsoDate,
  parseIsoDate,
  type CalendarProps,
  type DateRange,
  type IsoDate,
} from '../calendar/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';

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

const sizeClass = {
  sm: 'h-control-sm text-xs px-2.5',
  md: 'h-control-md text-base px-3',
  lg: 'h-control-lg text-md px-3.5',
} as const;

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
    { label: 'This month', range: { start: formatIsoDate(Date.UTC(year, month, 1)), end: today } },
    {
      label: 'Last month',
      range: {
        start: formatIsoDate(Date.UTC(year, month - 1, 1)),
        end: endOfMonth(year, month - 1),
      },
    },
    {
      label: 'This quarter',
      range: { start: formatIsoDate(Date.UTC(year, quarter * 3, 1)), end: today },
    },
    {
      label: 'Year to date',
      range: { start: formatIsoDate(Date.UTC(year, 0, 1)), end: today },
    },
  ];
}

export function DatePicker(props: DatePickerProps): JSX.Element {
  // `mode`, `value`, `onChange` and `presets` stay on `props`: destructuring
  // them apart is what loses the relationship the union encodes.
  const {
    label,
    placeholder = 'Pick a date',
    disabled = false,
    size = 'md',
    className,
    locale = 'en-GB',
    /*
     * Discarded, not unused: this destructure exists to keep the three
     * discriminated props out of `calendarProps`, which is spread onto
     * `Calendar`. The lint preset has no discard convention, so the rule is
     * turned off for the three lines that are one.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    mode: _mode,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    value: _value,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    onChange: _onChange,
    ...calendarProps
  } = props;
  const mode = props.mode ?? 'single';
  const presets = props.mode === 'range' ? props.presets : undefined;
  const [open, setOpen] = useState(false);

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
    return `${format(range.start)} – ${format(range.end)}`;
  })();

  const empty = props.mode === 'range' ? !props.value?.start : !props.value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border border-border bg-surface text-left text-fg',
          'transition-colors duration-(--animate-duration-fast) hover:border-border-strong',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          'disabled:pointer-events-none disabled:opacity-55',
          sizeClass[size],
          className,
        )}
      >
        <CalendarDays className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        <span className={cn('min-w-0 flex-1 truncate', empty && 'text-fg-subtle')}>{display}</span>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          {presets && mode === 'range' ? (
            <div className="flex gap-1.5 sm:w-32 sm:flex-col max-sm:flex-wrap max-sm:order-last">
              {presets.map((preset) => (
                <Button
                  key={preset.label}
                  size="sm"
                  variant="ghost"
                  className="sm:justify-start"
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
      </PopoverContent>
    </Popover>
  );
}
