import { CalendarClock, Hourglass } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A value, with what happens to it next.
 *
 * Most values change on a date rather than when somebody presses Save: a new
 * manager from the first of the month, a raise from January. Showing only the
 * current value hides the change that is already agreed; showing only the
 * history makes the reader open it to learn what is coming. This keeps the
 * current value first and says the next one underneath, with its date, and
 * whether it is still waiting for somebody to approve it.
 *
 * The lines are words with an icon, never colour alone: "Priya Shah from
 * 1 Nov" reads the same to a screen reader and to anyone who cannot tell the
 * info blue from the text.
 */
export interface EffectiveValueProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** What it is today. */
  readonly value: ReactNode;
  /** The change already scheduled: the value, and the date it applies from. */
  readonly next?: { readonly value: ReactNode; readonly from: ReactNode } | null;
  /** Waiting for approval. `true` says so in the default words; a node replaces them. */
  readonly pending?: ReactNode;
}

export function EffectiveValue({
  value,
  next,
  pending = false,
  className,
  ...props
}: EffectiveValueProps): JSX.Element {
  return (
    <span className={cn('inline-flex min-w-0 flex-col gap-1', className)} {...props}>
      <span className="text-sm font-medium text-fg touch:text-base">{value}</span>
      {next ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-info-fg">
          <CalendarClock aria-hidden className="size-3.5 shrink-0" />
          <span>
            {next.value} from {next.from}
          </span>
        </span>
      ) : null}
      {pending === false || pending === null ? null : (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-warning-fg">
          <Hourglass aria-hidden className="size-3.5 shrink-0" />
          <span>{pending === true ? 'Waiting for approval' : pending}</span>
        </span>
      )}
    </span>
  );
}
