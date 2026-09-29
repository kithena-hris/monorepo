'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type JSX,
  type KeyboardEvent,
} from 'react';

import { cn } from '../../lib/cn';
import { fieldShell } from '../field/field-styles';
import { KbdShortcut, chordOf } from '../kbd/kbd';

export interface KeyRecorderProps
  extends Omit<ComponentPropsWithRef<'button'>, 'value' | 'onChange' | 'children'> {
  /** The shortcut now, as chords (`['g', 'd']`, `['mod+shift+k']`). Empty: none. */
  value: readonly string[];
  /** The chords just recorded. Whether they are allowed is the caller's to say, on the `Field`. */
  onValueChange: (keys: readonly string[]) => void;
  size?: 'sm' | 'md' | 'lg';
  /** The most chords one shortcut takes; two records G then D. */
  maxChords?: number;
  /** How long a following chord of a sequence is waited for, in milliseconds. */
  sequenceMs?: number;
  /** Shown when there are no keys. */
  placeholder?: string;
  /** Shown, and announced, while it listens. */
  recordingText?: string;
}

/**
 * A field that records a keyboard shortcut.
 *
 * Press it (click, Enter or Space) and it listens: the next chord is taken, and
 * a second one if it comes within `sequenceMs`, so both ⌘⇧K and G then D can be
 * recorded. A chord with a modifier is taken at once, on its own. What is pressed while it listens goes nowhere else, so recording a
 * key that already does something does not do it.
 *
 * Escape cancels, and so does Tab or leaving it, which then moves focus on as
 * usual: recording never traps the keyboard (WCAG 2.1.2). Wrap it in
 * `FieldControl` and it takes the field's label, description and error like
 * any input; the keys it holds describe it, so a reader hears them too.
 */
export function KeyRecorder({
  value,
  onValueChange,
  size,
  maxChords = 2,
  sequenceMs = 1000,
  placeholder = 'None',
  recordingText = 'Press the keys',
  className,
  onClick,
  onKeyDown,
  onBlur,
  'aria-describedby': describedBy,
  ...props
}: KeyRecorderProps): JSX.Element {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<readonly string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const keysId = useId();

  const stop = (): void => {
    clearTimeout(timer.current);
    setRecording(false);
    setPending([]);
  };
  const commit = (keys: readonly string[]): void => {
    stop();
    onValueChange(keys);
  };
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );

  const listen = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'Tab') {
      stop();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stop();
      return;
    }
    const chord = chordOf(event);
    if (chord === null) return;
    const next = [...pending, chord];
    clearTimeout(timer.current);
    // A chord with a modifier is whole on its own: ⌘⇧K is not the start of anything.
    if (next.length >= maxChords || (pending.length === 0 && chord.includes('+') && chord !== '+')) {
      commit(next);
      return;
    }
    setPending(next);
    timer.current = setTimeout(() => {
      commit(next);
    }, sequenceMs);
  };

  const shown = recording ? pending : value;
  return (
    <>
      <button
        type="button"
        data-recording={recording || undefined}
        aria-describedby={[keysId, describedBy].filter(Boolean).join(' ')}
        className={cn(
          fieldShell({ size }),
          'cursor-pointer text-start',
          'focus-visible:outline-none',
          recording && 'bg-surface ring-2 ring-accent ring-inset',
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented && !recording) setRecording(true);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (recording && !event.defaultPrevented) listen(event);
        }}
        onBlur={(event) => {
          onBlur?.(event);
          stop();
        }}
        {...props}
      >
        <span id={keysId} className="flex min-w-0 flex-1 items-center">
          {shown.length > 0 ? (
            <KbdShortcut keys={shown} />
          ) : (
            <span className="text-fg-muted">{recording ? recordingText : placeholder}</span>
          )}
        </span>
      </button>
      <span aria-live="polite" className="sr-only">
        {recording ? `${recordingText}. Escape cancels.` : ''}
      </span>
    </>
  );
}
