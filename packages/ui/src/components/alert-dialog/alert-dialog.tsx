'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type { ComponentPropsWithoutRef, JSX } from 'react';

import { cn } from '../../lib/cn';

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
    <AlertDialogPrimitive.Portal>
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
          'fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-2xl border border-b-0 border-border bg-surface p-5 shadow-xl',
          'pb-safe-bottom focus-visible:outline-none',
          'data-[state=open]:animate-slide-in-bottom data-[state=closed]:animate-slide-out-bottom',
          'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:w-full sm:max-w-md',
          'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:border-b sm:pb-5',
          'sm:data-[state=open]:animate-scale-in sm:data-[state=closed]:animate-scale-out',
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
      className={cn('text-md font-semibold text-fg', className)}
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
      className={cn('mt-2 text-base text-fg-muted', className)}
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
      className={cn(
        'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        '[&>*]:w-full sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
