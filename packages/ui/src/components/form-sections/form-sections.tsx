'use client';

import { useId } from 'react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { PINNED_BAR } from '../../lib/pinned';
import { cn } from '../../lib/cn';
import { Button } from '../button/button';

/**
 * How a long form is laid out: titled sections, and a save bar that appears
 * once something has changed.
 *
 * Each section is a title and a line of context beside its fields where there
 * is room for both, and above them where there is not. "Where there is room"
 * is the width the form was given, a container query, not the window's: the
 * same settings page is two columns in a wide pane and one in a side panel.
 */
export function FormSections({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div className={cn('@container flex flex-col gap-5 touch:gap-4.5', className)} {...props} />
  );
}

export interface FormSectionProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title: ReactNode;
  /** One line on who sees this, or why it is asked. */
  description?: ReactNode;
  /** The section titles' level in the page's outline. */
  headingLevel?: 2 | 3 | 4;
}

export function FormSection({
  title,
  description,
  headingLevel = 2,
  className,
  children,
  ...props
}: FormSectionProps): JSX.Element {
  const id = useId();
  const Heading = `h${String(headingLevel)}` as 'h2' | 'h3' | 'h4';

  return (
    <section
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      className={cn(
        // A rule under each section rather than a card around it: sections
        // are chapters of one form, not separate things.
        'flex flex-col gap-2.5 pb-4.5 shadow-[inset_0_-1px_0_var(--reach-color-border)] last:pb-0 last:shadow-none',
        '@xl:grid @xl:grid-cols-[12.5rem_minmax(0,1fr)] @xl:gap-6 @xl:pb-6',
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        <Heading id={`${id}-title`} className="text-base font-bold text-fg">
          {title}
        </Heading>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-sm text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

export interface FormSaveBarProps {
  /** Shown once there is something to save. Render it unconditionally. */
  open: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** Disables both buttons and shows the Save button as busy. */
  saving?: boolean;
  message?: ReactNode;
  saveLabel?: string;
  discardLabel?: string;
  className?: string;
}

/**
 * The bar that rises in with the first change and leaves with the save.
 *
 * It sticks to the bottom of whatever scrolls, so it is in reach wherever the
 * change was made, and it is the only place a long form offers Save: a second
 * button at the end of the form is one the person has to scroll past forty
 * fields to find. Warning before leaving the page is the screen's job, since
 * only the screen knows what leaving means.
 */
export function FormSaveBar({
  open,
  onSave,
  onDiscard,
  saving = false,
  message = 'Unsaved changes',
  saveLabel = 'Save',
  discardLabel = 'Discard',
  className,
}: FormSaveBarProps): JSX.Element | null {
  if (!open) return null;

  return (
    <div
      {...PINNED_BAR}
      className={cn(
        'sticky bottom-4 z-10 flex items-center gap-2 rounded-full bg-invert py-2 ps-4.5 pe-2 text-fg-on-invert shadow-lg',
        // The focus ring takes the fill's own ink: an accent ring vanishes on it.
        '[--reach-color-border-focus:var(--reach-color-fg-on-invert)]',
        'motion-safe:animate-slide-up',
        className,
      )}
    >
      {/* Announced as it appears, so the change is audible as well as visible. */}
      <p role="status" className="min-w-0 flex-1 truncate text-sm font-semibold">
        {message}
      </p>
      <Button size="sm" variant="on-invert" disabled={saving} onClick={onDiscard}>
        {discardLabel}
      </Button>
      <Button size="sm" variant="primary" loading={saving} onClick={onSave}>
        {saveLabel}
      </Button>
    </div>
  );
}
