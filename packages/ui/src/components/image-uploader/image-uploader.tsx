'use client';

import { AlertTriangle, ImagePlus, RotateCcw, Trash2, Upload } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type JSX,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { safeImageUrl } from '../../lib/safe-url';
import { Button } from '../button/button';
import { Progress } from '../progress/progress';

/**
 * Image upload: drop, browse, or paste.
 *
 * ### The input is the control; the dropzone is decoration
 *
 * A `<div>` with `onDrop` is invisible to a keyboard and to a screen reader.
 * Here a real `<input type="file">` does the work. It is what Tab reaches,
 * what Space activates, what assistive tech announces, and what a mobile
 * browser turns into "Take Photo or Choose from Library". The drop target sits
 * behind it and is `aria-hidden`, because dropping is a *shortcut*, never the
 * only way in.
 *
 * ### Validation happens twice, and this is the cheap half
 *
 * Type, size and dimensions are checked here so the user hears about a 40MB
 * TIFF before it is uploaded rather than after. **None of it is a security
 * control.** `accept` is a hint, the extension is a lie, and `File.type` comes
 * from the client. The server re-checks the magic bytes, re-encodes, and
 * strips EXIF, which also strips the GPS coordinates a phone put in the
 * employee's profile photo.
 *
 * ### Object URLs are revoked
 *
 * `URL.createObjectURL` pins the whole file in memory until it is revoked. A
 * form where someone swaps a photo eight times leaks eight files. Every
 * preview here is revoked when it is replaced and on unmount.
 */

export interface UploadedImage {
  id: string;
  file: File;
  /** Object URL for the preview. Owned and revoked by this component. */
  previewUrl: string;
  width?: number;
  height?: number;
}

export interface ImageUploadRejection {
  file: File;
  reason: 'type' | 'size' | 'dimensions' | 'count';
  message: string;
}

export interface ImageUploaderProps {
  /** Current files. Controlled, this component never holds the list. */
  value: readonly UploadedImage[];
  onChange: (images: readonly UploadedImage[]) => void;
  /** Visible label. Required: a file input with no label is an unnamed button. */
  label: string;
  hint?: ReactNode;
  /** Accepted MIME types. A hint to the picker and the first validation pass, never a security control. */
  accept?: readonly string[];
  /** Bytes. Rejected files are reported, never silently dropped. */
  maxSize?: number;
  /** Rejects images smaller than this, in pixels, the case a size limit misses. */
  minDimensions?: { width: number; height: number };
  /** More than one file at a time. */
  multiple?: boolean;
  maxFiles?: number;
  /** 0–100 while an upload is in flight, or `null` for unknown length. Hides the input. */
  progress?: number | null;
  disabled?: boolean;
  invalid?: boolean;
  /** Square preview for an avatar; wide for a banner. */
  aspect?: 'square' | 'wide' | 'auto';
  /** Called with everything that failed validation, so the screen can explain why. */
  onReject?: (rejections: readonly ImageUploadRejection[]) => void;
  className?: string;
}

const defaultAccept = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'] as const;

const aspectClass = {
  square: 'aspect-square',
  wide: 'aspect-[3/1]',
  auto: 'min-h-40',
} as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reads the intrinsic size, which is the only way to enforce a minimum. */
async function measure(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // `addEventListener`, and `once` on both: assigning `onload`/`onerror`
    // replaces any handler already there, and whichever of the two fires first
    // settles the promise, so the other should stop listening rather than sit
    // on a decoded bitmap until the image is collected.
    image.addEventListener(
      'load',
      () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      },
      { once: true },
    );
    image.addEventListener(
      'error',
      () => {
        resolve(null);
      },
      { once: true },
    );
    image.src = url;
  });
}

export function ImageUploader({
  value,
  onChange,
  label,
  hint,
  accept = defaultAccept,
  maxSize = 5 * 1024 * 1024,
  minDimensions,
  multiple = false,
  maxFiles = multiple ? 8 : 1,
  progress,
  disabled = false,
  invalid = false,
  aspect = 'auto',
  onReject,
  className,
}: ImageUploaderProps): JSX.Element {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const statusId = `${inputId}-status`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejections, setRejections] = useState<readonly ImageUploadRejection[]>([]);
  const [announcement, setAnnouncement] = useState('');

  // Every URL this component created, revoked on unmount. The ref rather than
  // `value` because the effect must not re-run as the list changes.
  const created = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of created.current) URL.revokeObjectURL(url);
      created.current.clear();
    },
    [],
  );

  const accepted = useCallback(
    async (files: readonly File[]): Promise<void> => {
      const passed: UploadedImage[] = [];
      const failed: ImageUploadRejection[] = [];
      const room = maxFiles - value.length;

      for (const [position, file] of files.entries()) {
        if (position >= room) {
          failed.push({
            file,
            reason: 'count',
            message: `Only ${String(maxFiles)} ${maxFiles === 1 ? 'image' : 'images'} allowed.`,
          });
          continue;
        }
        if (!accept.includes(file.type)) {
          failed.push({
            file,
            reason: 'type',
            message: `${file.name} is ${file.type || 'an unknown type'}. Allowed: ${accept
              .map((type) => type.replace('image/', ''))
              .join(', ')}.`,
          });
          continue;
        }
        if (file.size > maxSize) {
          failed.push({
            file,
            reason: 'size',
            message: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)}.`,
          });
          continue;
        }

        const previewUrl = URL.createObjectURL(file);
        created.current.add(previewUrl);
        /*
         * Sequential on purpose. Each `measure` decodes a full-size bitmap, and
         * the rule's suggested `Promise.all` would hold every one of them in
         * memory at once, which on a drop of fifty phone photos is tens of
         * megabytes of decoded pixels rather than one image at a time.
         */
        // oxlint-disable-next-line no-await-in-loop
        const size = await measure(previewUrl);

        if (
          minDimensions &&
          size &&
          (size.width < minDimensions.width || size.height < minDimensions.height)
        ) {
          URL.revokeObjectURL(previewUrl);
          created.current.delete(previewUrl);
          failed.push({
            file,
            reason: 'dimensions',
            message: `${file.name} is ${String(size.width)}×${String(size.height)}. The minimum is ${String(minDimensions.width)}×${String(minDimensions.height)}.`,
          });
          continue;
        }

        passed.push({
          id: `${file.name}-${String(file.lastModified)}-${String(file.size)}`,
          file,
          previewUrl,
          ...size,
        });
      }

      setRejections(failed);
      if (failed.length > 0) onReject?.(failed);

      if (passed.length > 0) {
        const next = multiple ? [...value, ...passed] : passed;
        // Replacing a single image: revoke the one being dropped rather than
        // waiting for unmount.
        if (!multiple) {
          for (const image of value) {
            URL.revokeObjectURL(image.previewUrl);
            created.current.delete(image.previewUrl);
          }
        }
        onChange(next);
        setAnnouncement(
          `${String(passed.length)} ${passed.length === 1 ? 'image' : 'images'} added. ${String(next.length)} of ${String(maxFiles)} in total.`,
        );
      } else if (failed.length > 0) {
        setAnnouncement(`${String(failed.length)} rejected. ${failed[0]?.message ?? ''}`);
      }
    },
    [accept, maxFiles, maxSize, minDimensions, multiple, onChange, onReject, value],
  );

  const onInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    void accepted([...(event.target.files ?? [])]);
    // Clearing lets the same file be chosen twice in a row, which otherwise
    // fires no change event at all.
    event.target.value = '';
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    void accepted([...event.dataTransfer.files]);
  };

  /**
   * Paste. A screenshot is on the clipboard far more often than it is in a
   * folder, and this is two lines.
   */
  const onPaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = [...event.clipboardData.files];
    if (files.length === 0 || disabled) return;
    event.preventDefault();
    void accepted(files);
  };

  const remove = (image: UploadedImage): void => {
    URL.revokeObjectURL(image.previewUrl);
    created.current.delete(image.previewUrl);
    onChange(value.filter((current) => current.id !== image.id));
    setAnnouncement(`${image.file.name} removed.`);
    inputRef.current?.focus();
  };

  const busy = progress !== undefined;
  const full = value.length >= maxFiles;

  return (
    <div className={cn('flex flex-col gap-2', className)} onPaste={onPaste}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-sm leading-none font-medium text-fg">
          {label}
        </label>
        {maxFiles > 1 ? (
          <span className="text-xs tabular-nums text-fg-subtle">
            {value.length} / {maxFiles}
          </span>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}

      {busy ? (
        <div className="rounded-md border border-border bg-surface p-4">
          <Progress
            value={progress ?? null}
            label={progress === null ? 'Uploading' : 'Uploading image'}
            showValue
          />
        </div>
      ) : (
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
            aspectClass[aspect],
            dragging
              ? 'scale-[1.01] border-accent bg-accent-subtle'
              : 'border-border bg-surface-sunken',
            invalid && 'border-danger',
            (disabled || full) && 'pointer-events-none opacity-55',
          )}
        >
          <ImagePlus
            aria-hidden
            className={cn(
              'size-6 transition-transform duration-(--animate-duration-normal) ease-standard',
              dragging ? 'scale-110 text-accent-fg' : 'text-fg-subtle',
            )}
          />
          <p className="text-base text-fg">
            <span className="font-medium text-accent-fg">
              Choose {multiple ? 'images' : 'an image'}
            </span>{' '}
            <span className="text-fg-muted">or drop {multiple ? 'them' : 'it'} here</span>
          </p>
          <p className="text-xs text-fg-subtle">
            {accept.map((type) => type.replace('image/', '').toUpperCase()).join(', ')} · up to{' '}
            {formatBytes(maxSize)}
            {minDimensions
              ? ` · at least ${String(minDimensions.width)}×${String(minDimensions.height)}`
              : ''}
          </p>

          {/*
           * The real control. Stretched over the whole zone with `opacity-0`
           * rather than hidden with `sr-only`: it stays in the tab order, it
           * still gets a focus ring through the wrapper, and the entire area is
           * clickable without a `label` wrapper swallowing the drop events.
           */}
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
              'absolute inset-0 cursor-pointer opacity-0',
              'file:cursor-pointer',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus',
            )}
          />
        </div>
      )}

      {value.length > 0 ? (
        <ul
          className={cn(
            'grid gap-2',
            multiple ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4' : 'grid-cols-1',
          )}
        >
          {value.map((image) => (
            <li
              key={image.id}
              className="group relative overflow-hidden rounded-md border border-border bg-surface animate-scale-in"
            >
              <img
                src={safeImageUrl(image.previewUrl)}
                // The file name is the only description available before the
                // user writes one. It is a poor alt text and a better one than
                // an empty string on a photo that carries meaning.
                alt={image.file.name}
                className={cn(
                  'w-full object-cover',
                  aspect === 'square' && 'aspect-square',
                  aspect === 'wide' && 'aspect-[3/1]',
                  aspect === 'auto' && 'max-h-48',
                )}
              />
              <div className="flex items-center gap-2 p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs text-fg">{image.file.name}</p>
                  <p className="text-2xs tabular-nums text-fg-subtle">
                    {formatBytes(image.file.size)}
                    {image.width ? ` · ${String(image.width)}×${String(image.height ?? 0)}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${image.file.name}`}
                  onClick={() => {
                    remove(image);
                  }}
                  startIcon={<Trash2 />}
                />
              </div>
            </li>
          ))}
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

      {/* One live region for both outcomes: a file landing and a file being
          refused are the same event to someone who cannot see the grid. */}
      <p id={statusId} aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

export interface AvatarUploaderProps extends Omit<
  ImageUploaderProps,
  'multiple' | 'maxFiles' | 'aspect'
> {
  /** Shown when nothing has been chosen: initials, a silhouette. */
  fallback?: ReactNode;
  /**
   * The target's outline. A face is round; a logo or a photograph is not.
   *
   * `circle` crops to a disc, which is right for a person and wrong for a
   * wordmark — half of one disappears. `rounded` keeps the corners.
   */
  shape?: 'circle' | 'rounded';
  /**
   * The target's proportions.
   *
   * All three are the same *height*, which is the point: two of these side by
   * side line up whatever they are holding, and the row does not develop a step
   * in it because one image happens to be a banner.
   */
  ratio?: 'square' | 'wide';
  /**
   * An already-stored image to show instead of a locally picked one.
   *
   * Without this the component can only display a file it is holding, and a
   * value that lives on a server — an uploaded URL, a photo from a previous
   * visit — has nowhere to go. Callers in that position were reduced to
   * swapping the whole component out for a different layout once an upload
   * finished, which read as the picker disappearing.
   *
   * A locally picked file wins, because it is the newer of the two and is what
   * the person just did.
   */
  src?: string | null;
  /** How the image sits in the target. A logo is `contain`; a face is `cover`. */
  fit?: 'cover' | 'contain';
  /**
   * Where the label and controls sit relative to the target.
   *
   * `inline` puts them beside it, which is right for a profile photo in a form
   * — one row, read left to right. It is wrong for two of these in a grid: the
   * targets differ in width, so they reach the wrapping threshold at different
   * container widths and the row goes ragged, one cell wrapping while its
   * neighbour does not.
   *
   * `stacked` puts them underneath. Two stacked uploaders are the same shape
   * whatever their targets are, which is what makes a row of them line up.
   */
  orientation?: 'inline' | 'stacked';
}

/**
 * The single-image case, as a round target beside the person it belongs to.
 *
 * A profile photo is worth its own component because the affordance is the
 * photo itself: there is no dropzone, the current image *is* the button, and
 * replacing is one click rather than remove-then-add.
 */
export function AvatarUploader({
  value,
  onChange,
  label,
  hint,
  accept = defaultAccept,
  maxSize = 2 * 1024 * 1024,
  minDimensions = { width: 200, height: 200 },
  disabled = false,
  invalid = false,
  onReject,
  fallback,
  shape = 'circle',
  ratio = 'square',
  src = null,
  fit = 'cover',
  orientation = 'inline',
  className,
}: AvatarUploaderProps): JSX.Element {
  const inputId = useId();
  const current = value[0];
  /*
   * The picked file first: it is what the person just chose, and showing the
   * stored image over it would look like the choice did not take.
   *
   * Through `safeImageUrl`, the same guard `Avatar` uses. A locally minted
   * `blob:` is trustworthy by construction, but `src` is a caller's value and
   * on these screens it comes from a database column an operator filled in —
   * so it is outside data reaching a DOM sink, which is exactly what that guard
   * is for. It fails closed: an unrecognised scheme yields the fallback rather
   * than something sanitised that is still whatever somebody chose.
   */
  const preview = safeImageUrl(current?.previewUrl ?? src) ?? null;
  const round = shape === 'circle' ? 'rounded-full' : 'rounded-lg';

  return (
    /*
     * `min-w-0` on the text column below and wrapping here, because this is
     * routinely put in a half-width grid cell. Without them the actions row
     * cannot shrink past the intrinsic width of two buttons and pushes out of
     * its container — the target keeps its size, the text refuses to narrow,
     * and the row overflows instead of reflowing.
     */
    <div
      className={cn(
        'flex gap-x-4 gap-y-3',
        orientation === 'stacked'
          ? 'flex-col items-start'
          : 'flex-wrap items-center',
        className,
      )}
    >
      {/* `max-w-full` here as well as on the label. The label's own cap
          resolves against this wrapper, and a wrapper sized to its content is
          not a constraint — so without both, the target still sticks out of a
          column narrower than 9rem. */}
      <div className="relative max-w-full">
        <label
          htmlFor={inputId}
          className={cn(
            'group relative grid h-20 shrink-0 cursor-pointer place-items-center overflow-hidden border border-border bg-surface-sunken',
            // One height, two widths. Two of these in a row line up.
            //
            // `max-w-full` so the target can still shrink: 9rem is wider than a
            // grid cell gets on a narrow screen, and a fixed width there is an
            // element sticking out of its own column.
            ratio === 'wide' ? 'w-36 max-w-full' : 'w-20 max-w-full',
            round,
            'transition-[border-color,box-shadow] duration-(--animate-duration-fast)',
            'hover:border-accent',
            'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-border-focus',
            invalid && 'border-danger',
            disabled && 'pointer-events-none opacity-55',
          )}
        >
          {preview === null ? (
            <span className="text-fg-subtle">{fallback ?? <Upload className="size-5" />}</span>
          ) : (
            <img
              src={preview}
              alt=""
              className={cn(
                'size-full animate-fade-in',
                fit === 'contain' ? 'object-contain p-2' : 'object-cover',
              )}
            />
          )}
          <span
            aria-hidden
            className={cn(
              'absolute inset-0 grid place-items-center bg-overlay text-fg-on-accent opacity-0',
              round,
              'transition-opacity duration-(--animate-duration-fast) group-hover:opacity-100',
            )}
          >
            <Upload className="size-5" />
          </span>
          <input
            id={inputId}
            type="file"
            accept={accept.join(',')}
            disabled={disabled}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (!accept.includes(file.type) || file.size > maxSize) {
                onReject?.([
                  {
                    file,
                    reason: accept.includes(file.type) ? 'size' : 'type',
                    message: accept.includes(file.type)
                      ? `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxSize)}.`
                      : `${file.name} is not an accepted image type.`,
                  },
                ]);
                return;
              }
              const previewUrl = URL.createObjectURL(file);
              if (current) URL.revokeObjectURL(current.previewUrl);
              onChange([
                {
                  id: `${file.name}-${String(file.lastModified)}`,
                  file,
                  previewUrl,
                },
              ]);
            }}
          />
        </label>
      </div>

      <div className={cn('min-w-0', orientation === 'stacked' ? 'w-full' : 'flex-1 basis-40')}>
        <label htmlFor={inputId} className="text-sm font-medium text-fg">
          {label}
        </label>
        {hint ? <p className="mt-0.5 text-xs text-fg-muted">{hint}</p> : null}
        {/* Keyed off the preview, not the picked file: an image that came from
            the server is just as replaceable as one picked a second ago, and
            reading `current` here left a stored image with no controls at all. */}
        {preview !== null ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              startIcon={<RotateCcw />}
              onClick={() => {
                document.getElementById(inputId)?.click();
              }}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              startIcon={<Trash2 />}
              onClick={() => {
                // Only a locally created object URL is ours to revoke. `src`
                // belongs to the caller and may still be on screen elsewhere.
                if (current) URL.revokeObjectURL(current.previewUrl);
                onChange([]);
              }}
            >
              Remove
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-xs text-fg-subtle">
            {minDimensions.width}×{minDimensions.height} minimum · up to {formatBytes(maxSize)}
          </p>
        )}
      </div>
    </div>
  );
}
