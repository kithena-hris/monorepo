'use client';

import { X } from 'lucide-react';
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { fieldErrorClass, fieldHintClass, fieldLabelClass } from '../field/field-styles';

/**
 * Several short values in one field: email addresses, skills, cost centres.
 *
 * ### The interaction contract
 *
 * Enter and comma commit. Backspace on an empty field deletes the last tag,
 * the second press, not the first, so a mistyped character does not destroy
 * the previous tag. Arrow keys walk the tags themselves, which is the part
 * most implementations skip and the only way to remove the *third* tag without
 * a mouse.
 *
 * Paste splits on commas, semicolons and newlines, so a column out of a
 * spreadsheet or a line out of an email client arrives as tags rather than as
 * one very long tag.
 *
 * ### Duplicates and validation
 *
 * Rejected values are reported, never silently dropped: a tag that does not
 * appear is indistinguishable from a broken field. `validate` returns an error
 * string, so "not a work address" can be said in those words rather than as a
 * red border.
 *
 * ### Security
 *
 * Tags are rendered as text through React, so markup in a value is escaped,
 * not interpreted. They are also *not* trusted downstream, a tag that becomes
 * a query parameter or a filename still needs encoding at that boundary. This
 * component escapes what it displays; it cannot escape what you do with it.
 *
 * ### Accessibility
 *
 * The tags are a labelled list, each with its own remove button naming the tag
 * it removes ("Remove ada@acme.example", never "Remove"). Additions and
 * removals go through a live region, because a list that changes silently is a
 * list a screen-reader user has to re-read from the top to audit.
 */

export interface TagsInputProps {
  value: readonly string[];
  onChange: (value: readonly string[]) => void;
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  /** Upper bound. The field stops accepting once reached, and says so. */
  max?: number;
  /** Return an error string to reject, or `null` to accept. */
  validate?: (value: string) => string | null;
  /** Normalises before comparison and storage: trimming, lower-casing. */
  transform?: (value: string) => string;
  /** Characters that commit the current draft, besides Enter. */
  delimiters?: readonly string[];
  size?: 'sm' | 'md';
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  name?: string;
}

/** A reasonable default for an address field. Not a validator: see the story. */
export function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function TagsInput({
  value,
  onChange,
  label,
  hint,
  placeholder = 'Type and press Enter',
  max,
  validate,
  transform = (input) => input.trim(),
  delimiters = [',', ';'],
  size = 'md',
  disabled = false,
  invalid = false,
  className,
  name,
}: TagsInputProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const statusId = `${id}-status`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  // Which tag has keyboard focus, when the focus is on a tag rather than in
  // the field. `null` means the field.
  const [focusedTag, setFocusedTag] = useState<number | null>(null);

  const full = max !== undefined && value.length >= max;

  const add = (raw: string): boolean => {
    const candidate = transform(raw);
    if (candidate === '') return false;

    // Narrowed on `max` rather than on the derived `full`, so the message can
    // name the limit without a fallback that could never be reached.
    if (max !== undefined && value.length >= max) {
      setError(`At most ${String(max)} allowed.`);
      return false;
    }
    if (value.includes(candidate)) {
      setError(`${candidate} is already in the list.`);
      return false;
    }
    const failure = validate?.(candidate);
    if (failure !== null && failure !== undefined) {
      setError(failure);
      return false;
    }

    setError(null);
    onChange([...value, candidate]);
    setAnnouncement(`${candidate} added. ${String(value.length + 1)} in total.`);
    return true;
  };

  const remove = (index: number): void => {
    const removed = value[index] ?? 'Tag';
    onChange(value.filter((_, position) => position !== index));
    setAnnouncement(`${removed} removed. ${String(value.length - 1)} remaining.`);
    setFocusedTag(null);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter' || delimiters.includes(event.key)) {
      event.preventDefault();
      if (add(draft)) setDraft('');
      return;
    }

    if (event.key === 'Backspace' && draft === '') {
      event.preventDefault();
      if (focusedTag !== null) {
        remove(focusedTag);
        return;
      }
      // The first Backspace *selects* the last tag; the second removes it. A
      // single press that deletes is how a mistyped character costs someone
      // the address they typed a minute ago.
      if (value.length > 0) setFocusedTag(value.length - 1);
      return;
    }

    if (event.key === 'ArrowLeft' && draft === '') {
      event.preventDefault();
      setFocusedTag((current) => (current === null ? value.length - 1 : Math.max(0, current - 1)));
      return;
    }

    if (event.key === 'ArrowRight' && focusedTag !== null) {
      event.preventDefault();
      setFocusedTag((current) =>
        current === null || current >= value.length - 1 ? null : current + 1,
      );
      return;
    }

    if (event.key !== 'Tab') setFocusedTag(null);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>): void => {
    const pasted = event.clipboardData.getData('text');
    // Only intervene when the paste actually contains separators. A single
    // value pasted into the field should behave like typing it.
    if (!/[,;\n\t]/.test(pasted)) return;
    event.preventDefault();
    const parts = pasted.split(/[,;\n\t]+/);
    let added = 0;
    for (const part of parts) if (add(part)) added += 1;
    if (added > 0) setDraft('');
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className={fieldLabelClass}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={fieldHintClass}>
          {hint}
        </p>
      ) : null}

      <div
        // A group, so the tags and the field that adds them are announced as
        // one control and a test can ask for them by role. The click handler
        // only forwards focus to the input, which is the actual control.
        role="group"
        aria-label={label}
        onClick={() => {
          inputRef.current?.focus();
        }}
        // Filled like every field, but it grows: the height is a minimum,
        // and the tags wrap onto as many lines as they need.
        className={cn(
          'flex cursor-text flex-wrap items-center gap-1.5 bg-surface-sunken px-2 py-1.5 touch:rounded-[1rem]',
          'transition-[background-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
          'hover:not-focus-within:bg-surface-hover',
          'focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent focus-within:ring-inset',
          (invalid || error) && 'ring-2 ring-danger ring-inset focus-within:ring-danger',
          size === 'sm'
            ? 'min-h-control-sm rounded-[0.625rem] text-sm'
            : 'min-h-11 rounded-[0.75rem] text-base touch:min-h-14',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <ul aria-label={`${label}, ${String(value.length)} entries`} className="contents">
          {value.map((tag, index) => (
            <li
              key={tag}
              className={cn(
                // A pill on the fill: raised surface at rest, accent while the
                // keyboard has it selected for deletion.
                'inline-flex h-7 max-w-full items-center gap-1 rounded-full ps-2.5 pe-1 text-sm font-medium touch:h-8',
                'transition-[background-color,color,box-shadow] duration-(--animate-duration-fast)',
                'motion-safe:animate-pop-in',
                focusedTag === index
                  ? 'bg-accent-subtle text-accent-fg ring-2 ring-accent ring-inset'
                  : 'bg-surface-raised text-fg shadow-xs',
              )}
            >
              {/* React escapes this. A tag containing markup is displayed as
                  the characters the user typed, never interpreted. */}
              <span className="truncate">{tag}</span>
              <button
                type="button"
                tabIndex={-1}
                aria-label={`Remove ${tag}`}
                onClick={(event) => {
                  event.stopPropagation();
                  remove(index);
                }}
                className={cn(
                  'relative grid size-5 shrink-0 place-items-center rounded-full text-fg-muted tap-target',
                  'transition-colors hover:bg-surface-active hover:text-fg',
                )}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>

        <input
          ref={inputRef}
          id={id}
          type="text"
          // The field is a list builder, not an address book lookup. Browser
          // autofill offering a saved value here fills one tag with a whole
          // form's worth of text.
          autoComplete="off"
          aria-describedby={cn(hint && hintId, error && errorId, statusId) || undefined}
          aria-invalid={invalid || Boolean(error) || undefined}
          value={draft}
          placeholder={value.length === 0 ? placeholder : full ? 'Limit reached' : ''}
          disabled={disabled || full}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
            setFocusedTag(null);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => {
            // Committing on blur is the difference between a field that works
            // and one where a typed-but-uncommitted value vanishes on submit.
            if (draft.trim() !== '' && add(draft)) setDraft('');
            setFocusedTag(null);
          }}
          className="h-7 min-w-16 flex-1 bg-transparent px-1.5 text-fg outline-none placeholder:text-fg-subtle touch:h-11"
        />
      </div>

      {error ? (
        <p id={errorId} role="alert" className={fieldErrorClass}>
          {error}
        </p>
      ) : null}

      {max !== undefined ? (
        <p className="self-end text-sm tabular-nums text-fg-muted">
          {value.length} / {max}
        </p>
      ) : null}

      <p id={statusId} aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {name ? value.map((tag) => <input key={tag} type="hidden" name={name} value={tag} />) : null}
    </div>
  );
}
