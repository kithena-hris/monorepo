import { ChevronRight } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * One field in a schema editor, readable without opening it.
 *
 * A form builder's list usually shows a name and nothing else, so every
 * question — what kind of answer, when is it asked, who can see it, does the
 * assistant read it — costs a click. This row answers them on its face: a
 * tile for the type, the name with its badges, when it is asked and its key,
 * then a compact access strip and whether the assistant may read it.
 *
 * `changed` marks a field with an unpublished edit: a warning edge down the
 * leading side, and `changedLabel` in words for anyone who cannot see it.
 * `selected` is the one open in the editor beside the list.
 *
 * With `href` or `onOpen` the name is a target stretched over the row; the
 * `handle` (a drag grip) and anything in `trailing` stay targets of their own.
 * Under a finger the grip, the key and the access strip are dropped: a phone
 * reorders with a long press and has no room for eight glyphs in a row.
 */
export interface FieldRowProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** The type's glyph. */
  readonly icon: ReactNode;
  readonly title: ReactNode;
  /** `Badge`s beside the name: required, built in, needs approval. */
  readonly badges?: ReactNode;
  /** When it is asked, in words: "HR fills it in". */
  readonly description?: ReactNode;
  /** The machine key, in the monospace face. Hidden under a finger. */
  readonly code?: string;
  /** An `AccessStrip`. Hidden under a finger. */
  readonly access?: ReactNode;
  /** Small indicators before the chevron: whether the assistant reads it. */
  readonly trailing?: ReactNode;
  /** A drag grip. Hidden under a finger. */
  readonly handle?: ReactNode;
  readonly selected?: boolean;
  readonly changed?: boolean;
  /** Says `changed` in words. */
  readonly changedLabel?: string;
  readonly href?: string;
  readonly onOpen?: () => void;
}

export function FieldRow({
  icon,
  title,
  badges,
  description,
  code,
  access,
  trailing,
  handle,
  selected = false,
  changed = false,
  changedLabel = 'Changed, not published',
  href,
  onOpen,
  className,
  ...props
}: FieldRowProps): JSX.Element {
  const stretched =
    'rounded-xs text-start outline-none before:absolute before:inset-0 before:rounded-[inherit] focus-visible:before:outline-2 focus-visible:before:outline-offset-2 focus-visible:before:outline-border-focus';
  const name =
    href !== undefined ? (
      <a href={href} className={stretched}>
        {title}
      </a>
    ) : onOpen !== undefined ? (
      <button type="button" onClick={onOpen} className={cn(stretched, 'cursor-pointer')}>
        {title}
      </button>
    ) : (
      title
    );
  return (
    <div
      className={cn(
        'relative flex items-center gap-3 rounded-md bg-surface px-4 py-3 text-fg touch:px-3.5',
        selected
          ? 'shadow-[0_0_0_2px_var(--reach-color-accent)]'
          : changed
            ? 'shadow-[inset_3px_0_0_var(--reach-color-warning),var(--reach-shadow-sm)]'
            : 'shadow-sm',
        (href !== undefined || onOpen !== undefined) &&
          !selected &&
          'transition-shadow duration-(--animate-duration-fast) hover:shadow-md',
        className,
      )}
      {...props}
    >
      {handle ? (
        <span className="relative z-10 shrink-0 text-fg-subtle touch:hidden">{handle}</span>
      ) : null}
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-sunken text-fg-muted [&_svg]:size-[0.9375rem]"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold touch:text-base">{name}</span>
          {badges}
          {changed ? <span className="sr-only">{changedLabel}</span> : null}
        </div>
        {description || code ? (
          <p className="mt-0.5 text-xs text-fg-subtle">
            {description}
            {code ? (
              <span className="touch:hidden">
                {description ? ' · ' : null}
                <span className="font-mono">{code}</span>
              </span>
            ) : null}
          </p>
        ) : null}
      </div>
      {access ? <span className="shrink-0 touch:hidden">{access}</span> : null}
      {trailing ? (
        <span className="relative z-10 flex shrink-0 items-center gap-1.5">{trailing}</span>
      ) : null}
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-subtle" />
    </div>
  );
}
