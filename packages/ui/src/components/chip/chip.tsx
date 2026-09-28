'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, X } from 'lucide-react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * A compact, tappable value.
 *
 * Three jobs, one shape. A **filter chip** narrows a list and several can be
 * on at once. A **choice chip** picks exactly one, like a radio. An **input
 * chip** holds a value somebody typed or picked, and removes it. A dashed
 * **suggestion chip** offers a next step.
 *
 * Not a `Badge`. A badge reports a status and cannot be pressed; a chip can
 * always be pressed or removed. Putting a click handler on a badge gives a
 * sighted mouse user a control that a keyboard and a screen reader never find.
 */

const chip = cva(
  [
    'relative inline-flex shrink-0 items-center gap-1.5 rounded-full whitespace-nowrap',
    'h-7.5 ps-3 pe-3 touch:h-9',
    'text-sm font-medium select-none',
    'transition-[background-color,color,box-shadow,transform] duration-(--animate-duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
    'disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45',
    '[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        filled: [
          'bg-surface-sunken text-fg',
          'data-[selected]:bg-accent-subtle data-[selected]:text-accent-fg',
          'data-[state=on]:bg-accent-subtle data-[state=on]:text-accent-fg',
        ],
        // Transparent with an edge: an offer, not a value, so it must not read
        // as something already chosen.
        dashed:
          'bg-transparent text-fg-muted shadow-[inset_0_0_0_1.5px_var(--color-border-strong)]',
      },
      invalid: {
        true: 'bg-danger-subtle text-danger-fg shadow-[inset_0_0_0_1.5px_var(--color-danger)]',
        false: '',
      },
      interactive: {
        true: [
          'tap-target cursor-pointer active:scale-[0.97] motion-reduce:active:scale-100',
          'hover:bg-surface-hover data-[selected]:hover:bg-accent-subtle-hover data-[state=on]:hover:bg-accent-subtle-hover',
        ],
        false: '',
      },
    },
    defaultVariants: { variant: 'filled', invalid: false, interactive: true },
  },
);

interface ChipContentProps {
  /** An icon, or an `Avatar` at `size="xs"`, before the label. */
  startIcon?: ReactNode;
  /**
   * The name of the filter this chip holds, shown muted before its value:
   * "Team Engineering". Read as one phrase, so a screen reader hears both.
   */
  field?: ReactNode;
}

function ChipContent({
  startIcon,
  field,
  children,
}: ChipContentProps & { children?: ReactNode }): JSX.Element {
  return (
    <>
      {startIcon}
      {field ? <span className="text-fg-muted">{field}</span> : null}
      {children}
    </>
  );
}

export interface ChipProps
  extends
    Omit<ComponentPropsWithoutRef<'button'>, 'children'>,
    Omit<VariantProps<typeof chip>, 'interactive'>,
    ChipContentProps {
  children?: ReactNode;
  /**
   * The filter-chip state. Present, it makes the chip a toggle button
   * (`aria-pressed`) and draws a tick when on, so the state does not rest on
   * colour alone. Leave it out for a suggestion chip, which acts rather than
   * holds.
   *
   * With `onRemove` it is only the look of an applied value: a removable chip
   * is not itself pressable, its remove button is.
   */
  selected?: boolean;
  /**
   * Makes this an input chip: the value is shown and a trailing button removes
   * it. The chip body stops being a button, because one pill with two
   * different click targets inside it is a pill that removes things by
   * accident.
   */
  onRemove?: () => void;
  /** Names the remove button. Defaults to "Remove" and the chip's text. */
  removeLabel?: string;
  /**
   * With `onRemove`, lands on the remove button, the only focusable part. `-1`
   * suits a field that walks its chips with the arrow keys instead.
   */
  tabIndex?: number;
}

export function Chip({
  className,
  variant,
  invalid,
  selected,
  startIcon,
  field,
  onRemove,
  removeLabel,
  disabled,
  children,
  type,
  tabIndex,
  ...props
}: ChipProps): JSX.Element {
  if (onRemove) {
    const name =
      removeLabel ??
      `Remove ${[field, children].filter((part) => typeof part === 'string').join(' ')}`.trim();
    return (
      <span
        data-selected={selected || undefined}
        aria-disabled={disabled || undefined}
        className={cn(chip({ variant, invalid, interactive: false }), 'pe-1.5', className)}
      >
        <ChipContent startIcon={startIcon} field={field}>
          {children}
        </ChipContent>
        <button
          type="button"
          aria-label={name}
          disabled={disabled}
          tabIndex={tabIndex}
          onClick={onRemove}
          className={cn(
            'relative grid size-4.5 place-items-center rounded-full tap-target touch:size-6',
            'bg-[color-mix(in_oklch,currentColor_12%,transparent)] hover:bg-[color-mix(in_oklch,currentColor_22%,transparent)]',
            'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-border-focus',
            '[&_svg]:size-3',
          )}
        >
          <X aria-hidden="true" />
        </button>
      </span>
    );
  }

  return (
    <button
      type={type ?? 'button'}
      aria-pressed={selected}
      data-selected={selected || undefined}
      disabled={disabled}
      tabIndex={tabIndex}
      className={cn(chip({ variant, invalid }), className)}
      {...props}
    >
      {selected && !startIcon ? <Check aria-hidden="true" /> : null}
      <ChipContent startIcon={startIcon} field={field}>
        {children}
      </ChipContent>
    </button>
  );
}

/**
 * A set of chips with one shared value.
 *
 * `type="multiple"` is a row of filter chips: each is a toggle button and a
 * tick marks the ones that are on. `type="single"` is choice chips: Radix
 * renders a radio group, arrow keys move the choice, and no tick is drawn,
 * because exactly one is always on and the fill already says which.
 *
 * `scroll` keeps the row to one line under a finger and lets it scroll from
 * edge to edge, which is how a long filter row fits a phone. At a desk it
 * still wraps.
 */
export type ChipGroupProps = ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> & {
  scroll?: boolean;
};

export function ChipGroup({ className, scroll = false, ...props }: ChipGroupProps): JSX.Element {
  return (
    <ToggleGroupPrimitive.Root
      className={cn(
        'flex flex-wrap items-center gap-2',
        scroll &&
          'touch:flex-nowrap touch:overflow-x-auto touch:overscroll-x-contain touch:[scrollbar-width:none] touch:py-1',
        className,
      )}
      {...props}
    />
  );
}

export interface ChipGroupItemProps
  extends ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>, ChipContentProps {}

export function ChipGroupItem({
  className,
  startIcon,
  field,
  children,
  ...props
}: ChipGroupItemProps): JSX.Element {
  return (
    <ToggleGroupPrimitive.Item className={cn(chip(), 'group/chip', className)} {...props}>
      {/* Only a filter chip ticks. Radix renders a multiple-choice item as a
          toggle button (`aria-pressed`) and a single-choice one as a radio
          (`aria-checked`), where exactly one is on and the fill is enough. */}
      {startIcon ? null : (
        <Check aria-hidden="true" className="hidden group-aria-pressed/chip:block" />
      )}
      <ChipContent startIcon={startIcon} field={field}>
        {children}
      </ChipContent>
    </ToggleGroupPrimitive.Item>
  );
}
