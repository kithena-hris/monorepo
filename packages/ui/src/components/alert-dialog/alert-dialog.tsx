'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';
import { usePortalContainer } from '../../lib/portal-container';

/**
 * Confirmation for something that cannot be undone.
 *
 * Not a `Dialog` with different buttons, the roles differ, and that
 * difference is load-bearing. This is `role="alertdialog"`, so a screen reader
 * announces the description immediately instead of waiting to be asked; the
 * overlay does not dismiss it; and focus lands on Cancel, not on the
 * destructive action, so a stray Enter cannot terminate an employee.
 *
 * Reserve it for genuinely irreversible operations. A confirmation on a
 * reversible action trains people to click through the one that matters.
 */

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export function AlertDialogContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>): JSX.Element {
  return (
    <AlertDialogPrimitive.Portal container={usePortalContainer()}>
      <AlertDialogPrimitive.Overlay
        // A scrim, not chrome: the job is to dim the task behind and push it
        // back, so it keeps its dimming even where translucency is declined.
        data-material="scrim"
        className={cn(
          'fixed inset-0 z-50 bg-overlay backdrop-blur-[2px]',
          'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        )}
      />
      <AlertDialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col',
          'w-[calc(100%-2rem)] max-w-md rounded-[1.5rem] bg-surface-raised p-6 text-fg shadow-xl',
          'focus-visible:outline-none',
          'data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out',
          // Under a finger it is the phone's own alert: narrow, centred, and
          // centred text. It stays in the middle rather than rising as a sheet,
          // because an irreversible question should not look like a menu of
          // options — and its buttons span the whole width, so the thumb still
          // reaches them.
          'touch:w-[calc(100%-3rem)] touch:max-w-[21.375rem] touch:rounded-[1.875rem] touch:p-5.5',
          'touch:text-center',
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>): JSX.Element {
  return (
    <AlertDialogPrimitive.Title
      className={cn(
        'font-display text-lg leading-tight font-bold tracking-tight text-fg',
        'touch:text-[1.125rem] touch:font-semibold',
        className,
      )}
      {...props}
    />
  );
}

const iconTone = {
  accent: 'bg-accent-subtle text-accent-fg',
  info: 'bg-info-subtle text-info-fg',
  success: 'bg-success-subtle text-success-fg',
  warning: 'bg-warning-subtle text-warning-fg',
  danger: 'bg-danger-subtle text-danger-fg',
} as const;

export interface AlertDialogIconProps extends ComponentPropsWithoutRef<'span'> {
  tone?: keyof typeof iconTone;
}

/**
 * The glyph above the title, in a tinted disc. Decorative: the title says what
 * is at stake, so the disc is hidden from assistive tech.
 */
export function AlertDialogIcon({
  className,
  tone = 'danger',
  ...props
}: AlertDialogIconProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn(
        'mb-3.5 grid size-12 shrink-0 place-items-center rounded-full [&_svg]:size-[1.375rem]',
        'touch:mx-auto',
        iconTone[tone],
        className,
      )}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>): JSX.Element {
  return (
    <AlertDialogPrimitive.Description
      className={cn('mt-2 text-[0.875rem] leading-normal text-fg-muted touch:text-sm', className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>): JSX.Element {
  return (
    <div
      // Cancel first in the DOM and on the left, so the destructive action is
      // never where a reflexive tap lands. Under a finger both share the row.
      className={cn(
        'mt-6 flex flex-wrap justify-end gap-2',
        'touch:mt-5 touch:[&>*]:flex-[1_1_7rem]',
        className,
      )}
      {...props}
    />
  );
}
