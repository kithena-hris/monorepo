import { ChevronRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A way into one area of settings that says how it is set today.
 *
 * An index of settings that lists only names makes an administrator open each
 * one to learn anything. This card carries the answer on its face — "18
 * fields · version 7", "Nobody in finance" — so the index is also a summary,
 * and the one that needs attention says so with a badge.
 *
 * The whole card is one link (an `<a>`, so it opens in a new tab like any
 * other), with the chevron as the reminder that it goes somewhere. Under a
 * finger the tile and padding tighten so two fit side by side on a tablet and
 * one reads comfortably on a phone.
 */
export interface SettingsCardProps extends Omit<ComponentPropsWithoutRef<'a'>, 'title'> {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** The current state, in a few words. Empty when there is nothing to say. */
  readonly meta?: ReactNode;
  /** A `Badge` for a state that wants attention: a draft, a gap. */
  readonly badge?: ReactNode;
  /** Draws a ring, for the card a reader was sent to. */
  readonly highlighted?: boolean;
}

export function SettingsCard({
  icon,
  title,
  description,
  meta,
  badge,
  highlighted = false,
  className,
  ...props
}: SettingsCardProps): JSX.Element {
  return (
    <a
      className={cn(
        'group/settings-card flex min-w-0 items-start gap-4 rounded-lg bg-surface p-5 text-fg touch:gap-3.5 touch:rounded-[1.375rem] touch:p-4',
        highlighted ? 'shadow-[0_0_0_2px_var(--reach-color-accent)]' : 'shadow-sm',
        'transition-shadow duration-(--animate-duration-fast) ease-standard hover:shadow-md',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="grid size-12 shrink-0 place-items-center rounded-md bg-surface-sunken text-fg [&_svg]:size-[1.375rem] touch:size-10 touch:[&_svg]:size-5"
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="text-[1rem] leading-snug font-semibold touch:text-md">{title}</span>
        {description ? <span className="text-sm text-fg-muted">{description}</span> : null}
        {meta ? <span className="mt-1 text-sm font-semibold">{meta}</span> : null}
      </span>
      {badge ? <span className="shrink-0">{badge}</span> : null}
      <ChevronRight
        aria-hidden
        className="size-[1.125rem] shrink-0 text-fg-subtle transition-transform duration-(--animate-duration-fast) group-hover/settings-card:translate-x-0.5 motion-reduce:transform-none"
      />
    </a>
  );
}
