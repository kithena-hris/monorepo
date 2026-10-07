import { Check, X } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { Pressable, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Icon } from '../icon/icon.tsx';
import { Progress } from '../progress/progress.tsx';
import { Text } from '../text/text.tsx';

/**
 * Progress through a flow with a fixed number of steps; more than five is too
 * many. On a phone the steps usually stand as a list down the screen
 * (`vertical`, the default), or, above a form, give way to a progress bar
 * reading "2 of 3" (`StepperProgress`): a row of tiny circles helps nobody
 * there. Dots (`StepperDots`) are for short carousels whose steps have no
 * names.
 *
 * Not tabs: a step is somewhere you go in order.
 */
export type StepStatus = 'done' | 'current' | 'failed' | 'todo';

export type StepperStep = {
  label: string;
  status?: StepStatus;
  /** A line under the label: a date, "Optional", why it failed. */
  description?: string;
  /**
   * Goes back to a finished step. Only `done` steps take it: a future step
   * cannot be reached until the current one is valid.
   */
  onPress?: () => void;
};

export type StepperProps = {
  steps: readonly StepperStep[];
  orientation?: 'vertical' | 'horizontal';
  /** Names the flow for a screen reader: "Onboarding". */
  label?: string;
  className?: string | undefined;
};

const spoken: Record<StepStatus, string> = {
  done: 'completed',
  current: 'current',
  failed: 'failed',
  todo: 'not started',
};

function Marker({ status, index }: { status: StepStatus; index: number }): React.JSX.Element {
  return (
    <View
      className={cn(
        'size-7 shrink-0 items-center justify-center rounded-full',
        status === 'done' && 'bg-accent',
        status === 'current' && 'border-2 border-accent bg-accent-subtle',
        status === 'failed' && 'bg-danger-solid',
        status === 'todo' && 'bg-surface-sunken',
      )}
    >
      {status === 'done' ? (
        <Icon icon={Check} size={15} tone="on-accent" />
      ) : status === 'failed' ? (
        <Icon icon={X} size={15} tone="on-accent" />
      ) : (
        <Text
          weight="bold"
          tone={status === 'current' ? 'accent' : 'muted'}
          tabular
          className="text-[13px] leading-none"
        >
          {String(index + 1)}
        </Text>
      )}
    </View>
  );
}

function Connector({ done, vertical }: { done: boolean; vertical: boolean }): React.JSX.Element {
  return (
    <View
      className={cn(
        'rounded-[2px]',
        vertical ? 'my-1 min-h-[18px] w-0.5 flex-1' : 'h-0.5 flex-1',
        done ? 'bg-accent' : 'bg-border-strong',
      )}
    />
  );
}

function Step({
  step,
  index,
  count,
  children,
  className,
}: {
  step: StepperStep;
  index: number;
  count: number;
  children: ReactNode;
  className: string;
}): React.JSX.Element {
  const status = step.status ?? 'todo';
  const name = [
    step.label,
    `step ${String(index + 1)} of ${String(count)}`,
    spoken[status],
    step.description,
  ]
    .filter(Boolean)
    .join(', ');
  const current = status === 'current' ? ({ 'aria-current': 'step' } as object) : {};
  if (status === 'done' && step.onPress) {
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={name}
        onPress={step.onPress}
        className={cn(
          className,
          'rounded-[10px] active:opacity-70',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
        )}
      >
        {children}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={name} {...current} className={className}>
      {children}
    </View>
  );
}

export function Stepper({
  steps,
  orientation = 'vertical',
  label = 'Progress',
  className,
}: StepperProps): React.JSX.Element {
  const vertical = orientation === 'vertical';
  return (
    <View
      {...({ role: 'list', 'aria-label': label } as object)}
      className={cn(vertical ? 'flex-col' : 'w-full flex-row items-start gap-2', className)}
    >
      {steps.map((step, index) => {
        const status = step.status ?? 'todo';
        const last = index === steps.length - 1;
        const muted = status === 'todo';
        const description = step.description ? (
          <Text
            variant={vertical ? 'subhead' : 'caption'}
            tone={
              status === 'failed'
                ? 'danger'
                : step.onPress && status === 'done'
                  ? 'accent'
                  : 'muted'
            }
            className="font-normal leading-[1.4]"
          >
            {step.description}
          </Text>
        ) : null;
        return (
          <View
            key={`${step.label}-${String(index)}`}
            {...({ role: 'listitem' } as object)}
            className={cn(!vertical && 'min-w-0 flex-1')}
          >
            {vertical ? (
              <Step step={step} index={index} count={steps.length} className="flex-row gap-3.5">
                <View className="items-center">
                  <Marker status={status} index={index} />
                  {last ? null : <Connector done={status === 'done'} vertical />}
                </View>
                <View className={cn('min-w-0 flex-1 gap-0.5 pt-1', !last && 'pb-[18px]')}>
                  <Text
                    weight="semibold"
                    tone={muted ? 'muted' : 'default'}
                    className="leading-[1.4]"
                  >
                    {step.label}
                  </Text>
                  {description}
                </View>
              </Step>
            ) : (
              <Step step={step} index={index} count={steps.length} className="gap-2">
                <View className="flex-row items-center gap-2">
                  <Marker status={status} index={index} />
                  {last ? null : <Connector done={status === 'done'} vertical={false} />}
                </View>
                <Text
                  variant="subhead"
                  weight="semibold"
                  tone={muted ? 'muted' : 'default'}
                  className="leading-[1.3]"
                >
                  {step.label}
                </Text>
                {description}
              </Step>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** The phone's stepper above a form: a bar and "2 of 3". */
export function StepperProgress({
  step,
  count,
  label,
  className,
}: {
  /** The step you are on, from 1. */
  step: number;
  count: number;
  /** What is in progress, read before the count: "Request time off". */
  label?: string;
  className?: string | undefined;
}): React.JSX.Element {
  const reading = `${String(step)} of ${String(count)}`;
  return (
    <View className={cn('flex-row items-center gap-2.5', className)}>
      <View className="flex-1">
        <Progress
          value={step}
          max={count}
          hideLabel
          label={label ? `${label}, step ${reading}` : `Step ${reading}`}
          valueLabel={reading}
        />
      </View>
      <Text variant="footnote" weight="semibold" tabular aria-hidden>
        {reading}
      </Text>
    </View>
  );
}

/** Dots for a short carousel whose steps have no names. */
export function StepperDots({
  count,
  current,
  className,
}: {
  count: number;
  /** The step showing, from 0. */
  current: number;
  className?: string | undefined;
}): React.JSX.Element {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Step ${String(current + 1)} of ${String(count)}`}
      className={cn('flex-row items-center justify-center gap-2', className)}
    >
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          className={cn(
            'h-2 rounded-full',
            index === current ? 'w-7 bg-accent' : 'w-2',
            index < current && 'bg-accent opacity-45',
            index > current && 'bg-surface-active',
          )}
        />
      ))}
    </View>
  );
}
