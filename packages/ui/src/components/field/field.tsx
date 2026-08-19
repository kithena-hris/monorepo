'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { Slot } from '@radix-ui/react-slot';
import { createContext, useContext, useId } from 'react';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { cn } from '../../lib/cn';

/**
 * Form field wiring.
 *
 * The accessible name, the description and the error message all have to be
 * associated with the control by id. Doing that by hand at every call site is
 * how a form ends up with three of its nine fields wired correctly, so the
 * association is generated here and the control only has to opt in via
 * `FieldControl`.
 */

interface FieldContextValue {
  controlId: string;
  descriptionId: string;
  errorId: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

function useField(component: string): FieldContextValue {
  const context = useContext(FieldContext);
  if (!context) {
    throw new Error(`<${component}> must be rendered inside a <Field>.`);
  }
  return context;
}

export interface FieldProps extends ComponentPropsWithoutRef<'div'> {
  /** Marks the control invalid and reveals `FieldError`. */
  invalid?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Lay the label out beside the control instead of above it. */
  orientation?: 'vertical' | 'horizontal';
}

export function Field({
  className,
  invalid = false,
  required = false,
  disabled = false,
  orientation = 'vertical',
  ...props
}: FieldProps): JSX.Element {
  const id = useId();

  return (
    <FieldContext
      value={{
        controlId: `${id}-control`,
        descriptionId: `${id}-description`,
        errorId: `${id}-error`,
        invalid,
        required,
        disabled,
      }}
    >
      <div
        data-orientation={orientation}
        data-invalid={invalid || undefined}
        data-disabled={disabled || undefined}
        className={cn(
          'group/field flex gap-1.5',
          orientation === 'vertical' ? 'flex-col' : 'flex-row items-center justify-between gap-4',
          className,
        )}
        {...props}
      />
    </FieldContext>
  );
}

export type FieldLabelProps = ComponentPropsWithoutRef<typeof LabelPrimitive.Root>;

export function FieldLabel({ className, children, ...props }: FieldLabelProps): JSX.Element {
  const { controlId, required, disabled } = useField('FieldLabel');

  return (
    <LabelPrimitive.Root
      htmlFor={controlId}
      className={cn(
        'flex items-center gap-1 text-sm leading-none font-medium text-fg',
        disabled && 'text-fg-disabled',
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        // Colour alone cannot carry "required", so the asterisk is real text
        // with an accessible label rather than a decorative glyph.
        <span className="text-danger" aria-hidden="true">
          *
        </span>
      ) : null}
      {required ? <span className="sr-only">(required)</span> : null}
    </LabelPrimitive.Root>
  );
}

export function FieldDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<'p'>): JSX.Element {
  const { descriptionId } = useField('FieldDescription');
  return <p id={descriptionId} className={cn('text-xs text-fg-muted', className)} {...props} />;
}

/**
 * Rendered only while the field is invalid, and announced politely rather than
 * assertively, a validation message that interrupts on every keystroke is
 * worse than no message at all.
 */
export function FieldError({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<'p'>): JSX.Element | null {
  const { errorId, invalid } = useField('FieldError');
  if (!invalid || !children) return null;

  return (
    <p
      id={errorId}
      role="alert"
      aria-live="polite"
      className={cn('text-xs font-medium text-danger-fg', className)}
      {...props}
    >
      {children}
    </p>
  );
}

export interface FieldControlProps {
  children: ReactNode;
}

/** Injects the generated id and ARIA associations onto whatever it wraps. */
export function FieldControl({ children }: FieldControlProps): JSX.Element {
  const { controlId, descriptionId, errorId, invalid, required, disabled } =
    useField('FieldControl');

  // `Slot` is typed for generic HTML attributes, which do not include
  // `disabled`, that lives on the form elements this actually wraps. Declaring
  // the extra member rather than asserting the whole object keeps the other
  // five properties checked against `Slot`, where the cast silently accepted
  // anything at all.
  const controlProps: ComponentPropsWithoutRef<typeof Slot> & {
    'aria-invalid'?: true | undefined;
    'aria-required'?: true | undefined;
    disabled?: true | undefined;
  } = {
    id: controlId,
    'aria-describedby': invalid ? `${descriptionId} ${errorId}` : descriptionId,
    'aria-invalid': invalid || undefined,
    'aria-required': required || undefined,
    disabled: disabled || undefined,
  };

  return <Slot {...controlProps}>{children}</Slot>;
}
