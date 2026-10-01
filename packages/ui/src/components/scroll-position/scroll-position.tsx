import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { icons } from '../../icons';
import { cn } from '../../lib/cn';
import { Badge } from '../badge/badge';
import { Button } from '../button/button';

export interface ScrollPositionProps extends ComponentPropsWithoutRef<'div'> {
  /** Where the reader is, in words: "150 of 388". */
  children: ReactNode;
  /** Scrolls back to the first row. Leave it out near the top, where it goes nowhere. */
  onBackToTop?: () => void;
  backToTopLabel?: string;
}

/**
 * Where you are in a long list that keeps loading: a count, and a way back to
 * the start. The caller pins it over the list (sticky or absolute, at the
 * trailing edge) and shows it once the reader has scrolled.
 *
 * The count is not a live region. It changes on every page of a scroll, and a
 * screen reader hearing each change hears nothing else; the list announces its
 * own loads.
 */
export function ScrollPosition({
  onBackToTop,
  backToTopLabel = 'Back to top',
  className,
  children,
  ...props
}: ScrollPositionProps): JSX.Element {
  return (
    <div className={cn('flex flex-col items-end gap-2', className)} {...props}>
      <Badge variant="solid" tone="neutral" size="lg" className="tabular-nums shadow-md">
        {children}
      </Badge>
      {onBackToTop ? (
        <Button
          variant="secondary"
          size="xs"
          startIcon={<icons.up aria-hidden />}
          onClick={onBackToTop}
          className="shadow-sm"
        >
          {backToTopLabel}
        </Button>
      ) : null}
    </div>
  );
}
