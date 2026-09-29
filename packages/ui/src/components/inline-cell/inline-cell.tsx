import { Check } from 'lucide-react';
import { useId, type ComponentPropsWithRef, type JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * A value edited in the grid it is shown in.
 *
 * Fixing forty cells through forty forms is how a data-quality job never gets
 * done. This is the cell itself as an input: it reads as plain text at rest,
 * gains a ring while it has the caret, and says what the caller's check made
 * of it as the reader types.
 *
 * | `status` | Looks | Means |
 * | --- | --- | --- |
 * | none | plain | a value, fine as it is |
 * | `missing` | warning wash, placeholder | wanted and empty |
 * | `invalid` | danger wash | the check refused it; `message` says why |
 * | `fixed` | success wash and a tick | it was refused, and now it passes |
 * | `saved` | a success hairline | written, nothing else to do |
 *
 * The check is the caller's; a grid that checks against the server passes the
 * answer back as `status`. The message is tied to the input with
 * `aria-describedby`, so a screen reader hears why without hunting for it.
 */
export type InlineCellStatus = 'missing' | 'invalid' | 'fixed' | 'saved';

export interface InlineCellProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  readonly status?: InlineCellStatus;
  /** Why it is invalid, or what fixed it. Spoken with the input, shown only to a screen reader. */
  readonly message?: string;
  /** Applied to the shell; `className` lands on the `<input>`. */
  readonly containerClassName?: string;
}

const shell: Record<InlineCellStatus | 'idle', string> = {
  idle: 'bg-transparent hover:bg-surface-sunken',
  missing: 'bg-warning-subtle',
  invalid: 'bg-danger-subtle',
  fixed: 'bg-success-subtle',
  saved: 'shadow-[inset_0_0_0_1px_var(--reach-color-success)]',
};

export function InlineCell({
  status,
  message,
  containerClassName,
  className,
  placeholder,
  ...props
}: InlineCellProps): JSX.Element {
  const describedBy = useId();
  const said = message !== undefined && message !== '';
  return (
    <span
      className={cn(
        'relative flex h-8.5 w-full min-w-0 items-center gap-1.5 rounded-xs px-2.5 touch:h-11',
        'transition-[background-color,box-shadow] duration-(--animate-duration-fast)',
        shell[status ?? 'idle'],
        // The caret's ring wins over every status: it says where typing goes.
        'focus-within:bg-surface focus-within:shadow-[inset_0_0_0_2px_var(--reach-color-accent)]',
        containerClassName,
      )}
    >
      <input
        aria-invalid={status === 'invalid' || undefined}
        aria-describedby={said ? describedBy : undefined}
        placeholder={placeholder ?? (status === 'missing' ? 'Missing' : undefined)}
        className={cn(
          'h-full w-full min-w-0 bg-transparent text-sm font-medium text-fg outline-none touch:text-base',
          'placeholder:font-normal',
          status === 'missing' ? 'placeholder:text-warning-fg' : 'placeholder:text-fg-subtle',
          status === 'invalid' && 'text-danger-fg',
          className,
        )}
        {...props}
      />
      {status === 'fixed' ? (
        <Check aria-hidden className="size-3.5 shrink-0 text-success-fg" />
      ) : null}
      {said ? (
        <span id={describedBy} className="sr-only">
          {message}
        </span>
      ) : null}
    </span>
  );
}
