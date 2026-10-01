import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

export interface IconListProps extends ComponentPropsWithoutRef<'ul'> {
  /**
   * A hairline between items and room around each, for a list read as a
   * sequence of separate things (every step a plan will take). Without it the
   * items sit close, for a short set of points read as one argument (the
   * reasons something was flagged).
   */
  divided?: boolean;
}

/**
 * Points that each lead with a glyph in a tinted tile: a title, a line of
 * explanation, and optionally one action.
 *
 * Not a `List`, whose rows are places to go or things to pick, and which
 * truncates. These are statements to read, so they wrap. The tile's tone is
 * a hint about the point, never the point itself: the title says it.
 */
export function IconList({ divided = false, className, ...props }: IconListProps): JSX.Element {
  return (
    <ul
      data-divided={divided || undefined}
      className={cn(
        'group/icons flex flex-col',
        divided
          ? '[&>li]:py-3.5 [&>li:not(:last-child)]:shadow-[inset_0_-1px_0_var(--color-border)]'
          : 'gap-2.5',
        className,
      )}
      {...props}
    />
  );
}

const tileTone = {
  neutral: 'bg-surface-sunken text-fg-muted',
  accent: 'bg-accent-subtle text-accent-fg',
  success: 'bg-success-subtle text-success-fg',
  warning: 'bg-warning-subtle text-warning-fg',
  danger: 'bg-danger-subtle text-danger-fg',
  info: 'bg-info-subtle text-info-fg',
} as const;

export interface IconListItemProps extends Omit<ComponentPropsWithoutRef<'li'>, 'title'> {
  /** The glyph. Decorative: the title carries the meaning. */
  icon: ReactNode;
  tone?: keyof typeof tileTone;
  /** One line under the title. */
  description?: ReactNode;
  /** At the end: one small button, "Open draft". */
  action?: ReactNode;
  children: ReactNode;
}

export function IconListItem({
  icon,
  tone = 'neutral',
  description,
  action,
  className,
  children,
  ...props
}: IconListItemProps): JSX.Element {
  return (
    <li className={cn('flex items-start gap-3', className)} {...props}>
      <span
        aria-hidden
        className={cn(
          'grid size-8 shrink-0 place-items-center rounded-[0.625rem] [&_svg]:size-4',
          'group-data-divided/icons:size-9 group-data-divided/icons:[&_svg]:size-[1.0625rem]',
          tileTone[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug font-semibold text-fg group-data-divided/icons:text-base">
          {children}
        </p>
        {description ? (
          <p className="mt-0.5 text-[0.8125rem]/[1.45] text-fg-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}
