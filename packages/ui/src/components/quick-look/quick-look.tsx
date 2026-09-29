'use client';

import { Maximize2, X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, KeyboardEvent, ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { Kbd } from '../kbd/kbd';

/**
 * A peek at one record beside the list it came from.
 *
 * Opening a record to check one thing and coming back loses the reader's place
 * in a long list. A quick look keeps the list where it is and shows the record
 * beside it: who, what they do, the few details people check most, and the
 * way to the full page. Space on a row opens it, ↑ and ↓ move to the next
 * record without closing it, ↵ opens the full page, and Esc closes it.
 *
 * The list owns the rows, so the list decides what ↑ and ↓ mean; this panel
 * answers the same keys while focus is inside it (and not in one of its own
 * buttons or links, where ↵ already means something), and the header is a
 * polite live region so moving to the next record is heard as well as seen.
 *
 * Under a finger there is no hover and no keyboard: a tap opens the record,
 * so the key hints are dropped and the panel is only a card.
 */
export interface QuickLookProps extends Omit<ComponentPropsWithoutRef<'aside'>, 'title'> {
  /** Usually an `Avatar`. */
  readonly media?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Small buttons under the heading: message, open. */
  readonly actions?: ReactNode;
  /** The details: `KeyValues`, a `CompletenessMeter`. */
  readonly children?: ReactNode;
  /** The full page, for the expand control and ↵. */
  readonly href?: string;
  readonly onClose?: () => void;
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  /** ↵. Defaults to following `href`. */
  readonly onOpen?: () => void;
  /** Hides the key hints. */
  readonly hideHints?: boolean;
  /** Names the panel: "Quick look". */
  readonly label?: string;
}

export function QuickLook({
  media,
  title,
  description,
  actions,
  children,
  href,
  onClose,
  onPrevious,
  onNext,
  onOpen,
  hideHints = false,
  label = 'Quick look',
  className,
  onKeyDown,
  ...props
}: QuickLookProps): JSX.Element {
  const open =
    onOpen ??
    (href === undefined
      ? undefined
      : () => {
          window.location.assign(href);
        });

  const keys = (event: KeyboardEvent<HTMLElement>): void => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const inControl =
      event.target instanceof Element &&
      event.target.closest('a[href], button, input, textarea, select') !== null;
    const handler =
      event.key === 'ArrowUp'
        ? onPrevious
        : event.key === 'ArrowDown'
          ? onNext
          : event.key === 'Escape'
            ? onClose
            : event.key === 'Enter' && !inControl
              ? open
              : undefined;
    if (handler === undefined) return;
    event.preventDefault();
    handler();
  };

  return (
    <aside
      aria-label={label}
      onKeyDown={keys}
      className={cn(
        'flex flex-col gap-3.5 rounded-xl bg-surface-raised p-5 text-fg shadow-lg touch:rounded-[1.375rem] touch:shadow-sm',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        {media}
        <span className="flex gap-1">
          {href === undefined ? null : (
            <Button
              asChild
              variant="ghost"
              size="xs"
              className="relative tap-target aspect-square px-0 touch:px-0"
            >
              <a href={href} aria-label="Open the full page">
                <Maximize2 aria-hidden />
              </a>
            </Button>
          )}
          {onClose === undefined ? null : (
            <Button
              variant="ghost"
              size="xs"
              className="relative tap-target"
              aria-label="Close"
              onClick={onClose}
              startIcon={<X aria-hidden />}
            />
          )}
        </span>
      </div>
      <div aria-live="polite">
        <h2 className="font-display text-lg leading-tight font-bold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-1.5 *:flex-1">{actions}</div> : null}
      {children}
      {hideHints ? null : (
        <p className="flex flex-wrap gap-3 text-xs text-fg-muted touch:hidden">
          {onPrevious || onNext ? (
            <span className="flex items-center gap-1">
              <Kbd keyName="up" />
              <Kbd keyName="down" /> next record
            </span>
          ) : null}
          {open ? (
            <span className="flex items-center gap-1">
              <Kbd keyName="enter" /> open
            </span>
          ) : null}
        </p>
      )}
    </aside>
  );
}
