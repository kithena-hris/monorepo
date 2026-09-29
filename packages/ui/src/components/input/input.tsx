import { CircleAlert } from 'lucide-react';
import type {
  ComponentPropsWithRef,
  ComponentPropsWithoutRef,
  HTMLInputTypeAttribute,
  JSX,
  ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { fieldShell, fieldShellHas, floatShell, floatValue } from '../field/field-styles';

export interface InputProps
  // `WithRef`: a field that wraps this one has to be able to return focus to
  // the input after clearing it, and React 19 passes `ref` as a plain prop.
  extends Omit<ComponentPropsWithRef<'input'>, 'size' | 'prefix'> {
  /** 32 / 40 / 48px at a desk; 44 / 56 / 56px under a thumb. */
  size?: 'sm' | 'md' | 'lg' | null;
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

  // Under a thumb a 56px field carries its label inside it (see
  // `field-styles`). A leading icon would sit where the label starts, so a
  // field with one keeps its label above.
  const float = size !== 'sm' && !startAdornment;

  return (
    <div
      data-float={float ? '' : undefined}
      className={cn(
        fieldShell({ size }),
        fieldShellHas,
        float && floatShell,
        'cursor-text',
        containerClassName,
      )}
    >
      {startAdornment ? (
        <span className="flex shrink-0 items-center text-fg-muted [&_svg]:size-[1.125rem]">
          {startAdornment}
        </span>
      ) : null}
      <input
        type={type}
        {...profile}
        className={cn(
          // The full height of the shell, so a tap on its padding lands in the field.
          'peer w-full min-w-0 self-stretch bg-transparent text-inherit outline-none',
          'placeholder:text-fg-subtle',
          'disabled:cursor-not-allowed read-only:cursor-default',
          // Chrome's autofill repaints the background; keep the fill.
          'autofill:shadow-[inset_0_0_0_1000px_var(--reach-color-surface-sunken)]',
          float && floatValue,
          className,
        )}
        {...props}
      />
      {/* The error carries an icon as well as a ring and a message, so the
          state never rests on colour alone. Shown by CSS from the input's own
          `aria-invalid`, which is what `FieldControl` sets. */}
      <CircleAlert
        aria-hidden
        className="hidden size-[1.125rem] shrink-0 text-danger-fg peer-aria-invalid:block"
      />
      {endAdornment ? (
        <span className="flex shrink-0 items-center text-fg-muted [&_svg]:size-[1.125rem]">
          {endAdornment}
        </span>
      ) : null}
    </div>
  );
}

// With its ref, as `Input` has: a caller focuses the box (a chat panel opening).
export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
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
        'block min-h-24 w-full rounded-[0.75rem] bg-surface-sunken px-3 py-2.5 text-base text-fg',
        'touch:min-h-28 touch:rounded-[1rem] touch:px-4',
        'transition-[background-color,box-shadow] duration-(--animate-duration-fast) ease-standard',
        'placeholder:text-fg-subtle',
        'hover:not-focus:bg-surface-hover',
        'focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'read-only:bg-transparent read-only:ring-1 read-only:ring-border read-only:ring-inset',
        'aria-invalid:ring-2 aria-invalid:ring-danger aria-invalid:ring-inset',
        autoResize ? 'field-sizing-content resize-none' : 'resize-y',
        className,
      )}
      {...props}
    />
  );
}
