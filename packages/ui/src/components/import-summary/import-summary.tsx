import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

/**
 * How a batch was sorted, as tiles that filter what is under them.
 *
 * An import's dry run, a bulk edit's preview: every row lands in one bucket
 * (create, update, unchanged, blocked), and the reader's next question is
 * always "show me those". Each tile is a toggle button for its bucket, so the
 * count is also the way in, and the pressed one says so to a screen reader as
 * well as with its ring. Pressing the pressed tile again clears the filter.
 *
 * The dot and the ring take the bucket's tone; the words and the figure carry
 * it, so the tones are a reminder rather than the message.
 */
export type ImportSummaryTone = 'success' | 'info' | 'neutral' | 'accent' | 'warning' | 'danger';

export interface ImportSummaryTile {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly tone?: ImportSummaryTone;
}

export interface ImportSummaryProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onSelect'> {
  readonly tiles: readonly ImportSummaryTile[];
  /** The bucket the rows are filtered to, or null for all of them. */
  readonly selected?: string | null;
  /** Leave out for tiles that only report. */
  readonly onSelect?: (id: string | null) => void;
  /** Names the group: "Rows by outcome". */
  readonly label?: string;
}

const dot: Record<ImportSummaryTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  neutral: 'bg-fg-subtle',
  accent: 'bg-accent',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

const ring: Record<ImportSummaryTone, string> = {
  success: 'shadow-[0_0_0_2px_var(--reach-color-success)]',
  info: 'shadow-[0_0_0_2px_var(--reach-color-info)]',
  neutral: 'shadow-[0_0_0_2px_var(--reach-color-fg-subtle)]',
  accent: 'shadow-[0_0_0_2px_var(--reach-color-accent)]',
  warning: 'shadow-[0_0_0_2px_var(--reach-color-warning)]',
  danger: 'shadow-[0_0_0_2px_var(--reach-color-danger)]',
};

export function ImportSummary({
  tiles,
  selected = null,
  onSelect,
  label = 'Rows by outcome',
  className,
  ...props
}: ImportSummaryProps): JSX.Element {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'grid grid-cols-[repeat(var(--reach-tiles),minmax(0,1fr))] gap-2.5 touch:grid-cols-2',
        className,
      )}
      style={{ ['--reach-tiles' as string]: tiles.length }}
      {...props}
    >
      {tiles.map((tile) => {
        const tone = tile.tone ?? 'neutral';
        const on = selected === tile.id;
        const inner = (
          <>
            <span className="flex items-center gap-2 text-sm font-medium text-fg-muted">
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot[tone])} />
              {tile.label}
            </span>
            <span className="mt-2 block font-display text-[1.625rem] leading-none font-bold text-fg tabular-nums">
              {tile.count.toLocaleString()}
            </span>
          </>
        );
        const look = cn(
          'rounded-md bg-surface p-3.5 text-start touch:rounded-[1.125rem]',
          on ? ring[tone] : 'shadow-sm',
        );
        return onSelect === undefined ? (
          <div key={tile.id} className={look}>
            {inner}
          </div>
        ) : (
          <button
            key={tile.id}
            type="button"
            aria-pressed={on}
            onClick={() => {
              onSelect(on ? null : tile.id);
            }}
            className={cn(
              look,
              'cursor-pointer transition-shadow duration-(--animate-duration-fast)',
              !on && 'hover:shadow-md',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            )}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
