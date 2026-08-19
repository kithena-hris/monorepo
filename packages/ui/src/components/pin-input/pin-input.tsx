'use client';

import {
  useId,
  useRef,
  type ClipboardEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * A one-time code, as separate boxes.
 *
 * ### The one that everyone gets wrong: paste
 *
 * A person receives a six-digit code and pastes it. In most implementations
 * the paste lands in one box and the other five stay empty, so they retype it
 * by hand, from a text message, on a phone, under a 30-second timer. Here the
 * paste is split across the boxes wherever it lands, non-digits are stripped,
 * and the caret moves to the end.
 *
 * ### `autocomplete="one-time-code"`
 *
 * On iOS this is what makes the code appear above the keyboard, and on Android
 * it feeds the SMS Retriever. It goes on the **first** box only: repeating it
 * makes Safari offer the whole code to every box in turn.
 *
 * ### Security
 *
 * The boxes are `type="text"` with `inputMode="numeric"`, not `type="password"`,
 * a one-time code is not a secret worth masking, and masking it stops anyone
 * checking what they typed against the message they are reading it from.
 * `masked` exists for the rare case of a static PIN, which is a different
 * thing and should usually be a `PasswordField` instead.
 *
 * Nothing here validates the code. Rate limiting, attempt counting and
 * constant-time comparison are server concerns, and a component that hinted
 * otherwise would be a component that got trusted.
 *
 * ### Accessibility
 *
 * Boxes are a visual convention; a screen reader hears one field. The group is
 * labelled, each box announces its position, and the complete value is exposed
 * through a live region as it is entered: otherwise a non-sighted user has no
 * way to check what they have typed so far.
 */

export interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Fires once the last box is filled. Submit from here, not from a timer. */
  onComplete?: (value: string) => void;
  length?: number;
  /** Required. "Verification code", not "PIN". */
  label: string;
  hint?: ReactNode;
  /** `numeric` gives the phone keypad. `alphanumeric` allows letters. */
  type?: 'numeric' | 'alphanumeric';
  /** Masks the characters. For a stored PIN, not for a one-time code. */
  masked?: boolean;
  /** A gap after this many boxes, for a code that is read in groups. */
  groupAfter?: number;
  size?: 'md' | 'lg';
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
}

const boxSize = {
  md: 'size-10 text-md',
  lg: 'size-12 text-lg',
} as const;

export function PinInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  hint,
  type = 'numeric',
  masked = false,
  groupAfter,
  size = 'md',
  disabled = false,
  invalid = false,
  autoFocus = false,
  className,
}: PinInputProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const statusId = `${id}-status`;
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const allowed = type === 'numeric' ? /\d/ : /[a-z0-9]/i;
  const sanitise = (input: string): string =>
    // `Array.from`, not `[...input]` or `.split('')`: both of those iterate
    // UTF-16 code units and can cut a character in half. Nothing that survives
    // the filter below is astral, but the paste that arrives here is arbitrary
    // and the split happens first.
    Array.from(input)
      .filter((character) => allowed.test(character))
      .join('');

  const focusBox = (index: number): void => {
    const target = refs.current[Math.max(0, Math.min(index, length - 1))];
    target?.focus();
    target?.select();
  };

  const commit = (next: string): void => {
    const trimmed = next.slice(0, length);
    onChange(trimmed);
    if (trimmed.length === length) onComplete?.(trimmed);
  };

  const onBoxChange = (index: number, raw: string): void => {
    const characters = sanitise(raw);
    if (characters === '') return;

    // A box can receive more than one character: autofill, a fast typist, a
    // keyboard that composes. Everything past the first spills forward.
    const next = Array.from(value.padEnd(length, ' '));
    Array.from(characters).forEach((character, offset) => {
      if (index + offset < length) next[index + offset] = character;
    });
    commit(next.join('').trimEnd());
    focusBox(index + characters.length);
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        const next = Array.from(value);
        next[index] = '';
        commit(next.join(''));
        return;
      }
      // Empty box: delete the previous one and go there. Anything else makes
      // correcting a typo a two-key operation.
      const next = Array.from(value);
      next[index - 1] = '';
      commit(next.join('').trimEnd());
      focusBox(index - 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusBox(index - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  const onPaste = (index: number, event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    const pasted = sanitise(event.clipboardData.getData('text'));
    if (pasted === '') return;
    const next = Array.from(value.padEnd(length, ' '));
    Array.from(pasted).forEach((character, offset) => {
      if (index + offset < length) next[index + offset] = character;
    });
    commit(next.join('').trimEnd());
    focusBox(index + pasted.length);
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span id={`${id}-label`} className="text-sm leading-none font-medium text-fg">
        {label}
      </span>
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}

      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={cn(hint && hintId, statusId) || undefined}
        className={cn('flex items-center gap-2', disabled && 'pointer-events-none opacity-55')}
      >
        {Array.from({ length }, (_, index) => (
          <div key={index} className="contents">
            <input
              ref={(node) => {
                refs.current[index] = node;
              }}
              // `text`, not `number`: a number input strips leading zeros, and
              // a code beginning `0` is a code that cannot be entered.
              type={masked ? 'password' : 'text'}
              inputMode={type === 'numeric' ? 'numeric' : 'text'}
              // First box only. Repeating it makes Safari offer the whole code
              // to every box in turn.
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={1}
              aria-label={`${label}, character ${String(index + 1)} of ${String(length)}`}
              aria-invalid={invalid || undefined}
              disabled={disabled}
              autoFocus={autoFocus && index === 0}
              value={value[index] ?? ''}
              onChange={(event) => {
                onBoxChange(index, event.target.value);
              }}
              onKeyDown={(event) => {
                onKeyDown(index, event);
              }}
              onPaste={(event) => {
                onPaste(index, event);
              }}
              onFocus={(event) => {
                event.target.select();
              }}
              className={cn(
                'rounded-md border bg-surface text-center font-mono tabular-nums text-fg',
                'transition-[border-color,box-shadow,transform] duration-(--animate-duration-fast) ease-standard',
                'focus:border-border-focus focus:ring-2 focus:ring-border-focus/30 focus:outline-none',
                // A filled box lifts a little. On a six-box row it is the only
                // progress indicator there is.
                value[index] ? 'border-border-strong' : 'border-border',
                invalid && 'border-danger',
                boxSize[size],
              )}
            />
            {groupAfter !== undefined && (index + 1) % groupAfter === 0 && index < length - 1 ? (
              <span aria-hidden className="w-2 text-center text-fg-subtle">
                –
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/*
       * Boxes are a visual convention. Without this a non-sighted user has no
       * way to check what they have entered so far, every box announces only
       * its own character.
       */}
      <p id={statusId} aria-live="polite" className="sr-only">
        {value.length === 0
          ? `${label} empty`
          : `${String(value.length)} of ${String(length)} characters entered`}
      </p>
    </div>
  );
}
