import {
  CircleCheck,
  File as FileIcon,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  RotateCw,
  ShieldAlert,
  Upload,
  X,
} from 'lucide-react-native';
import { useState } from 'react';
import { Image, Text as CssText, View } from 'react-native-css/components';

import { cn } from '../../lib/cn.ts';
import { Button } from '../button/button.tsx';
import { Dropzone } from '../dropzone/dropzone.tsx';
import {
  checkFile,
  displayName,
  formatBytes,
  middleTruncate,
  typeName,
  type Pick,
  type PickedFile,
  type Rejection,
} from '../dropzone/files.ts';
import { Icon, type LucideIcon } from '../icon/icon.tsx';
import { Progress } from '../progress/progress.tsx';

/**
 * Documents, a row for each: its progress while it uploads, a Retry when it
 * fails, and, for a file that was refused, why, in words that say what to do
 * instead. A refused file stays in the list as a row until it is removed, so
 * it never simply fails to appear.
 *
 * Reach opens no picker and uploads nothing: `pick` is the app's, and the app
 * reports each item's status and progress back through `value`. Names are
 * drawn as text and lose any path, so markup in one is shown, not run, and a
 * long one loses its middle so the type stays readable.
 */

export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error' | 'refused';

export type UploadItem = {
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  /** MIME type. */
  type: string;
  status: UploadStatus;
  /** 0–100 while uploading; `null` when it cannot be measured. */
  progress?: number | null;
  /** Why it failed or was refused, in words. */
  error?: string;
  /** Replaces the second line: "1.2 of 1.9 MB · 4 s left", "Uploaded 2 Sep". */
  meta?: string;
  /** A preview for an image. */
  uri?: string;
};

export type FileUploaderProps = {
  value: readonly UploadItem[];
  onChange: (items: readonly UploadItem[]) => void;
  /** Opens the app's picker. */
  pick: Pick;
  /** What the uploader is for: "Upload documents", "Upload CV". */
  label?: string;
  /** What is accepted, and how large. */
  hint?: string;
  accept?: readonly string[];
  /** Bytes per file. */
  maxSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  /** The app's own refusal, such as a file already uploaded. */
  validate?: (file: PickedFile) => string | null;
  /** The newly accepted files, to start uploading. */
  onAccepted?: (items: readonly UploadItem[]) => void;
  onRetry?: (item: UploadItem) => void;
  /** Stops an upload or takes a file away. Without it, nothing can be removed here. */
  onRemove?: (item: UploadItem) => void;
  /** `dropzone`: a target above the rows. `button`: one button, for a single file. */
  variant?: 'dropzone' | 'button';
  /** The target as one row from the start, not only once files are listed. */
  compact?: boolean;
  disabled?: boolean;
  /** Required and missing: replaces the hint, in danger. */
  error?: string | undefined;
  className?: string | undefined;
};

let made = 0;

const icons: Record<string, LucideIcon> = {
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
  heic: FileImage,
  zip: FileArchive,
  mov: FileVideo,
  mp4: FileVideo,
};

function iconFor(item: UploadItem, program: boolean): LucideIcon {
  if (program) return ShieldAlert;
  if (item.type.startsWith('video/')) return FileVideo;
  const ext = /\.([a-z0-9]+)$/i.exec(item.name)?.[1]?.toLowerCase() ?? '';
  return icons[ext] ?? FileIcon;
}

export function FileUploader({
  value,
  onChange,
  pick,
  label = 'Choose files',
  hint = 'PDF, PNG or JPG, up to 10 MB',
  accept,
  maxSize,
  maxFiles = Infinity,
  multiple = true,
  validate,
  onAccepted,
  onRetry,
  onRemove,
  variant = 'dropzone',
  compact = false,
  disabled = false,
  error,
  className,
}: FileUploaderProps): React.JSX.Element {
  const [said, setSaid] = useState('');
  const kept = value.filter((v) => v.status !== 'refused');
  const full = kept.length >= maxFiles;

  const take = (files: readonly PickedFile[]): void => {
    const accepted: UploadItem[] = [];
    const refused: UploadItem[] = [];
    for (const file of multiple ? files : files.slice(0, 1)) {
      made += 1;
      const base: UploadItem = {
        id: `${file.name}-${String(made)}`,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'pending',
        ...(file.type.startsWith('image/') ? { uri: file.uri } : {}),
      };
      const rejection: Rejection | null =
        checkFile(file, { accept, maxSize }) ??
        (kept.length + accepted.length >= maxFiles
          ? {
              file,
              reason: 'count',
              message: `${String(maxFiles)} files at most. Remove one to add another.`,
            }
          : null);
      const own = rejection ? null : (validate?.(file) ?? null);
      if (rejection || own)
        refused.push({ ...base, status: 'refused', error: rejection?.message ?? own ?? '' });
      else accepted.push(base);
    }
    const next = multiple ? [...value, ...accepted, ...refused] : [...accepted, ...refused];
    onChange(next);
    if (accepted.length) onAccepted?.(accepted);
    setSaid(
      [
        accepted.length ? `${String(accepted.length)} added.` : '',
        refused.length ? `${String(refused.length)} refused. ${refused[0]?.error ?? ''}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  };

  const remove = (item: UploadItem): void => {
    if (item.status === 'refused') onChange(value.filter((v) => v.id !== item.id));
    else onRemove?.(item);
  };

  return (
    <View className={cn('gap-2.5', className)}>
      {variant === 'button' ? (
        <View className="flex-row flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            startIcon={<Icon icon={Upload} />}
            disabled={disabled || full}
            onPress={() => {
              void pick().then((files) => {
                if (files.length) take(files);
              });
            }}
          >
            {label}
          </Button>
          <CssText className={cn('text-subhead', error ? 'text-danger-fg' : 'text-fg-muted')}>
            {error ?? hint}
          </CssText>
        </View>
      ) : (
        <Dropzone
          pick={pick}
          onFiles={take}
          variant={compact || value.length ? 'inline' : 'panel'}
          label={full ? `${String(kept.length)} of ${String(maxFiles)} files` : label}
          hint={full ? 'Remove a file to add another.' : hint}
          error={error}
          disabled={disabled || full}
        />
      )}
      {value.map((item) => (
        <FileRow
          key={item.id}
          item={item}
          {...(onRetry ? { onRetry } : {})}
          {...(onRemove || item.status === 'refused' ? { onRemove: remove } : {})}
          disabled={disabled}
        />
      ))}
      <View className="absolute h-px w-px overflow-hidden opacity-0">
        <CssText accessibilityLiveRegion="polite" aria-live="polite">
          {said}
        </CssText>
      </View>
    </View>
  );
}

const PROGRAM = /^Blocked:/;

/** One file: what it is, how far it has got, and what can be done about it. */
export function FileRow({
  item,
  onRetry,
  onRemove,
  disabled = false,
}: {
  item: UploadItem;
  onRetry?: (item: UploadItem) => void;
  onRemove?: (item: UploadItem) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const name = displayName(item.name);
  const failed = item.status === 'error' || item.status === 'refused';
  const uploading = item.status === 'uploading' || item.status === 'pending';
  const progress = item.progress ?? null;
  const meta =
    item.meta ??
    (failed
      ? (item.error ?? 'Upload failed.')
      : uploading
        ? progress === null
          ? `Waiting · ${formatBytes(item.size)}`
          : `${formatBytes((item.size * progress) / 100)} of ${formatBytes(item.size)}`
        : `${typeName(item.type, name)} · ${formatBytes(item.size)}`);
  return (
    <View
      className={cn(
        'min-w-0 flex-row items-center gap-3 rounded-[14px] px-3.5 py-3',
        failed ? 'bg-danger-subtle' : 'bg-surface shadow-sm',
      )}
    >
      <View className="size-9 items-center justify-center overflow-hidden rounded-[10px] bg-surface-sunken">
        {item.uri ? (
          <Image
            source={{ uri: item.uri }}
            alt=""
            aria-hidden
            style={{ width: 36, height: 36 }}
            resizeMode="cover"
          />
        ) : (
          <Icon
            icon={iconFor(item, PROGRAM.test(item.error ?? ''))}
            size={18}
            tone={failed ? 'danger' : 'muted'}
          />
        )}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <CssText numberOfLines={1} className="text-[15px] leading-[1.3] font-semibold text-fg">
          {middleTruncate(name, 30)}
        </CssText>
        {item.status === 'uploading' ? (
          <Progress value={progress} label={`Uploading ${name}`} hideLabel thickness={6} />
        ) : null}
        <CssText
          {...(failed
            ? { accessibilityLiveRegion: 'polite' as const, 'aria-live': 'polite' as const }
            : {})}
          className={cn('text-[12px] leading-[1.3]', failed ? 'text-danger-fg' : 'text-fg-muted')}
        >
          {meta}
        </CssText>
      </View>
      {item.status === 'error' && onRetry ? (
        <Button
          variant="secondary"
          size="xs"
          disabled={disabled}
          startIcon={<Icon icon={RotateCw} />}
          accessibilityLabel={`Retry ${name}`}
          onPress={() => {
            onRetry(item);
          }}
        >
          Retry
        </Button>
      ) : null}
      {(uploading || item.status === 'refused' || (item.status === 'error' && !onRetry)) &&
      onRemove ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={disabled}
          startIcon={<Icon icon={X} />}
          accessibilityLabel={uploading ? `Stop uploading ${name}` : `Remove ${name}`}
          onPress={() => {
            onRemove(item);
          }}
        />
      ) : null}
      {item.status === 'done' ? (
        <Icon icon={CircleCheck} size={18} tone="success" label="Uploaded" />
      ) : null}
    </View>
  );
}
