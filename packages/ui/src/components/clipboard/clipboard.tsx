'use client';

import { Check, Copy, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { Button, type ButtonProps } from '../button/button';
import { Tooltip } from '../tooltip/tooltip';

/**
 * Copy to clipboard.
 *
 * ### Why this is not three lines at the call site
 *
 * `navigator.clipboard.writeText` is the easy part. The parts that get skipped:
 *
 * - **It rejects.** Outside a secure context (`http://` on a colleague's
 *   laptop), inside a cross-origin iframe without the permission, or when the
 *   user denies it, the promise rejects and the naive version silently claims
 *   success. This reports the failure and offers the fallback.
 * - **It must be a user gesture.** Copying from an effect or a timeout is
 *   blocked by every browser. The hook only exposes a function you call from a
 *   handler.
 * - **Confirmation has to be announced.** A checkmark that swaps in for two
 *   seconds tells a sighted user it worked and tells a screen-reader user
 *   nothing. The state change goes through a live region.
 * - **The label must not change size.** A button whose text goes from "Copy" to
 *   "Copied" reflows the row under the cursor. The two labels are stacked and
 *   cross-faded in a box sized to the wider one.
 */

export type ClipboardStatus = 'idle' | 'copied' | 'error';

export interface UseClipboardOptions {
  /** Milliseconds before the confirmation reverts. */
  resetAfter?: number;
  onCopy?: (text: string) => void;
  onError?: (error: unknown) => void;
  /**
   * The write itself. Defaults to `navigator.clipboard.writeText`.
   *
   * A seam, not a feature: the refusal path is the half that matters and it
   * cannot be reached in an environment where the clipboard always works.
   * Injecting the writer is how that state gets exercised, the same reason
   * the domain layer injects a `Clock`.
   */
  write?: (text: string) => Promise<void>;
}

export interface UseClipboardResult {
  status: ClipboardStatus;
  /** Call from a click handler. Returns whether the write succeeded. */
  copy: (text: string) => Promise<boolean>;
  reset: () => void;
}

/**
 * The mechanism, without the button. Reach for this when the affordance is
 * something other than a button, a whole row, a code block, a keyboard
 * shortcut.
 */
export function useClipboard({
  resetAfter = 2000,
  onCopy,
  onError,
  write,
}: UseClipboardOptions = {}): UseClipboardResult {
  const [status, setStatus] = useState<ClipboardStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      clear();
      try {
        // The DOM types declare `navigator.clipboard` as always present. It is
        // not: on an insecure origin the property is simply absent, which is
        // the single most common way this fails on an internal tool.
        //
        // The `in` test is what makes this honest rather than asserted. The
        // ternary's type is the union of its branches, so the optionality comes
        // from a check that actually runs, not from a claim about the lib.
        const api = 'clipboard' in navigator ? navigator.clipboard : undefined;
        if (write) await write(text);
        else if (api) await api.writeText(text);
        else throw new Error('Clipboard API unavailable.');
        setStatus('copied');
        onCopy?.(text);
        timer.current = setTimeout(() => {
          setStatus('idle');
        }, resetAfter);
        return true;
      } catch (error) {
        // No `execCommand` fallback. It is deprecated. It needs a temporary
        // DOM node that fights focus management, and it fails in the same
        // contexts for the same reasons. Reporting the failure so the user can
        // select the text themselves is more honest than a fallback that also
        // silently does nothing.
        setStatus('error');
        onError?.(error);
        timer.current = setTimeout(() => {
          setStatus('idle');
        }, resetAfter);
        return false;
      }
    },
    [clear, onCopy, onError, resetAfter, write],
  );

  const reset = useCallback(() => {
    clear();
    setStatus('idle');
  }, [clear]);

  return { status, copy, reset };
}

export interface CopyButtonProps extends Omit<ButtonProps, 'onCopy' | 'children'> {
  /** The text to put on the clipboard. */
  value: string;
  /** Visible label. Omit for an icon-only button, it still gets an accessible name. */
  children?: ReactNode;
  /** Accessible name, and the tooltip when the button is icon-only. */
  label?: string;
  copiedLabel?: string;
  errorLabel?: string;
  resetAfter?: number;
  onCopy?: (text: string) => void;
  /** Wraps an icon-only button in a tooltip. Ignored when there is a visible label. */
  tooltip?: boolean;
}

export function CopyButton({
  value,
  children,
  label = 'Copy',
  copiedLabel = 'Copied',
  errorLabel = 'Press ⌘C to copy',
  resetAfter = 2000,
  onCopy,
  tooltip = true,
  className,
  variant = 'ghost',
  size = 'sm',
  ...props
}: CopyButtonProps): JSX.Element {
  const { status, copy } = useClipboard({ resetAfter, ...(onCopy ? { onCopy } : {}) });
  const iconOnly = !children;

  const button = (
    <Button
      variant={variant}
      size={size}
      aria-label={iconOnly ? label : undefined}
      onClick={() => {
        void copy(value);
      }}
      className={cn('relative', className)}
      startIcon={
        // A fixed-size box with both glyphs stacked: swapping the icon in place
        // keeps the button from resizing under the pointer mid-click.
        <span className="relative grid size-4 place-items-center">
          <Copy
            aria-hidden
            className={cn(
              'absolute transition-[opacity,transform] duration-(--animate-duration-fast) ease-standard',
              status === 'idle' ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
          />
          <Check
            aria-hidden
            className={cn(
              'absolute text-success-fg transition-[opacity,transform] duration-(--animate-duration-fast) ease-standard',
              status === 'copied' ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
          />
          <X
            aria-hidden
            className={cn(
              'absolute text-danger-fg transition-[opacity,transform] duration-(--animate-duration-fast) ease-standard',
              status === 'error' ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
            )}
          />
        </span>
      }
      {...props}
    >
      {children ? (
        <span className="relative inline-grid">
          {/* Both labels occupy the same cell, so the wider one sets the width
              and nothing reflows when the state changes. */}
          <span
            className={cn(
              'col-start-1 row-start-1 transition-opacity duration-(--animate-duration-fast)',
              status === 'idle' ? 'opacity-100' : 'opacity-0',
            )}
          >
            {children}
          </span>
          <span
            aria-hidden
            className={cn(
              'col-start-1 row-start-1 transition-opacity duration-(--animate-duration-fast)',
              status === 'copied' ? 'opacity-100' : 'opacity-0',
            )}
          >
            {copiedLabel}
          </span>
        </span>
      ) : null}
      {/* The announcement. Polite, and only on a change, so it never talks over
          whatever the user was already hearing. */}
      <span aria-live="polite" className="sr-only">
        {status === 'copied' ? copiedLabel : status === 'error' ? errorLabel : ''}
      </span>
    </Button>
  );

  if (iconOnly && tooltip) {
    return (
      <Tooltip
        content={status === 'copied' ? copiedLabel : status === 'error' ? errorLabel : label}
      >
        {button}
      </Tooltip>
    );
  }
  return button;
}

export interface CopyFieldProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  value: string;
  /** Renders a shortened form while keeping the full value on the clipboard. */
  display?: ReactNode;
  label?: string;
  /** Monospace, for an id, a token or an IBAN. */
  mono?: boolean;
  size?: 'sm' | 'md';
}

/**
 * A read-only value with a copy control on the end.
 *
 * The value is selectable text, not an `<input readonly>`: an input is
 * announced as an editable field the user then cannot edit, and it takes a tab
 * stop away from the button that does the actual work.
 */
export function CopyField({
  className,
  value,
  display,
  label = 'Copy value',
  mono = true,
  size = 'md',
  ...props
}: CopyFieldProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-md border border-border bg-surface-sunken ps-3 pe-1',
        size === 'sm' ? 'h-control-sm text-xs' : 'h-control-md text-base',
        className,
      )}
      {...props}
    >
      <span className={cn('min-w-0 flex-1 truncate text-fg', mono && 'font-mono text-xs')}>
        {display ?? value}
      </span>
      <CopyButton value={value} label={label} size="sm" />
    </div>
  );
}
