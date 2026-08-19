'use client';

import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';
import { Check, X } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * Where you are in a sequence that has an end.
 *
 * ### It is a list, not a progress bar
 *
 * A progress bar says "60%". A stepper says *which* step, what came before it,
 * and what is still to come, which is the question someone halfway through an
 * onboarding checklist or a payroll run is actually asking. So it renders as an
 * ordered list with one item per step, and the current one carries
 * `aria-current="step"`.
 *
 * ### Status is never colour alone
 *
 * A completed step has a tick, a failed one a cross, and both say so in text
 * that a screen reader reads. Green and red circles are the same circle to
 * around 8% of men, on a projector, and in a printed PDF.
 *
 * ### Going back is a button; going forward is not
 *
 * With `onStepChange`, steps you have already finished become buttons and the
 * ones ahead stay inert. That is not a styling decision: letting someone jump
 * to step 5 from step 2 skips the validation that steps 3 and 4 exist to do,
 * and a wizard that can be short-circuited is a wizard that files bad data.
 */

export type StepStatus = 'complete' | 'current' | 'upcoming' | 'error';

export interface StepperStep {
  id: string;
  label: string;
  /** A second line: what this step is for, or why it failed. */
  description?: string;
  /** Overrides the status derived from `current`. Use it for a failed step. */
  status?: StepStatus;
  /** Replaces the number in the marker. */
  icon?: ReactNode;
  /** Blocks navigation to this step even when it is behind the current one. */
  disabled?: boolean;
}

export interface StepperProps extends Omit<ComponentPropsWithoutRef<'nav'>, 'onSelect'> {
  steps: readonly StepperStep[];
  /** Index of the step in progress. */
  current: number;
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md';
  /**
   * Makes finished steps clickable. Steps ahead of the current one stay inert:
   * jumping forward skips the validation the steps between are there to do.
   */
  onStepChange?: (index: number, step: StepperStep) => void;
  /** Names the sequence for assistive tech. */
  label: string;
}

function statusOf(step: StepperStep, index: number, current: number): StepStatus {
  if (step.status) return step.status;
  if (index < current) return 'complete';
  if (index === current) return 'current';
  return 'upcoming';
}

/** Said out loud, because the ring around a circle is not a word. */
const statusText: Record<StepStatus, string> = {
  complete: 'Completed',
  current: 'In progress',
  upcoming: 'Not started',
  error: 'Needs attention',
};

/**
 * Filled markers carry white, not the tone's `*-fg`.
 *
 * `success-fg` and friends are dark, and they exist for text on the `*-subtle`
 * washes. Putting one on a saturated fill measured at 1.55:1 for the completed
 * step and 1.31:1 for the current one, which is invisible rather than merely
 * low. The completed step uses `success-solid` because white on the ordinary
 * success green is 3.99:1, just under the 4.5 a step number needs.
 */
const markerTone: Record<StepStatus, string> = {
  complete: 'border-success-solid bg-success-solid text-fg-on-solid',
  current: 'border-accent-solid bg-accent-solid text-fg-on-solid',
  upcoming: 'border-border bg-surface text-fg-subtle',
  error: 'border-danger-solid bg-danger-solid text-fg-on-solid',
};

const labelTone: Record<StepStatus, string> = {
  complete: 'text-fg',
  current: 'text-fg',
  upcoming: 'text-fg-muted',
  error: 'text-danger-fg',
};

export function Stepper({
  steps,
  current,
  orientation = 'horizontal',
  size = 'md',
  onStepChange,
  label,
  className,
  ...props
}: StepperProps): JSX.Element {
  const markerSize = size === 'sm' ? 'size-6 text-2xs' : 'size-8 text-xs';

  return (
    <nav aria-label={label} className={cn('min-w-0', className)} {...props}>
      <ol
        className={cn('flex', orientation === 'horizontal' ? 'flex-row items-start' : 'flex-col')}
      >
        {steps.map((step, index) => {
          const status = statusOf(step, index, current);
          const last = index === steps.length - 1;
          // Behind the current step and not explicitly barred.
          const reachable = onStepChange !== undefined && index < current && step.disabled !== true;

          const marker = (
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full border-2 font-semibold',
                'transition-colors duration-(--animate-duration-fast)',
                markerSize,
                markerTone[status],
              )}
            >
              {step.icon ??
                (status === 'complete' ? (
                  <Check aria-hidden className="size-4" />
                ) : status === 'error' ? (
                  <X aria-hidden className="size-4" />
                ) : (
                  index + 1
                ))}
            </span>
          );

          const text = (
            <span className="min-w-0">
              <span className={cn('block truncate text-sm font-medium', labelTone[status])}>
                {step.label}
              </span>
              {step.description === undefined ? null : (
                <span className="block truncate text-2xs text-fg-subtle">{step.description}</span>
              )}
              {/* The status in words. The ring is a decoration; this is the fact. */}
              <span className="sr-only">{statusText[status]}</span>
            </span>
          );

          const body = reachable ? (
            <button
              type="button"
              onClick={() => {
                onStepChange(index, step);
              }}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-sm text-start',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                'hover:[&_span:first-child]:brightness-110',
              )}
            >
              {marker}
              {text}
            </button>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              {marker}
              {text}
            </span>
          );

          return (
            <li
              key={step.id}
              // `aria-current` rather than a colour: it is what a screen reader
              // announces when it reaches the step someone is actually on.
              {...(status === 'current' ? { 'aria-current': 'step' as const } : {})}
              className={cn(
                'flex min-w-0',
                orientation === 'horizontal'
                  ? cn('flex-row items-center', last ? 'shrink' : 'flex-1')
                  : 'flex-col',
              )}
            >
              {body}

              {/* The rail between steps. Coloured up to the current one so the
                  sequence reads as a route travelled, not a row of badges. */}
              {last ? null : (
                <span
                  aria-hidden
                  className={cn(
                    'shrink-0 rounded-full transition-colors duration-(--animate-duration-normal)',
                    index < current ? 'bg-success' : 'bg-border',
                    orientation === 'horizontal'
                      ? 'mx-3 h-0.5 min-w-6 flex-1'
                      : cn('my-1 w-0.5', size === 'sm' ? 'ms-3 h-5' : 'ms-4 h-6'),
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
