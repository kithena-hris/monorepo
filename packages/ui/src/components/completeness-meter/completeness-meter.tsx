import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { CircularProgress } from '../progress/progress';

/**
 * How complete something is, what is missing, and by when.
 *
 * A ring for the figure, then the words that matter more than it: "3 details
 * missing", "Due before 1 Oct". The optional segments are the parts of the
 * thing — the sections of a record, the steps of a checklist — so a reader
 * sees which part is holding it back without opening anything. Each segment
 * says its state in its name, not only its colour.
 *
 * The ring's tone follows the value: complete is success, most of the way is
 * accent, and anything less is a warning, because a meter that is green at
 * 60% tells nobody to act.
 */
export type CompletenessSegment = 'done' | 'todo' | 'skipped';

export interface CompletenessMeterProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** 0 to 100. */
  readonly value: number;
  /** The headline. Defaults to "Complete" at 100. */
  readonly title?: ReactNode;
  /** The line under it: a due date, what is left. */
  readonly description?: ReactNode;
  /** One per part, in order. */
  readonly segments?: readonly { readonly label: string; readonly state: CompletenessSegment }[];
  /** A trailing action, usually a small `Button`. */
  readonly action?: ReactNode;
  /** The ring's diameter in pixels. */
  readonly size?: number;
  /** Names the ring for a screen reader. */
  readonly label?: string;
}

const segmentTone: Record<CompletenessSegment, string> = {
  done: 'bg-success',
  todo: 'bg-warning',
  skipped: 'bg-surface-active',
};

const segmentWord: Record<CompletenessSegment, string> = {
  done: 'complete',
  todo: 'missing details',
  skipped: 'not needed',
};

export function CompletenessMeter({
  value,
  title,
  description,
  segments,
  action,
  size = 64,
  label = 'Complete',
  className,
  ...props
}: CompletenessMeterProps): JSX.Element {
  const tone = value >= 100 ? 'success' : value >= 80 ? 'accent' : 'warning';
  return (
    <div className={cn('flex items-center gap-3.5', className)} {...props}>
      <CircularProgress value={value} label={label} size={size} tone={tone} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[1rem] leading-snug font-bold text-fg touch:text-md">
          {title ?? (value >= 100 ? 'Complete' : null)}
        </p>
        {description ? <p className="text-sm text-fg-muted">{description}</p> : null}
        {segments && segments.length > 0 ? (
          <ul className="mt-2 flex gap-[3px]" aria-label="Parts">
            {segments.map((segment) => (
              <li
                key={segment.label}
                className={cn('h-[5px] flex-1 rounded-full', segmentTone[segment.state])}
              >
                <span className="sr-only">
                  {segment.label}, {segmentWord[segment.state]}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
