'use client';

import { useId } from 'react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { PINNED_BAR } from '../../lib/pinned';
import { cn } from '../../lib/cn';
import { Button } from '../button/button';
import { t } from '../../lib/i18n';

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
  message = t('components.form-sections.form-sections.unsaved_changes', 'Unsaved changes'),
  saveLabel = t('components.form-sections.form-sections.save', 'Save'),
  discardLabel = t('components.form-sections.form-sections.discard', 'Discard'),
  className,
}: FormSaveBarProps): JSX.Element | null {
  if (!open) return null;

  return (
    <PinnedBar message={message} className={className}>
      <Button size="sm" variant="on-invert" disabled={saving} onClick={onDiscard}>
        {discardLabel}
      </Button>
      <Button size="sm" variant="primary" loading={saving} onClick={onSave}>
        {saveLabel}
      </Button>
    </PinnedBar>
  );
}

export interface PinnedBarProps {
  /** What the page is in the middle of, announced as it changes: "Step 2 of 3 · Signature". */
  message: ReactNode;
  /** Its actions, the main one last. */
  children: ReactNode;
  /**
   * How far through it is, as a thin line along the bar's foot: three of four
   * boxes filled. Said with the message, so put the count in the words too.
   */
  progress?: { readonly value: number; readonly max: number } | undefined;
  className?: string | undefined;
}

/**
 * The bar a page keeps in reach while something is under way: unsaved
 * changes (`FormSaveBar`), a document being signed. Inverted, so it reads as
 * a mode the page is in; sticky to the bottom of whatever scrolls, so put it
 * last in the content it belongs to, with no `overflow` clipping between it
 * and the scroller.
 */
export function PinnedBar({ message, children, progress, className }: PinnedBarProps): JSX.Element {
  const share =
    progress === undefined || progress.max <= 0
      ? 0
      : Math.min(Math.max(progress.value / progress.max, 0), 1);
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
      {/* Announced as it changes, so the step is audible as well as visible. */}
      <p role="status" className="min-w-0 flex-1 truncate text-sm font-semibold">
        {message}
      </p>
      {children}
      {progress === undefined ? null : (
        <div
          role="progressbar"
          aria-label={t('components.form-sections.form-sections.done_so_far', 'Done so far')}
          aria-valuemin={0}
          aria-valuemax={progress.max}
          aria-valuenow={progress.value}
          className="pointer-events-none absolute inset-x-6 bottom-1 h-0.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--reach-color-fg-on-invert)_22%,transparent)]"
        >
          <div
            className="h-full bg-[var(--reach-color-fg-on-invert)] motion-safe:transition-[width] motion-safe:duration-300"
            style={{ width: `${String(share * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
