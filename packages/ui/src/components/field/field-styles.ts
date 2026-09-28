import { cva } from 'class-variance-authority';

/**
 * The look every text-like control shares: Input, Textarea, Select's trigger,
 * Combobox, NumberField, PasswordField, TagsInput, DatePicker, TimePicker.
 *
 * A field is filled, not outlined. It rests on `surface-sunken` with no
 * border, lifts to `surface` with a 2px accent ring while focused, and an
 * invalid one carries a 2px danger ring instead. The ring is inset, so a
 * focused field in a tight grid never overlaps its neighbour.
 *
 * State is read from the element itself (`aria-invalid`, `disabled`) or from
 * `data-invalid` / `data-disabled` on a shell that wraps the real control;
 * `fieldShellHas` adds the `:has()` form for a shell around a bare `<input>`.
 */
export const fieldShell = cva(
  [
    'relative flex w-full items-center gap-2.5 bg-surface-sunken text-fg',
    'transition-[background-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
    'hover:not-focus-within:bg-surface-hover',
    'focus-within:bg-surface focus-within:ring-2 focus-within:ring-accent focus-within:ring-inset',
    'aria-invalid:ring-2 aria-invalid:ring-danger aria-invalid:ring-inset',
    'data-invalid:ring-2 data-invalid:ring-danger data-invalid:ring-inset',
    'disabled:pointer-events-none disabled:opacity-50',
    'data-disabled:pointer-events-none data-disabled:opacity-50',
    // Caution: a value that is allowed but unusual, flagged by a warning
    // `FieldDescription` in the same field. A ring, never a block.
    'group-has-[[data-caution]]/field:ring-2 group-has-[[data-caution]]/field:ring-warning group-has-[[data-caution]]/field:ring-inset',
    // Radius follows the pointer: 12px at a desk, 10px for the small size,
    // 16px under a thumb whatever the size.
    'touch:rounded-[1rem]',
  ],
  {
    variants: {
      size: {
        sm: 'h-control-sm rounded-[0.625rem] px-3 text-sm',
        md: 'h-field rounded-[0.75rem] px-3 text-base touch:px-4',
        lg: 'h-control-lg rounded-[0.75rem] px-3.5 text-base touch:px-4',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

/** The same states, for a shell whose control is a bare `<input>` inside it. */
export const fieldShellHas = [
  'has-[[aria-invalid=true]]:ring-2 has-[[aria-invalid=true]]:ring-danger has-[[aria-invalid=true]]:ring-inset',
  'has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-50',
  // Read-only is a value to read, not a field to fill: no fill, a hairline.
  'has-[input[readonly]]:bg-transparent has-[input[readonly]]:ring-1 has-[input[readonly]]:ring-border has-[input[readonly]]:ring-inset',
].join(' ');

/*
 * The floating label.
 *
 * Under a thumb a single-line field is 56px tall and its label moves inside
 * it, above the value: the label, the field and the target become one thing.
 * It is pure CSS. A shell that can carry the label says so with `data-float`;
 * the field root (`group/field`) becomes a one-cell grid when it has such a
 * child, the label and the shell share that cell, and the value inside the
 * shell drops by the height of the label. Description and error flow into
 * the rows below. At a desk none of this applies.
 */

/** On a field root that is also `group/field`. */
export const floatRoot =
  'touch:has-[>[data-float]]:grid touch:has-[>[data-float]]:grid-cols-1 touch:has-[>[data-float]]:content-start';

/** On the label of that root. */
export const floatLabel = [
  'touch:group-has-[>[data-float]]/field:z-1 touch:group-has-[>[data-float]]/field:[grid-area:1/1]',
  'touch:group-has-[>[data-float]]/field:self-start touch:group-has-[>[data-float]]/field:mt-2.5',
  'touch:group-has-[>[data-float]]/field:px-4 touch:group-has-[>[data-float]]/field:text-xs',
  'touch:group-has-[>[data-float]]/field:font-medium touch:group-has-[>[data-float]]/field:text-fg-muted',
  'touch:group-has-[>[data-float]:focus-within]/field:text-accent-fg',
  'touch:group-has-[>[data-float][data-invalid]]/field:text-danger-fg',
  'touch:group-has-[>[data-float]_[aria-invalid=true]]/field:text-danger-fg',
].join(' ');

/** On the shell that carries the floating label, with `data-float`. */
export const floatShell = '[grid-area:1/1]';

/** On the value inside that shell: pushed below the label. */
export const floatValue = 'touch:group-has-[>[data-float]]/field:pt-[1.125rem]';

/** A field's label when it sits above the control. */
export const fieldLabelClass =
  'flex items-center gap-1 text-sm leading-tight font-semibold text-fg';

/** Help text under a field. */
export const fieldHintClass = 'text-sm text-fg-muted';

/** The error under a field. */
export const fieldErrorClass = 'text-sm text-danger-fg';
