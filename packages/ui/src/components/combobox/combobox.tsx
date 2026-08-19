'use client';

import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Badge } from '../badge/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../popover/popover';

/**
 * A select you can type into.
 *
 * The line against `Select`: below ~10 options a native-backed select is
 * better in every way, including on iOS where it becomes the system wheel.
 * Above that, scanning is slower than typing, and above a few hundred the list
 * has to be filtered server-side anyway. This is the control for "pick a
 * manager out of 900 people".
 *
 * It is built from an input plus a listbox rather than from Radix's Select,
 * because Select's trigger is a button and a button cannot be typed into. That
 * means the ARIA is ours to get right, so:
 *
 * - the input is `role="combobox"` with `aria-expanded` and `aria-controls`;
 * - the highlighted option is pointed at by `aria-activedescendant`, and DOM
 *   focus stays in the input: moving focus into the list would stop the user
 *   typing, which is the entire point of the control;
 * - the option count is announced through a live region, so a filter that
 *   narrows 900 names to 2 is audible rather than merely visible.
 */

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line, a team, a job title, whatever disambiguates two Grace Hoppers. */
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Options sharing a group render under one heading. */
  group?: string;
}

export interface ComboboxProps {
  options: readonly ComboboxOption[];
  /** A single value, or an array when `multiple` is set. */
  value: string | readonly string[] | null;
  onChange: (value: string | readonly string[] | null) => void;
  multiple?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Accessible name for the control. */
  label: string;
  disabled?: boolean;
  /** Adds a clear button once something is selected. */
  clearable?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  /**
   * Filter externally: pass the already-filtered options and handle the query
   * yourself. That is the mode to use once the list lives on a server.
   */
  onSearchChange?: (query: string) => void;
  /** Shows the busy state while a server-side search is in flight. */
  loading?: boolean;
}

const sizeClass = {
  sm: 'h-control-sm text-xs px-2.5',
  md: 'h-control-md text-base px-3',
  lg: 'h-control-lg text-md px-3.5',
} as const;

export function Combobox({
  options,
  value,
  onChange,
  multiple = false,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches.',
  label,
  disabled = false,
  clearable = false,
  className,
  size = 'md',
  onSearchChange,
  loading = false,
}: ComboboxProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const optionIdPrefix = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // A `typeof` narrowing rather than `Array.isArray`, which widens a
  // `readonly string[]` to `any[]` and takes the inference with it.
  const selected = useMemo<readonly string[]>(
    () => (value == null ? [] : typeof value === 'string' ? [value] : value),
    [value],
  );

  const filtered = useMemo(() => {
    if (onSearchChange || query === '') return options;
    const needle = query.toLowerCase();
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        (option.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [options, query, onSearchChange]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const option of filtered) {
      const key = option.group ?? '';
      const list = map.get(key);
      if (list) list.push(option);
      else map.set(key, [option]);
    }
    return [...map.entries()];
  }, [filtered]);

  // Flat order drives the keyboard, because the user arrows through the list
  // they see, not through the groups it happens to be sorted into.
  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);
  // Position by value, built once. `flat.indexOf(option)` inside the option
  // map is a scan per option, which on a directory-sized list is the slowest
  // thing in the component.
  const flatIndex = useMemo(
    () => new Map(flat.map((option, index) => [option.value, index])),
    [flat],
  );

  const commit = useCallback(
    (option: ComboboxOption) => {
      if (option.disabled) return;
      if (multiple) {
        const next = selected.includes(option.value)
          ? selected.filter((v) => v !== option.value)
          : [...selected, option.value];
        onChange(next);
        // The panel stays open: picking four teams should not cost four
        // round-trips through the trigger.
        return;
      }
      onChange(option.value);
      setOpen(false);
      setQuery('');
    },
    [multiple, onChange, selected],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        if (flat.length === 0) return 0;
        return (current + delta + flat.length) % flat.length;
      });
      return;
    }
    if (event.key === 'Enter') {
      const option = flat[activeIndex];
      if (option) {
        event.preventDefault();
        commit(option);
      }
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(flat.length - 1, 0));
    }
  };

  const selectedOptions = options.filter((option) => selected.includes(option.value));
  const triggerLabel =
    selectedOptions.length === 0
      ? placeholder
      : multiple
        ? `${String(selectedOptions.length)} selected`
        : (selectedOptions[0]?.label ?? placeholder);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setActiveIndex(0);
        else setQuery('');
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface',
          'text-left text-fg transition-colors duration-(--animate-duration-fast)',
          'hover:border-border-strong',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          'disabled:pointer-events-none disabled:opacity-55',
          sizeClass[size],
          className,
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', selected.length === 0 && 'text-fg-subtle')}>
          {triggerLabel}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && selected.length > 0 ? (
            <span
              // A nested <button> is invalid HTML inside a trigger button, so
              // the clear affordance is a span with an explicit role. It still
              // has to be reachable, hence tabIndex and the key handler.
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(multiple ? [] : null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(multiple ? [] : null);
                }
              }}
              className="grid size-5 place-items-center rounded-xs text-fg-subtle hover:bg-surface-hover hover:text-fg"
            >
              <X className="size-3.5" aria-hidden />
            </span>
          ) : null}
          <ChevronsUpDown className="size-4 text-fg-subtle" aria-hidden />
        </span>
      </PopoverTrigger>

      <PopoverContent
        matchTriggerWidth
        className="p-0"
        // Focus belongs in the search input the moment the panel opens.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-label={`${label} search`}
            aria-activedescendant={
              flat[activeIndex] ? `${optionIdPrefix}-${String(activeIndex)}` : undefined
            }
            value={query}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
              onSearchChange?.(event.target.value);
            }}
            onKeyDown={onKeyDown}
            className="h-10 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle"
          />
        </div>

        {multiple && selectedOptions.length > 0 ? (
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {selectedOptions.map((option) => (
              // Pops in on arrival: a chip that only fades reads as a
              // rendering glitch, while one that grows the last few percent
              // reads as having been placed.
              <Badge
                key={option.value}
                tone="accent"
                size="sm"
                className="motion-safe:animate-pop-in"
              >
                {option.label}
              </Badge>
            ))}
          </div>
        ) : null}

        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          className="max-h-64 overflow-y-auto overscroll-contain p-1"
        >
          {loading ? (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">Searching…</li>
          ) : flat.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">{emptyMessage}</li>
          ) : (
            grouped.map(([group, items]) => (
              <li key={group || 'ungrouped'}>
                {group ? (
                  <div className="px-2 pt-2 pb-1 text-2xs font-semibold tracking-wide text-fg-subtle uppercase">
                    {group}
                  </div>
                ) : null}
                <ul role="group" aria-label={group || undefined}>
                  {items.map((option) => {
                    const index = flatIndex.get(option.value) ?? -1;
                    const isSelected = selected.includes(option.value);
                    return (
                      <li
                        key={option.value}
                        id={`${optionIdPrefix}-${String(index)}`}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={option.disabled || undefined}
                        onClick={() => {
                          commit(option);
                        }}
                        onMouseEnter={() => {
                          setActiveIndex(index);
                        }}
                        className={cn(
                          'flex min-h-tap cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-base',
                          index === activeIndex && 'bg-surface-hover',
                          option.disabled && 'pointer-events-none opacity-55',
                        )}
                      >
                        <Check
                          aria-hidden
                          className={cn(
                            'size-4 shrink-0 text-accent-fg',
                            isSelected ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        {option.icon ? (
                          <span className="shrink-0 [&_svg]:size-4">{option.icon}</span>
                        ) : null}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-fg">{option.label}</span>
                          {option.description ? (
                            <span className="block truncate text-xs text-fg-muted">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>

        <p aria-live="polite" className="sr-only">
          {flat.length} {flat.length === 1 ? 'option' : 'options'} available
        </p>
      </PopoverContent>
    </Popover>
  );
}
