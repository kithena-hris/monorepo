'use client';

import { Check, Clock } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { useCoarsePointer } from '../../lib/use-media-query';
import { fieldShell, fieldShellHas, floatShell, floatValue } from '../field/field-styles';
import { Popover, PopoverAnchor, PopoverContent } from '../popover/popover';

/**
 * A time of day, stored as 24-hour `HH:MM` whatever the locale shows.
 *
 * At a desk it is a text field you can type into ("930", "9:30 pm", "21.30"
 * all land on `21:30`) with a list of slots at `step` minutes: the WAI-ARIA
 * editable combobox. The input keeps DOM focus throughout, and the highlighted
 * slot is pointed at by `aria-activedescendant`, so typing never stops.
 *
 * Under a thumb it is the platform's own `<input type="time">`, which is the
 * system wheel on iOS and the clock dial on Android. Both beat anything drawn
 * here, and both still take a hardware keyboard.
 *
 * The value is a time without a date or a zone. A meeting that happens in a
 * zone carries the zone beside it (`endAdornment`), and the conversion belongs
 * to whoever knows the date.
 */

const MINUTES_PER_DAY = 24 * 60;

const pad = (n: number): string => String(n).padStart(2, '0');

const toMinutes = (value: string): number =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

const fromMinutes = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Reads what people actually type. Returns `HH:MM`, or `null` for anything
 * that is not unambiguously one time of day: a guess that lands on the wrong
 * hour is worse than a field that refuses.
 */
export function parseTime(text: string): string | null {
  const compact = text.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d{1,4})(?:[:.h](\d{2}))?(am|pm|a|p)?$/.exec(compact);
  if (!match) return null;
  const [, head = '', tail, meridiem] = match;

  let hours: number;
  let minutes: number;
  if (tail !== undefined) {
    if (head.length > 2) return null;
    hours = Number(head);
    minutes = Number(tail);
  } else if (head.length <= 2) {
    hours = Number(head);
    minutes = 0;
  } else {
    // "930" and "0930": the last two digits are the minutes.
    hours = Number(head.slice(0, -2));
    minutes = Number(head.slice(-2));
  }

  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem.startsWith('p') ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return `${pad(hours)}:${pad(minutes)}`;
}

/** `HH:MM` as the locale writes it: `09:30` in Berlin, `9:30 AM` in Boston. */
export function formatTime(value: string, locale?: string): string {
  const minutes = toMinutes(value);
  const options = { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' } as const;
  // A 24-hour clock pads the hour ("09:30"); a 12-hour one does not ("9:30 AM").
  const twelve = new Intl.DateTimeFormat(locale, options).resolvedOptions().hour12 === true;
  return new Intl.DateTimeFormat(locale, twelve ? options : { ...options, hour: '2-digit' }).format(
    new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60)),
  );
}

/** Every `step` minutes from midnight, kept to `[min, max]` inclusive. */
export function timeSlots(step: number, min = '00:00', max = '23:59'): string[] {
  const low = toMinutes(min);
  const high = toMinutes(max);
  const slots: string[] = [];
  for (let minutes = 0; minutes < MINUTES_PER_DAY; minutes += step) {
    if (minutes >= low && minutes <= high) slots.push(fromMinutes(minutes));
  }
  return slots;
}

export interface TimePickerProps {
  /** `HH:MM`, 24-hour, or `null` for no time. */
  value: string | null;
  onChange: (value: string | null) => void;
  /** Accessible name. A visible label comes from the surrounding `Field`. */
  label: string;
  /** Minutes between the slots offered, and the native input's step. */
  step?: number;
  /** Earliest and latest `HH:MM` offered, inclusive. */
  min?: string;
  max?: string;
  /** How the value is shown. The stored value is always `HH:MM`. */
  locale?: string;
  placeholder?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** Trailing content in place of the clock, such as a zone. */
  endAdornment?: ReactNode;
  className?: string;
  /** Set by `FieldControl`. Not for use on their own. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function TimePicker({
  value,
  onChange,
  label,
  step = 30,
  min,
  max,
  locale,
  placeholder = '--:--',
  size = 'md',
  disabled = false,
  endAdornment,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: TimePickerProps): JSX.Element {
  const coarse = useCoarsePointer();
  const listId = useId();
  const optionId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  const slots = useMemo(() => timeSlots(step, min, max), [step, min, max]);
  const float = size !== 'sm';
  const shell = cn(
    fieldShell({ size }),
    fieldShellHas,
    float && floatShell,
    'cursor-text',
    className,
  );
  const clock = endAdornment ?? (
    <Clock aria-hidden className="size-[1.125rem] shrink-0 text-fg-muted" />
  );

  // The slot nearest the value, or the first one after it: opening the list
  // on 09:10 highlights 09:30 rather than midnight.
  const nearest = (time: string | null): number => {
    if (time === null) return 0;
    const index = slots.findIndex((slot) => slot >= time);
    return index === -1 ? slots.length - 1 : index;
  };

  if (coarse) {
    return (
      <div data-float={float ? '' : undefined} className={shell}>
        <input
          id={id}
          type="time"
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          step={step * 60}
          min={min}
          max={max}
          disabled={disabled}
          value={value ?? ''}
          onChange={(event) => {
            onChange(event.target.value === '' ? null : event.target.value.slice(0, 5));
          }}
          className={cn(
            'min-w-0 flex-1 self-stretch bg-transparent text-start tabular-nums text-fg outline-none',
            float && floatValue,
          )}
        />
        {clock}
      </div>
    );
  }

  const commitText = (): void => {
    if (draft === null) return;
    if (draft.trim() === '') onChange(null);
    else {
      const parsed = parseTime(draft);
      // Unreadable text is put back rather than kept: a field that shows
      // "later" while holding 09:00 is lying about its value.
      if (parsed !== null) onChange(parsed);
    }
    setDraft(null);
  };

  const choose = (slot: string): void => {
    onChange(slot);
    setDraft(null);
    setOpen(false);
  };

  const openList = (): void => {
    const typed = draft === null ? value : parseTime(draft);
    setActive(nearest(typed));
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!open) {
          openList();
          return;
        }
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) => Math.min(Math.max(current + delta, 0), slots.length - 1));
        return;
      }
      case 'Home':
      case 'End':
        if (!open) return;
        event.preventDefault();
        setActive(event.key === 'Home' ? 0 : slots.length - 1);
        return;
      case 'Enter': {
        if (open) {
          event.preventDefault();
          const slot = slots[active];
          if (slot !== undefined) choose(slot);
          return;
        }
        commitText();
        return;
      }
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        } else {
          setDraft(null);
        }
        return;
      default:
    }
  };

  const shown = draft ?? (value === null ? '' : formatTime(value, locale));

  return (
    // The list hangs under the input being typed in; a sheet would trap focus
    // away from it.
    <Popover open={open} onOpenChange={setOpen} sheetOnTouch={false}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          data-float={float ? '' : undefined}
          data-disabled={disabled || undefined}
          className={shell}
        >
          <input
            id={id}
            type="text"
            role="combobox"
            aria-label={label}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="none"
            aria-activedescendant={open ? `${optionId}-${String(active)}` : undefined}
            autoComplete="off"
            inputMode="numeric"
            spellCheck={false}
            disabled={disabled}
            placeholder={placeholder}
            value={shown}
            onChange={(event) => {
              setDraft(event.target.value);
              const parsed = parseTime(event.target.value);
              if (parsed !== null) setActive(nearest(parsed));
            }}
            onKeyDown={onKeyDown}
            // A click in the field offers the list, as the arrow key does.
            onClick={() => {
              if (!open) openList();
            }}
            onBlur={commitText}
            className={cn(
              'peer min-w-0 flex-1 self-stretch bg-transparent tabular-nums text-fg outline-none',
              'placeholder:text-fg-subtle',
              float && floatValue,
            )}
          />
          {endAdornment ?? (
            <button
              type="button"
              // Out of the tab order: the arrow keys already open the list
              // from the field, and one stop per field is the contract.
              tabIndex={-1}
              aria-label={`Show times for ${label}`}
              disabled={disabled}
              onMouseDown={(event) => {
                // Keeps focus, and the draft, in the input.
                event.preventDefault();
              }}
              onClick={() => {
                if (open) setOpen(false);
                else openList();
              }}
              className="-me-1 grid size-8 shrink-0 place-items-center rounded-full text-fg-muted hover:bg-surface-active hover:text-fg"
            >
              <Clock aria-hidden className="size-[1.125rem]" />
            </button>
          )}
        </div>
      </PopoverAnchor>

      <PopoverContent
        matchTriggerWidth
        className="max-h-64 p-1.5"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          // A click back into the field is not a click away from it.
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <ul id={listId} role="listbox" aria-label={label}>
          {slots.map((slot, index) => {
            const selected = slot === value;
            return (
              <li
                key={slot}
                id={`${optionId}-${String(index)}`}
                // The highlighted slot keeps itself in view. A ref rather than
                // an effect: the list is portalled, and is not in the document
                // yet when an effect on the opening render runs.
                ref={
                  index === active
                    ? (node) => {
                        node?.scrollIntoView({ block: 'nearest' });
                      }
                    : undefined
                }
                role="option"
                aria-selected={selected}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  choose(slot);
                }}
                onMouseEnter={() => {
                  setActive(index);
                }}
                className={cn(
                  'flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[0.5625rem] px-2.5 text-sm tabular-nums text-fg',
                  index === active && 'bg-surface-sunken',
                  selected && 'font-semibold',
                )}
              >
                <span className="flex-1">{formatTime(slot, locale)}</span>
                {selected ? <Check aria-hidden className="size-4 text-accent-fg" /> : null}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
