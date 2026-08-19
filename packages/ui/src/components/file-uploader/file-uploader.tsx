'use client';

import {
  AlertTriangle,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Paperclip,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { safeLinkUrl } from '../../lib/safe-url';
import { Button } from '../button/button';
import { Progress } from '../progress/progress';

/**
 * File upload, for anything.
 *
 * ### Security: what this does, and what it explicitly does not
 *
 * Everything here is a **usability** filter. None of it is a security control,
 * and treating it as one is how a malicious file reaches a server:
 *
 * - `accept` is a hint to the file picker. It can be switched off in the
 *   dialog, and a drop bypasses it entirely.
 * - `File.type` is derived from the extension by the browser. Renaming
 *   `payload.exe` to `payload.pdf` changes it.
 * - A size check happens after the whole file is already in memory here, and
 *   says nothing about what is inside it.
 *
 * The server re-derives the type from the **magic bytes**, enforces the size
 * at the connection, stores the file outside the web root under a generated
 * name, and serves it back with `Content-Disposition: attachment` and a
 * restrictive `Content-Type`. This component's job is to stop a 40 MB TIFF
 * before it is uploaded, not to stop an attacker.
 *
 * Two things it *does* do, because they are display concerns and therefore
 * genuinely its business:
 *
 * - **Filenames are rendered as text**, so `<img onerror>` in a name is shown,
 *   not run. React does this; the component does not undo it.
 * - **The displayed name is stripped of path segments.** A directory upload or
 *   an old browser can hand back `../../etc/passwd`, and echoing that back
 *   into the interface teaches the user the wrong thing about what was
 *   uploaded. The original `File` is untouched: sanitising the *stored* name
 *   is the server's job.
 *
 * ### Accessibility
 *
 * A real `<input type="file">` does the work: it is what Tab reaches, what
 * Space activates, what assistive tech announces, and what a phone turns into
 * a camera. The drop zone sits behind it and is decoration: dropping is a
 * shortcut, never the only way in.
 *
 * Each file is a list item with its own status and its own labelled controls
 * ("Remove contract.pdf", never "Remove"). Additions, rejections, completions
 * and failures all go through one polite live region, because a list that
 * changes silently is a list a screen-reader user has to re-read from the top.
 */

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  file: File;
  status: UploadStatus;
  /** 0–100 while uploading, or `null` when the length is unknown. */
  progress?: number | null;
  /** Shown under the row when `status` is `error`. Say what to do next. */
  error?: string;
  /** Where it landed. Turns the name into a link once it is `done`. */
  url?: string;
}

export interface FileRejection {
  file: File;
  reason: 'type' | 'size' | 'count' | 'total' | 'duplicate' | 'custom';
  message: string;
}

export interface FileUploaderProps {
  /** The list. Controlled, this component never owns it. */
  value: readonly UploadItem[];
  onChange: (items: readonly UploadItem[]) => void;
  /** Required. A file input with no label is an unnamed button. */
  label: string;
  hint?: ReactNode;
  /**
   * Accepted types, as MIME types or extensions. `['application/pdf', '.csv']`.
   * A hint to the picker and the first check here. **Not a security control.**
   */
  accept?: readonly string[];
  /** Bytes, per file. */
  maxSize?: number;
  /** Bytes, across the whole list. The limit a server actually enforces. */
  maxTotalSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  /** Extra per-file check. Return a message to reject. */
  validate?: (file: File) => string | null;
  /** Called with the files that passed. Start the upload here. */
  onAccepted?: (files: readonly File[]) => void;
  /** Called with everything refused, so the screen can explain or log it. */
  onReject?: (rejections: readonly FileRejection[]) => void;
  /** Shown on a failed row. Without it, a failure is a dead end. */
  onRetry?: (item: UploadItem) => void;
  /** Fires before the item leaves the list: abort the request here. */
  onRemove?: (item: UploadItem) => void;
  /** `dropzone` is the full target; `button` is a single control for a toolbar. */
  variant?: 'dropzone' | 'button';
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}

const extensionIcon: Record<string, typeof FileIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  csv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  webp: FileImage,
  zip: FileArchive,
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Path segments removed before display. A directory upload hands back
 * `folder/file.pdf`, and a hostile name can contain `../`; echoing either into
 * the interface misrepresents what was uploaded. The `File` itself is
 * untouched, the stored name is the server's decision.
 */
export function displayName(name: string): string {
  return name.split(/[\\/]/).pop() ?? name;
}

function extensionOf(name: string): string {
  const parts = displayName(name).split('.');
  return parts.length > 1 ? (parts.pop()?.toLowerCase() ?? '') : '';
}

/** `accept` matching, for the first pass only. See the docblock. */
function matchesAccept(file: File, accept: readonly string[]): boolean {
  if (accept.length === 0) return true;
  const extension = `.${extensionOf(file.name)}`;
  return accept.some((entry) => {
    if (entry.startsWith('.')) return entry.toLowerCase() === extension;
    if (entry.endsWith('/*')) return file.type.startsWith(entry.slice(0, -1));
    return entry === file.type;
  });
}

export function FileUploader({
  value,
  onChange,
  label,
  hint,
  accept = [],
  maxSize = 10 * 1024 * 1024,
  maxTotalSize,
  maxFiles = 10,
  multiple = true,
  validate,
  onAccepted,
  onReject,
  onRetry,
  onRemove,
  variant = 'dropzone',
  disabled = false,
  invalid = false,
  className,
}: FileUploaderProps): JSX.Element {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState<readonly FileRejection[]>([]);
  const [announcement, setAnnouncement] = useState('');

  const usedBytes = value.reduce((sum, item) => sum + item.file.size, 0);
  const full = value.length >= maxFiles;

  const accepted = useCallback(
    (incoming: readonly File[]): void => {
      const passed: File[] = [];
      const failed: FileRejection[] = [];
      let running = usedBytes;

      for (const file of incoming) {
        if (value.length + passed.length >= maxFiles) {
          failed.push({
            file,
            reason: 'count',
            message: `Only ${String(maxFiles)} ${maxFiles === 1 ? 'file' : 'files'} allowed.`,
          });
          continue;
        }
        if (!matchesAccept(file, accept)) {
          failed.push({
            file,
            reason: 'type',
            message: `${displayName(file.name)} is not an accepted type. Allowed: ${accept.join(', ')}.`,
          });
          continue;
        }
        if (file.size > maxSize) {
          failed.push({
            file,
            reason: 'size',
            message: `${displayName(file.name)} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)} per file.`,
          });
          continue;
        }
        if (maxTotalSize !== undefined && running + file.size > maxTotalSize) {
          failed.push({
            file,
            reason: 'total',
            message: `Adding ${displayName(file.name)} would exceed the ${formatBytes(maxTotalSize)} total.`,
          });
          continue;
        }
        // Name plus size plus mtime: the closest thing to an identity a `File`
        // has, and enough to catch the same file dropped twice.
        if (
          value.some(
            (item) =>
              item.file.name === file.name &&
              item.file.size === file.size &&
              item.file.lastModified === file.lastModified,
          )
        ) {
          failed.push({
            file,
            reason: 'duplicate',
            message: `${displayName(file.name)} has already been added.`,
          });
          continue;
        }
        const custom = validate?.(file);
        if (custom !== null && custom !== undefined) {
          failed.push({ file, reason: 'custom', message: custom });
          continue;
        }

        running += file.size;
        passed.push(file);
      }

      setRejections(failed);
      if (failed.length > 0) onReject?.(failed);

      if (passed.length > 0) {
        const added: UploadItem[] = passed.map((file) => ({
          id: `${file.name}-${String(file.lastModified)}-${String(file.size)}`,
          file,
          status: 'pending',
        }));
        onChange(multiple ? [...value, ...added] : added);
        onAccepted?.(passed);
      }

      setAnnouncement(
        [
          passed.length > 0
            ? `${String(passed.length)} ${passed.length === 1 ? 'file' : 'files'} added.`
            : '',
          failed.length > 0 ? `${String(failed.length)} refused. ${failed[0]?.message ?? ''}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    },
    [
      accept,
      maxFiles,
      maxSize,
      maxTotalSize,
      multiple,
      onAccepted,
      onChange,
      onReject,
      usedBytes,
      validate,
      value,
    ],
  );

  const onInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    accepted([...(event.target.files ?? [])]);
    // Cleared so the same file can be chosen twice in a row: otherwise the
    // second attempt fires no change event at all.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (disabled || full) return;
    accepted([...event.dataTransfer.files]);
  };

  const remove = (item: UploadItem): void => {
    onRemove?.(item);
    onChange(value.filter((current) => current.id !== item.id));
    setAnnouncement(
      `${displayName(item.file.name)} removed. ${String(value.length - 1)} remaining.`,
    );
    inputRef.current?.focus();
  };

  const input = (
    <input
      ref={inputRef}
      id={inputId}
      type="file"
      accept={accept.join(',')}
      multiple={multiple}
      disabled={disabled || full}
      onChange={onInputChange}
      aria-describedby={cn(hint && hintId, statusId) || undefined}
      aria-invalid={invalid || undefined}
      className={cn(
        variant === 'dropzone'
          ? // Stretched over the zone at zero opacity rather than hidden with
            // `sr-only`: it keeps its place in the tab order, the whole area is
            // clickable, and no `<label>` wrapper is needed to swallow the drop
            // events.
            'absolute inset-0 cursor-pointer opacity-0'
          : 'sr-only',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
      )}
    />
  );

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-sm leading-none font-medium text-fg">
          {label}
        </label>
        <span className="text-xs tabular-nums text-fg-subtle">
          {maxFiles > 1 ? `${String(value.length)} / ${String(maxFiles)}` : null}
          {maxTotalSize !== undefined
            ? ` · ${formatBytes(usedBytes)} of ${formatBytes(maxTotalSize)}`
            : null}
        </span>
      </div>

      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}

      {variant === 'dropzone' ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled && !full) setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            'relative flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center',
            'transition-[background-color,border-color,transform] duration-(--animate-duration-fast) ease-standard',
            dragging
              ? 'scale-[1.01] border-accent bg-accent-subtle'
              : 'border-border bg-surface-sunken',
            invalid && 'border-danger',
            (disabled || full) && 'pointer-events-none opacity-55',
          )}
        >
          <Upload
            aria-hidden
            className={cn(
              'size-6 transition-transform duration-(--animate-duration-normal) ease-standard',
              dragging ? 'scale-110 text-accent-fg' : 'text-fg-subtle',
            )}
          />
          <p className="text-base text-fg">
            <span className="font-medium text-accent-fg">
              Choose {multiple ? 'files' : 'a file'}
            </span>{' '}
            <span className="text-fg-muted">or drop {multiple ? 'them' : 'it'} here</span>
          </p>
          <p className="text-xs text-fg-subtle">
            {accept.length > 0
              ? accept.map((entry) => entry.replace(/^.*\//, '').toUpperCase()).join(', ')
              : 'Any file'}{' '}
            · up to {formatBytes(maxSize)} each
          </p>
          {input}
        </div>
      ) : (
        <div className="relative inline-flex">
          <Button asChild variant="secondary" startIcon={<Paperclip />} disabled={disabled || full}>
            <label htmlFor={inputId}>{multiple ? 'Attach files' : 'Attach a file'}</label>
          </Button>
          {input}
        </div>
      )}

      {value.length > 0 ? (
        <ul aria-label={`${label}, ${String(value.length)} files`} className="space-y-1.5">
          {value.map((item) => {
            const name = displayName(item.file.name);
            const Icon = extensionIcon[extensionOf(item.file.name)] ?? FileIcon;

            return (
              <li
                key={item.id}
                className={cn(
                  'flex items-start gap-3 rounded-md border bg-surface p-2.5',
                  'motion-safe:animate-pop-in',
                  item.status === 'error' ? 'border-danger-border' : 'border-border',
                )}
              >
                <Icon
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    item.status === 'error' ? 'text-danger-fg' : 'text-fg-subtle',
                  )}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {/* Rendered as text, and with any path stripped. React
                        escapes it; the strip is ours. */}
                    {safeLinkUrl(item.url) !== undefined && item.status === 'done' ? (
                      <a
                        href={safeLinkUrl(item.url)}
                        // An uploaded file is untrusted content on your origin.
                        // `noopener` closes the reverse-window handle and
                        // `download` keeps the browser from rendering it inline.
                        rel="noopener noreferrer"
                        target="_blank"
                        className="min-w-0 truncate text-base text-accent-fg underline underline-offset-2"
                      >
                        {name}
                      </a>
                    ) : (
                      <span className="min-w-0 truncate text-base text-fg">{name}</span>
                    )}
                    <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                      {formatBytes(item.file.size)}
                    </span>
                  </div>

                  {item.status === 'uploading' ? (
                    <div className="mt-1.5">
                      <Progress
                        value={item.progress ?? null}
                        size="sm"
                        label={`Uploading ${name}`}
                      />
                    </div>
                  ) : null}

                  {item.status === 'error' ? (
                    <p className="mt-1 text-xs font-medium text-danger-fg">
                      {item.error ?? 'The upload failed.'}
                    </p>
                  ) : null}

                  {item.status === 'done' ? (
                    <p className="mt-0.5 text-2xs text-success-fg">Uploaded</p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {item.status === 'error' && onRetry ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Retry ${name}`}
                      startIcon={<RotateCcw />}
                      onClick={() => {
                        onRetry(item);
                      }}
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    // Named after the file, never just "Remove": forty
                    // identically-named buttons is forty identical entries in a
                    // screen reader's control list.
                    aria-label={item.status === 'uploading' ? `Cancel ${name}` : `Remove ${name}`}
                    startIcon={item.status === 'uploading' ? <X /> : <Trash2 />}
                    onClick={() => {
                      remove(item);
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {rejections.length > 0 ? (
        <ul className="space-y-1">
          {rejections.map((rejection) => (
            <li
              key={`${rejection.file.name}-${rejection.reason}`}
              className="flex items-start gap-2 text-xs font-medium text-danger-fg"
            >
              <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0" />
              {rejection.message}
            </li>
          ))}
        </ul>
      ) : null}

      <p id={statusId} aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
