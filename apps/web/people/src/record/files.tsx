import {
  Avatar,
  AvatarUploader,
  Button,
  FileUploader,
  icons,
  type UploadItem,
  type UploadedImage,
} from '@reach/ui';
import { createContext, useContext, useState, type JSX } from 'react';

import type { RecordField } from './model';

/**
 * Files for image and document fields: what a record's file values are, and
 * how to upload one.
 *
 * The value of such a field is the id of a file People keeps. Uploading keeps
 * the file and hands back its id; saving the field is what points the record
 * at it, through the same save as any other value. The shell supplies both
 * halves; a screen without them says where such a field is filled in.
 */

export interface FileInfo {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
  readonly size: number;
}

export type UploadOutcome =
  | { readonly ok: true; readonly file: FileInfo }
  | { readonly ok: false; readonly message: string };

export interface FieldFilesValue {
  /** Keep this file for this field; answers with what People kept. */
  readonly upload: ((key: string, file: File) => Promise<UploadOutcome>) | null;
  /** What each file value on the record is. */
  readonly known: ReadonlyMap<string, FileInfo>;
}

export const FieldFiles = createContext<FieldFilesValue>({ upload: null, known: new Map() });

/** Where the tenant app serves a file, to somebody who may read that field. */
export const fileUrl = (id: string): string => `/people/files/${id}`;

export const isFileField = (field: Pick<RecordField, 'dataType'>): boolean =>
  field.dataType === 'image' || field.dataType === 'document_ref';

const size = (bytes: number): string =>
  bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${String(Math.round((bytes / (1024 * 1024)) * 10) / 10)} MB`;

/** A file value, read-only: an image as itself, a document as a link to open it. */
export function FileValue({
  field,
  id,
}: {
  readonly field: RecordField;
  readonly id: string;
}): JSX.Element {
  const { known } = useContext(FieldFiles);
  const file = known.get(id);
  if (file === undefined) return <span className="text-fg-muted">A file</span>;
  if (field.dataType === 'image') {
    return (
      <a href={fileUrl(id)} target="_blank" rel="noreferrer" className="inline-block">
        <Avatar size="2xl" shape="rounded" name={field.label} src={fileUrl(id)} />
        <span className="sr-only">Open {file.name}</span>
      </a>
    );
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <icons.document aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <a
        href={fileUrl(id)}
        target="_blank"
        rel="noreferrer"
        className="truncate underline-offset-4 hover:underline"
      >
        {file.name}
      </a>
      <span className="shrink-0 text-xs text-fg-muted">{size(file.size)}</span>
    </span>
  );
}

/**
 * A file field's control: an image picked into a frame that shows it, a
 * document chosen and listed with its name. The file is uploaded as soon as
 * it is chosen; the field changes to its id, and the form's own Save keeps it.
 */
export function FileInput({
  field,
  value,
  invalid,
  description,
  onChange,
}: {
  readonly field: RecordField;
  readonly value: string | null;
  readonly invalid: boolean;
  readonly description: string;
  readonly onChange: (value: string | null) => void;
}): JSX.Element {
  const { upload, known } = useContext(FieldFiles);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [items, setItems] = useState<readonly UploadItem[]>([]);
  const [images, setImages] = useState<readonly UploadedImage[]>([]);
  const [kept, setKept] = useState<FileInfo | null>(null);
  const label = field.required ? `${field.label} (required)` : field.label;
  const current = value === null ? null : (kept?.id === value ? kept : known.get(value)) ?? null;

  if (upload === null || field.readOnly) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-fg">{field.label}</p>
        {value === null ? (
          <p className="text-sm text-fg-muted">
            {field.readOnly ? 'Not provided' : 'Uploaded on the profile.'}
          </p>
        ) : (
          <FileValue field={field} id={value} />
        )}
      </div>
    );
  }

  const send = (file: File): Promise<UploadOutcome> => {
    setBusy(true);
    setProblem(null);
    return upload(field.key, file).then((outcome) => {
      setBusy(false);
      if (outcome.ok) {
        setKept(outcome.file);
        onChange(outcome.file.id);
      } else {
        setProblem(outcome.message);
      }
      return outcome;
    });
  };

  const hint = [description, problem === null ? null : `Not uploaded: ${problem}`]
    .filter((x) => x !== null && x !== '')
    .join(' ');

  if (field.dataType === 'image') {
    return (
      <AvatarUploader
        label={label}
        hint={busy ? 'Uploading…' : hint === '' ? 'A PNG or a JPEG.' : hint}
        shape="rounded"
        ratio="wide"
        value={images}
        src={value === null ? null : fileUrl(value)}
        accept={['image/png', 'image/jpeg', 'image/webp']}
        maxSize={20 * 1024 * 1024}
        minDimensions={{ width: 1, height: 1 }}
        disabled={busy}
        invalid={invalid || problem !== null}
        onReject={(rejections) => {
          setProblem(rejections[0]?.message ?? 'That image was not accepted.');
        }}
        onChange={(next) => {
          setImages(next);
          const file = next[0]?.file;
          if (file === undefined) {
            onChange(null);
            return;
          }
          void send(file).then((outcome) => {
            if (!outcome.ok) setImages([]);
          });
        }}
      />
    );
  }

  return current !== null ? (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm font-medium text-fg">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <FileValue field={field} id={current.id} />
        <Button
          size="sm"
          variant="ghost"
          startIcon={<icons.delete aria-hidden />}
          aria-label={`Remove ${current.name}`}
          onClick={() => {
            setItems([]);
            setKept(null);
            onChange(null);
          }}
        >
          Remove
        </Button>
      </div>
      {hint === '' ? null : <p className="text-xs text-fg-muted">{hint}</p>}
    </div>
  ) : (
    <FileUploader
      label={label}
      hint={hint === '' ? 'A PDF, a PNG or a JPEG.' : hint}
      variant="button"
      maxFiles={1}
      accept={['application/pdf', 'image/png', 'image/jpeg']}
      maxSize={100 * 1024 * 1024}
      value={items}
      disabled={busy}
      invalid={invalid || problem !== null}
      onChange={setItems}
      onReject={(rejections) => {
        setProblem(rejections[0]?.message ?? 'That file was not accepted.');
      }}
      onAccepted={(files) => {
        const file = files[0];
        if (file === undefined) return;
        void send(file).then((outcome) => {
          setItems((all) =>
            all.map((item) =>
              item.file === file
                ? outcome.ok
                  ? { ...item, status: 'done', url: fileUrl(outcome.file.id) }
                  : { ...item, status: 'error', error: outcome.message }
                : item,
            ),
          );
        });
      }}
      onRemove={() => {
        setItems([]);
        onChange(null);
      }}
    />
  );
}
