'use client';

import { useRef, useState, type DragEvent, type JSX, type ReactNode } from 'react';
import { Upload } from 'lucide-react';

import { cn } from '../../lib/cn';

/**
 * A surface that accepts a dropped file.
 *
 * The bare drop target: no queue, no progress, no validation UI.
 * {@link FileUploader} is the full experience built on this idea; reach for
 * `Dropzone` when the drop *is* the interaction: dropping a CSV onto an import
 * screen, a photo onto a profile row, a payslip onto a case.
 *
 * ### A drop target must also be a button
 *
 * Dragging a file is a pointer gesture with no keyboard equivalent, so the zone
 * is a real `<button>` that opens the file picker. Without it the feature does
 * not exist for anybody navigating by keyboard, and it is also how most people
 * on a laptop trackpad prefer to do it anyway.
 *
 * ### The counter, not the boolean
 *
 * `dragenter` and `dragleave` fire for every child element the pointer crosses,
 * so a boolean flag flickers the highlight as the pointer moves over the
 * contents. A depth counter is the fix: increment on enter, decrement on leave,
 * highlight while it is above zero.
 *
 * ### `accept` is a filter, not a check
 *
 * It sets the file picker's filter and rejects obviously wrong drops early,
 * which is a courtesy to the person, not a security control. An extension is a
 * string somebody chose and a browser-reported MIME type is a guess. The server
 * has to derive the real type from the bytes.
 */

export interface DropzoneProps {
  /** Fires with the accepted files. Never fires with an empty list. */
  onFiles: (files: File[]) => void;
  /** A comma-separated `accept` list, e.g. `'.csv,text/csv'`. */
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  /** Names the control. Also the visible heading unless `children` replaces it. */
  label: string;
  /** One line under the label, what to drop, and how big it may be. */
  hint?: ReactNode;
  /** Replaces the whole inside. The border, the states and the picker remain. */
  children?: ReactNode;
  /** A compact bar rather than a panel: for a drop target inside a row. */
  variant?: 'panel' | 'inline';
  /** Shown instead of the hint while something unusable is over the zone. */
  rejectMessage?: string;
  className?: string;
}

/** Does a dragged item stand a chance of being accepted? */
function looksAcceptable(accept: string | undefined, items: DataTransferItemList): boolean {
  if (accept === undefined) return true;
  const patterns = accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  // During a drag the browser exposes the MIME type and nothing else, no name,
  // no size. Extension patterns therefore cannot be judged yet, so anything
  // with an extension rule is allowed through and checked on drop.
  const extensionOnly = patterns.every((pattern) => pattern.startsWith('.'));
  if (extensionOnly) return true;

  return [...items].some((item) => {
    if (item.kind !== 'file') return false;
    const type = item.type.toLowerCase();
    return patterns.some((pattern) => {
      if (pattern.startsWith('.')) return true;
      if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
      return type === pattern;
    });
  });
}

function matches(accept: string | undefined, file: File): boolean {
  if (accept === undefined) return true;
  const patterns = accept
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (patterns.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

export function Dropzone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  label,
  hint,
  children,
  variant = 'panel',
  rejectMessage = 'That file type is not accepted here',
  className,
}: DropzoneProps): JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  // A counter, not a boolean: `dragleave` fires for every child crossed.
  const depth = useRef(0);
  const [over, setOver] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const accepted = (list: FileList | null): void => {
    const files = [...(list ?? [])].filter((file) => matches(accept, file));
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  const onDragEnter = (event: DragEvent<HTMLElement>): void => {
    if (disabled) return;
    event.preventDefault();
    depth.current += 1;
    setOver(true);
    setRejecting(!looksAcceptable(accept, event.dataTransfer.items));
  };

  const onDragLeave = (): void => {
    depth.current = Math.max(depth.current - 1, 0);
    if (depth.current === 0) {
      setOver(false);
      setRejecting(false);
    }
  };

  const reset = (): void => {
    depth.current = 0;
    setOver(false);
    setRejecting(false);
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        if (disabled) return;
        // Without this the browser navigates to the file instead of dropping it,
        // the single most common reason a drop target "does nothing".
        event.preventDefault();
        event.dataTransfer.dropEffect = rejecting ? 'none' : 'copy';
      }}
      onDragLeave={onDragLeave}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        reset();
        accepted(event.dataTransfer.files);
      }}
      className={cn('min-w-0', className)}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={() => {
          input.current?.click();
        }}
        className={cn(
          'flex w-full items-center rounded-md border-2 border-dashed text-start',
          'transition-[background-color,border-color] duration-(--animate-duration-fast)',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus',
          variant === 'panel' ? 'flex-col justify-center gap-2 px-6 py-8' : 'gap-3 px-3 py-2',
          disabled
            ? 'cursor-not-allowed border-border bg-surface-sunken opacity-60'
            : 'cursor-pointer border-border hover:border-accent hover:bg-accent-subtle/40',
          over && !rejecting && 'border-accent bg-accent-subtle',
          rejecting && 'border-danger bg-danger-subtle',
        )}
      >
        {children ?? (
          <>
            <Upload
              aria-hidden
              className={cn(
                'shrink-0 text-fg-subtle',
                variant === 'panel' ? 'size-6' : 'size-4',
                over && !rejecting && 'text-accent-fg',
                rejecting && 'text-danger-fg',
              )}
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-fg">{label}</span>
              {/* The reject message replaces the hint rather than joining it:
                  two lines of instruction at the moment of a drop is one too
                  many to read. */}
              <span
                className={cn(
                  'block truncate text-xs',
                  rejecting ? 'text-danger-fg' : 'text-fg-muted',
                )}
              >
                {rejecting ? rejectMessage : (hint ?? 'Drop a file here, or click to browse')}
              </span>
            </span>
          </>
        )}
      </button>

      <input
        ref={input}
        type="file"
        className="sr-only"
        tabIndex={-1}
        {...(accept === undefined ? {} : { accept })}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          accepted(event.target.files);
          // Cleared so choosing the same file twice in a row still fires.
          event.target.value = '';
        }}
      />

      {/* Announced rather than only coloured. A border turning red is not an
          error message. */}
      <p aria-live="polite" className="sr-only">
        {over ? (rejecting ? rejectMessage : 'Release to drop the file') : ''}
      </p>
    </div>
  );
}
