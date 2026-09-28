'use client';

import * as ToastPrimitive from '@radix-ui/react-toast';
import { cva, type VariantProps } from 'class-variance-authority';
import { Bell, Check, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

/**
 * Transient confirmation of something that already happened.
 *
 * The constraint that matters: a toast is not allowed to be the only place a
 * piece of information appears. It disappears on a timer. It is easy to miss
 * on a second monitor, and a screen reader user hears it once. "Leave approved"
 * is a fine toast because the row behind it also changed; "Payroll failed for
 * 4 employees" is not. That is an `Alert` on the page, which persists.
 *
 * Radix's viewport handles the parts that are easy to get wrong: swipe to
 * dismiss, pausing the timer on hover and on window blur, and F8 to jump to
 * the toast region from anywhere.
 */

/*
 * A snackbar on the inverted surface, whatever the tone. The tone lives in the
 * small disc at the start, so a success and a failure are the same object in
 * the same place and only the glyph and its colour differ. A green wash for one
 * and a red wash for the other made the stack a traffic light.
 */
const toast = cva(
  [
    'group pointer-events-auto relative flex w-full items-center gap-3 overflow-hidden',
    'rounded-md bg-invert py-3 ps-3.5 pe-2 text-fg-on-invert shadow-lg touch:rounded-lg',
    'data-[state=open]:animate-slide-up data-[state=closed]:animate-fade-out',
    // Follows the finger while swiping, then animates out from where it was let go.
    'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none',
    'data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform',
    'data-[swipe=end]:animate-slide-out-right',
  ],
  {
    variants: {
      tone: {
        neutral: '[--toast-disc:var(--color-fg-subtle)]',
        success: '[--toast-disc:var(--color-success-solid)]',
        warning: '[--toast-disc:var(--color-warning)]',
        danger: '[--toast-disc:var(--color-danger-solid)]',
        info: '[--toast-disc:var(--color-info)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const toneIcon = {
  neutral: Bell,
  success: Check,
  warning: TriangleAlert,
  danger: X,
  info: Info,
} as const;

export type ToastTone = keyof typeof toneIcon;

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds. `Infinity` pins it open, only for a failure with a retry. */
  duration?: number;
  action?: { label: string; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
  dismissAll: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Mount once, near the root. Everything below it can call `useToast()`.
 *
 * The provider owns the list rather than a module-level store so that two
 * independently-sold modules mounted in the same shell do not fight over one
 * global queue, the same reason nothing else here is a singleton.
 */
export function ToastProvider({
  children,
  swipeDirection = 'right',
  ...props
}: ComponentPropsWithoutRef<typeof ToastPrimitive.Provider> & {
  children: ReactNode;
}): JSX.Element {
  const [items, setItems] = useState<readonly ToastRecord[]>([]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toast: (options) => {
        setItems((current) => [...current, { ...options, id: Date.now() + current.length }]);
      },
      dismissAll: () => {
        setItems([]);
      },
    }),
    [],
  );

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection={swipeDirection} {...props}>
        {children}
        {items.map((item) => (
          <ToastItem key={item.id} record={item} onClosed={remove} />
        ))}
        <ToastViewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a <ToastProvider>.');
  return context;
}

function ToastItem({
  record,
  onClosed,
}: {
  record: ToastRecord;
  onClosed: (id: number) => void;
}): JSX.Element {
  const tone = record.tone ?? 'neutral';
  const Icon = toneIcon[tone];

  return (
    <ToastPrimitive.Root
      duration={record.duration ?? 5000}
      onOpenChange={(open) => {
        if (!open) onClosed(record.id);
      }}
      className={toast({ tone })}
    >
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-full bg-(--toast-disc) text-fg-on-solid"
      >
        <Icon className="size-3.5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <ToastPrimitive.Title className="text-sm font-semibold">
          {record.title}
        </ToastPrimitive.Title>
        {record.description ? (
          <ToastPrimitive.Description className="mt-0.5 text-sm text-fg-on-invert/80">
            {record.description}
          </ToastPrimitive.Description>
        ) : null}
      </div>
      {record.action ? (
        <ToastPrimitive.Action
          asChild
          altText={record.action.label}
          // `altText` is not decoration: a screen reader user cannot swipe or
          // hover, so Radix uses it to describe the action in the announcement.
        >
          <button
            type="button"
            onClick={record.action.onClick}
            className={cn(
              'relative h-8.5 shrink-0 rounded-control px-3 text-sm font-semibold whitespace-nowrap tap-target',
              'bg-fg-on-invert/15 transition-colors hover:bg-fg-on-invert/25',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
            )}
          >
            {record.action.label}
          </button>
        </ToastPrimitive.Action>
      ) : null}
      <ToastPrimitive.Close
        className={cn(
          'relative grid size-8 shrink-0 place-items-center rounded-full opacity-60 tap-target',
          'transition-opacity hover:opacity-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        )}
      >
        <X aria-hidden className="size-4" />
        <span className="sr-only">Dismiss</span>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
}

/**
 * Bottom-centre on a phone (reachable, out of the way of the top status bar),
 * bottom-right on anything wider. Both respect the safe area, or the stack
 * ends up under the iPhone home indicator.
 */
export function ToastViewport({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>): JSX.Element {
  return (
    <ToastPrimitive.Viewport
      className={cn(
        'pointer-events-none fixed z-100 flex max-h-dvh w-full flex-col gap-2 p-4',
        'bottom-0 left-1/2 -translate-x-1/2 pb-[max(1rem,var(--spacing-safe-bottom))]',
        'sm:right-0 sm:left-auto sm:max-w-sm sm:translate-x-0',
        className,
      )}
      {...props}
    />
  );
}

export type ToastVariants = VariantProps<typeof toast>;
