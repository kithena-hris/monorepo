import { ChevronRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Avatar, type AvatarProps } from '../avatar/avatar';

/**
 * Somebody, as a card: in a grid for browsing, in a list for choosing.
 *
 * `grid` centres the photo over the name and what they do, with a row of
 * badges (a team, a place) and room for a few actions. `row` is the same
 * person on one line with a chevron, the shape a phone list or a picker
 * wants.
 *
 * Presence is a dot on the photo, which is colour, so `statusLabel` says it in
 * words for a screen reader. An absence — "Back 21 Oct" — is a line of text,
 * because it is information the reader acts on rather than decoration.
 *
 * With `href` the name is a link stretched over the whole card, so the card is
 * one target and still an `<a>` (middle-click, open in a new tab). Actions sit
 * above the stretched link and stay their own targets.
 */
export interface PersonCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  readonly name: string;
  /** What they do: a job title, a team. */
  readonly description?: ReactNode;
  /** A line in the info tone: an absence, a start date. */
  readonly note?: ReactNode;
  readonly avatarSrc?: string;
  readonly status?: AvatarProps['status'];
  readonly statusLabel?: string;
  /** `Badge`s under the name, in the grid layout. */
  readonly badges?: ReactNode;
  /** Small `Button`s, in the grid layout. */
  readonly actions?: ReactNode;
  readonly layout?: 'grid' | 'row';
  readonly selected?: boolean;
  /** Makes the whole card a link to them. */
  readonly href?: string;
}

export function PersonCard({
  name,
  description,
  note,
  avatarSrc,
  status,
  statusLabel,
  badges,
  actions,
  layout = 'grid',
  selected = false,
  href,
  className,
  ...props
}: PersonCardProps): JSX.Element {
  const row = layout === 'row';
  const title =
    href === undefined ? (
      name
    ) : (
      <a
        href={href}
        className="rounded-xs outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-border-focus"
      >
        {name}
      </a>
    );
  return (
    <div
      className={cn(
        'relative flex min-w-0 rounded-lg bg-surface text-fg touch:rounded-[1.375rem]',
        selected ? 'shadow-[0_0_0_2px_var(--reach-color-accent)]' : 'shadow-sm',
        href !== undefined &&
          'transition-shadow duration-(--animate-duration-fast) hover:shadow-md',
        row ? 'items-center gap-3.5 px-4 py-3.5' : 'flex-col items-center gap-2.5 p-5 text-center',
        className,
      )}
      {...props}
    >
      <Avatar
        name={name}
        src={avatarSrc}
        size={row ? 'xl' : '2xl'}
        {...(status === undefined ? {} : { status })}
        {...(statusLabel === undefined ? {} : { statusLabel })}
        className="shrink-0"
      />
      <div className={cn('min-w-0', row && 'flex-1')}>
        <p className="truncate text-[0.9375rem] font-semibold touch:text-base">{title}</p>
        {description ? <p className="truncate text-sm text-fg-muted">{description}</p> : null}
        {note ? <p className="mt-1 text-xs font-medium text-info-fg">{note}</p> : null}
      </div>
      {row ? (
        <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
      ) : (
        <>
          {badges ? <div className="flex flex-wrap justify-center gap-1.5">{badges}</div> : null}
          {actions ? <div className="relative z-10 mt-1 flex gap-1.5">{actions}</div> : null}
        </>
      )}
    </div>
  );
}
