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
  /**
   * `auto` runs across the page at a desk and down it under a finger, where
   * five steps side by side leave each label a few letters wide.
   */
  orientation?: 'horizontal' | 'vertical' | 'auto';
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
 * `accent-fg` and friends are dark, and they exist for text on the `*-subtle`
 * washes. Putting one on a saturated fill measured well under 3:1, which is
 * invisible rather than merely low. The current step is the exception: it is
 * the soft wash with a ring, so its number is `accent-fg` on `accent-subtle`,
 * the pairing that wash exists for.
 */
const markerTone: Record<StepStatus, string> = {
  complete: 'bg-accent-solid text-fg-on-accent',
  current: 'bg-accent-subtle text-accent-fg ring-2 ring-accent ring-inset',
  upcoming: 'bg-surface-sunken text-fg-muted',
  error: 'bg-danger-solid text-fg-on-solid',
};

/*
 * Marker above its words across the page, beside them down it. The words get
 * the whole width of their step either way, so a label that would have
 * truncated beside a marker has room under it.
 *
 * Written out per orientation, and for `auto` as the horizontal classes with
 * `touch:` versions of the vertical ones, because Tailwind can only generate a
 * class it can read whole in the source.
 */
const horizontalLayout = {
  list: 'w-full flex-row items-start gap-2',
  item: 'flex-1',
  step: 'flex-col gap-2',
  gap: '',
  text: 'w-full',
  label: 'text-sm',
  description: 'line-clamp-2 text-xs',
  railSm: 'end-0 h-0.5 start-8 top-[11px]',
  railMd: 'end-0 h-0.5 start-9 top-[13px]',
};

const layoutFor = {
  horizontal: horizontalLayout,
  vertical: {
    list: 'flex-col',
    item: '',
    step: 'gap-3.5',
    gap: 'pb-4.5',
    text: 'flex-1 pt-0.5',
    label: 'text-base',
    description: 'text-sm',
    railSm: 'bottom-1 w-0.5 start-[11px] top-7',
    railMd: 'bottom-1 w-0.5 start-[13px] top-8',
  },
  auto: {
    list: cn(horizontalLayout.list, 'touch:w-auto touch:flex-col touch:gap-0'),
    item: 'flex-1 touch:flex-none',
    step: 'flex-col gap-2 touch:flex-row touch:gap-3.5',
    gap: 'touch:pb-4.5',
    text: 'w-full touch:w-auto touch:flex-1 touch:pt-0.5',
    label: 'text-sm touch:text-base',
    description: 'line-clamp-2 text-xs touch:line-clamp-none touch:text-sm',
    railSm: cn(
      horizontalLayout.railSm,
      'touch:end-auto touch:h-auto touch:w-0.5 touch:start-[11px] touch:top-7 touch:bottom-1',
    ),
    railMd: cn(
      horizontalLayout.railMd,
      'touch:end-auto touch:h-auto touch:w-0.5 touch:start-[13px] touch:top-8 touch:bottom-1',
    ),
  },
} as const;

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
  const markerSize = size === 'sm' ? 'size-6 text-xs' : 'size-7 text-sm';
  const o = layoutFor[orientation];

  return (
    <nav aria-label={label} className={cn('min-w-0', className)} {...props}>
      <ol className={cn('flex', o.list)}>
        {steps.map((step, index) => {
          const status = statusOf(step, index, current);
          const last = index === steps.length - 1;
          // Behind the current step and not explicitly barred.
          const reachable = onStepChange !== undefined && index < current && step.disabled !== true;

          const marker = (
            <span
              className={cn(
                'flex shrink-0 items-center justify-center rounded-full font-bold tabular-nums',
                'transition-colors duration-(--animate-duration-fast)',
                markerSize,
                markerTone[status],
              )}
            >
              {step.icon ??
                (status === 'complete' ? (
                  <Check aria-hidden className="size-4" strokeWidth={2.5} />
                ) : status === 'error' ? (
                  <X aria-hidden className="size-4" strokeWidth={2.5} />
                ) : (
                  index + 1
                ))}
            </span>
          );

          const text = (
            <span className={cn('min-w-0', o.text)}>
              <span
                className={cn(
                  'block truncate font-semibold',
                  o.label,
                  status === 'upcoming' ? 'text-fg-muted' : 'text-fg',
                )}
              >
                {step.label}
              </span>
              {step.description === undefined ? null : (
                <span
                  className={cn(
                    'mt-0.5 block',
                    o.description,
                    status === 'error' ? 'text-danger-fg' : 'text-fg-muted',
                  )}
                >
                  {step.description}
                </span>
              )}
              {/* The status in words. The ring is a decoration; this is the fact. */}
              <span className="sr-only">{statusText[status]}</span>
            </span>
          );

          const layout = cn('flex min-w-0 items-start', o.step, !last && o.gap);

          const body = reachable ? (
            <button
              type="button"
              onClick={() => {
                onStepChange(index, step);
              }}
              className={cn(
                layout,
                'w-full touch:min-h-tap rounded-sm text-start',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
                'hover:[&>span:first-child]:brightness-110',
              )}
            >
              {marker}
              {text}
            </button>
          ) : (
            <span className={layout}>
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
              className={cn('relative min-w-0', o.item)}
            >
              {body}

              {/*
               * The rail to the next step, drawn from this marker's far edge
               * to the edge of the step. Absolute, so the marker and its words
               * can stay one button without the rail becoming part of it.
               * Coloured once the step is done, so the sequence reads as a
               * route travelled, not a row of badges.
               */}
              {last ? null : (
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute rounded-full transition-colors duration-(--animate-duration-normal)',
                    status === 'complete' ? 'bg-accent' : 'bg-border-strong',
                    size === 'sm' ? o.railSm : o.railMd,
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
