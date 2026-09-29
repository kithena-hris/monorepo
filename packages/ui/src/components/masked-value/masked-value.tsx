'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type ComponentPropsWithoutRef, type JSX } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * A sensitive value, hidden until somebody asks for it.
 *
 * Masked is the resting state, and it shows as much as is safe to show — the
 * last four of an account, the year of a birth — so a reader can tell the
 * value is there and roughly what it is without seeing it. Asking to see it is
 * the caller's business (a reason, a second factor, an audit entry); this only
 * offers the button and draws the answer.
 *
 * A revealed value is shown on a warning wash with the time it has left, and
 * hides itself when that runs out: a value somebody looked at on Monday is not
 * still on their screen on Tuesday. The countdown is read from the clock each
 * second rather than decremented, so a laptop that slept does not wake up
 * showing a value that expired an hour ago.
 */
export interface MaskedValueProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** What is shown while hidden: `•• ••• 1994`. */
  readonly masked: string;
  /** The value itself, once somebody has been allowed to see it. */
  readonly value?: string | null;
  /** When a revealed value hides again, in epoch milliseconds. */
  readonly expiresAt?: number | null;
  /** Asks to see it. Leave out where the reader may never reveal it. */
  readonly onReveal?: () => void;
  /** Hides it again, by hand or when the time runs out. */
  readonly onHide?: () => void;
  /** What the value is, for the button's name: "Show date of birth". */
  readonly label?: string;
}

/** `14:52 left`: minutes and seconds, from milliseconds remaining. */
export function timeLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')} left`;
}

export function MaskedValue({
  masked,
  value = null,
  expiresAt = null,
  onReveal,
  onHide,
  label = 'value',
  className,
  ...props
}: MaskedValueProps): JSX.Element {
  const shown = value !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!shown || expiresAt === null) return undefined;
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= expiresAt) onHide?.();
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [shown, expiresAt, onHide]);

  const action = shown ? onHide : onReveal;

  return (
    <span
      className={cn(
        'inline-flex h-7.5 w-fit max-w-full items-center gap-2 rounded-sm ps-2.5 pe-1 font-mono text-sm font-medium touch:h-9 touch:text-base',
        shown ? 'bg-warning-subtle text-fg' : 'bg-surface-sunken text-fg-muted',
        action === undefined && 'pe-2.5',
        className,
      )}
      {...props}
    >
      <span className="truncate">
        {shown ? value : <span aria-label={`${label}, hidden`}>{masked}</span>}
      </span>
      {shown && expiresAt !== null ? (
        <span className="shrink-0 font-sans text-2xs font-semibold text-warning-fg tabular-nums">
          {timeLeft(expiresAt - now)}
        </span>
      ) : null}
      {action === undefined ? null : (
        <Button
          variant="ghost"
          size="xs"
          className="relative tap-target size-6 rounded-xs text-fg-muted touch:size-7"
          aria-label={shown ? `Hide ${label}` : `Show ${label}`}
          onClick={action}
          startIcon={shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        />
      )}
    </span>
  );
}
