import { cva, type VariantProps } from 'class-variance-authority';
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  HTMLInputTypeAttribute,
  JSX,
  ReactNode,
} from 'react';

import { cn } from '../../lib/cn';

const inputShell = cva(
  [
    'flex items-center gap-2 w-full',
    'bg-surface text-fg border border-border rounded-md shadow-xs',
    'transition-[border-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
    'has-[input:focus-visible]:border-border-focus',
    'has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-border-focus/30',
    'has-[input:disabled]:bg-surface-sunken has-[input:disabled]:text-fg-disabled',
    'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:shadow-none',
    'has-[input[aria-invalid]]:border-danger has-[input[aria-invalid]]:ring-danger/25',
  ],
  {
    variants: {
      size: {
        sm: 'h-control-sm px-2.5 text-xs',
        md: 'h-control-md px-3 text-base',
        lg: 'h-control-lg px-3.5 text-md',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  // `WithRef`: a field that wraps this one has to be able to return focus to
  // the input after clearing it, and React 19 passes `ref` as a plain prop.
  extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'prefix'>, VariantProps<typeof inputShell> {
  /** Decorative or affordance content pinned to the leading edge. */
  startAdornment?: ReactNode;
  /** Trailing content, a unit, a clear button, a validation tick. */
  endAdornment?: ReactNode;
  /** Applied to the outer shell; `className` still lands on the `<input>`. */
  containerClassName?: string;
}

/**
 * What a browser, a password manager and an on-screen keyboard need to get a
 * field right: beyond `type`, which on its own gets none of it.
 *
 * `type="email"` picks the validation rules. It does **not** bring up the
 * keyboard with the `@` on it, stop iOS capitalising the first letter, stop
 * autocorrect rewriting the domain, or tell a password manager what to fill.
 * Those are four more attributes. They are the difference between a form that
 * works on a phone and one that fights it, and nobody remembers all four.
 *
 * So the type carries them. Anything passed explicitly still wins. This is a
 * default, not a policy.
 */
interface DeviceProfile {
  inputMode?: ComponentPropsWithoutRef<'input'>['inputMode'];
  autoComplete?: string;
  enterKeyHint?: ComponentPropsWithoutRef<'input'>['enterKeyHint'];
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck?: boolean;
}

/** The four attributes every "identifier" field wants and no `type` supplies. */
const verbatim = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false } as const;

const deviceProfiles: Partial<Record<HTMLInputTypeAttribute, DeviceProfile>> = {
  email: { inputMode: 'email', autoComplete: 'email', enterKeyHint: 'next', ...verbatim },
  tel: { inputMode: 'tel', autoComplete: 'tel', enterKeyHint: 'next', ...verbatim },
  url: { inputMode: 'url', autoComplete: 'url', enterKeyHint: 'go', ...verbatim },
  search: { inputMode: 'search', enterKeyHint: 'search', ...verbatim },
  // `numeric` rather than `decimal`: a whole-number field that offers a decimal
  // point invites a value it will then reject.
  number: { inputMode: 'numeric', ...verbatim },
  password: { autoComplete: 'current-password', ...verbatim },
  date: { autoComplete: 'off' },
  time: { autoComplete: 'off' },
};

/**
 * Single-line text control.
 *
 * The focus ring is drawn on the shell rather than the input, so an adornment
 * sits inside the focus outline instead of beside it.
 *
 * ### The type sets up the device
 *
 * `type` selects a profile of `inputMode`, `autoComplete`, `enterKeyHint`,
 * `autoCapitalize`, `autoCorrect` and `spellCheck`: see {@link DeviceProfile}
 * for why the type alone is not enough. Pass any of them yourself to override.
 *
 * For a number people *edit* rather than type once, reach for `NumberField`:
 * `type="number"` scrolls its value when the wheel passes over it, rejects
 * leading zeros, and reports an empty string for anything it cannot parse.
 */
export function Input({
  className,
  containerClassName,
  size,
  startAdornment,
  endAdornment,
  type = 'text',
  ...props
}: InputProps): JSX.Element {
  // Profile first, caller second: an explicit `autoComplete="off"` on a search
  // box has to survive contact with the default.
  const profile = deviceProfiles[type] ?? {};

  return (
    <div className={cn(inputShell({ size }), containerClassName)}>
      {startAdornment ? (
        <span className="flex shrink-0 items-center text-fg-subtle [&_svg]:size-4">
          {startAdornment}
        </span>
      ) : null}
      <input
        type={type}
        {...profile}
        className={cn(
          'peer w-full min-w-0 bg-transparent text-inherit outline-none',
          'placeholder:text-fg-subtle',
          'disabled:cursor-not-allowed',
          // Chrome's autofill repaints the background; keep the token colour.
          'autofill:shadow-[inset_0_0_0_1000px_var(--reach-color-surface)]',
          className,
        )}
        {...props}
      />
      {endAdornment ? (
        <span className="flex shrink-0 items-center text-fg-subtle [&_svg]:size-4">
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
}

export interface TextareaProps extends ComponentPropsWithoutRef<'textarea'> {
  /** Grow with content instead of scrolling, via CSS `field-sizing`. */
  autoResize?: boolean;
}

export function Textarea({
  className,
  autoResize = false,
  rows = 4,
  ...props
}: TextareaProps): JSX.Element {
  return (
    <textarea
      rows={rows}
      className={cn(
        'w-full rounded-md border border-border bg-surface px-3 py-2 text-base text-fg shadow-xs',
        'transition-[border-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
        'placeholder:text-fg-subtle',
        'focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-border-focus/30',
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-fg-disabled',
        'aria-invalid:border-danger aria-invalid:ring-danger/25',
        autoResize ? 'field-sizing-content resize-none' : 'resize-y',
        className,
      )}
      {...props}
    />
  );
}
