import {
  Alert,
  Button,
  Checkbox,
  Combobox,
  DatePicker,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropzone,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { putFile, useWrite } from './shared';
import type {
  Created,
  FileRef,
  FilingSuggestion,
  PersonRef,
  Read,
  StartUpload,
  TypeOption,
} from './types';
import { t as tr } from './i18n';

/**
 * Adding a document (C1, MD2): drop a file, name it, and — for HR — say what
 * type it is and whom it is about; the type's access applies. A request
 * answered names its type and person already (H2, from "Needs you").
 */

export interface UploadInput {
  readonly title: string;
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
  readonly sectionId: string | null;
  readonly expiresOn: string | null;
  readonly requestId: string | null;
  readonly upload: FileRef;
}

export interface UploadPreset {
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
  readonly requestId: string | null;
  readonly sectionId: string | null;
}

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,text/csv,.docx,.xlsx,.pptx';
const PERSONAL = '__personal';

export function UploadDialog({
  open,
  onOpenChange,
  hr,
  types,
  people,
  preset,
  onStartUpload,
  onUpload,
  onSuggest,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly hr: boolean;
  readonly types: readonly TypeOption[];
  readonly people: readonly PersonRef[];
  readonly preset: UploadPreset;
  readonly onStartUpload: StartUpload | undefined;
  readonly onUpload: ((input: UploadInput) => Promise<Created>) | undefined;
  /** C1: what Kithena reads the upload as, for HR to confirm. */
  readonly onSuggest?:
    ((uploadId: string, name: string) => Promise<Read<FilingSuggestion>>) | undefined;
  /** Filed: its id, for the share question that follows (C3). */
  readonly onDone: (id: string, title: string, typed: boolean) => void;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [typeKey, setTypeKey] = useState<string>(preset.typeKey ?? PERSONAL);
  const [subject, setSubject] = useState<string | null>(preset.subjectPersonId);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  // HR's PDF goes up as soon as it is chosen, so Kithena can read it while HR names it.
  const [sent, setSent] = useState<FileRef | null>(null);
  const [reading, setReading] = useState<'reading' | 'read' | null>(null);
  const write = useWrite();
  const type = types.find((t) => t.key === typeKey);
  const needsPerson = type?.filedTo === 'person';
  // An employee files their own documents, and a type only when HR asked for it.
  const fixed = preset.requestId !== null;
  const suggest = (chosen: File): void => {
    if (!hr || fixed || preset.typeKey !== null || onSuggest === undefined) return;
    if (onStartUpload === undefined || chosen.type !== 'application/pdf') return;
    setReading('reading');
    void putFile(chosen, onStartUpload).then(async (put) => {
      if (!put.ok) {
        setReading(null);
        return;
      }
      setSent(put.ref);
      const r = await onSuggest(put.ref.uploadId, chosen.name);
      if (!r.ok || !r.data.available) {
        setReading(null);
        return;
      }
      const s = r.data;
      if (s.title !== null) setTitle(s.title);
      if (s.typeKey !== null && types.some((t) => t.key === s.typeKey)) setTypeKey(s.typeKey);
      if (s.subjectPersonId !== null) setSubject(s.subjectPersonId);
      if (s.expiresOn !== null) setExpiresOn(s.expiresOn);
      setReading('read');
    });
  };
  const send = (): void => {
    if (file === null) return;
    write.run(async () => {
      if (onStartUpload === undefined || onUpload === undefined) {
        return {
          ok: false,
          message: tr('upload.uploading_is_not_available_here', 'Uploading is not available here'),
        };
      }
      const put =
        sent === null ? await putFile(file, onStartUpload) : { ok: true as const, ref: sent };
      if (!put.ok) return put;
      const name = title.trim() || file.name.replace(/\.[^.]+$/u, '');
      const created = await onUpload({
        title: name,
        typeKey: typeKey === PERSONAL ? null : typeKey,
        subjectPersonId: typeKey === PERSONAL ? null : subject,
        sectionId: preset.sectionId,
        expiresOn,
        requestId: preset.requestId,
        upload: put.ref,
      });
      if (!created.ok) return created;
      setFile(null);
      setTitle('');
      setSent(null);
      setReading(null);
      onOpenChange(false);
      onDone(created.id, name, typeKey !== PERSONAL);
      return { ok: true };
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('upload.add_a_document', 'Add a document')}</DialogTitle>
          <DialogDescription>
            {tr(
              'upload.it_starts_private_pdfs_images_office',
              'It starts Private. PDFs, images, Office files and CSV, up to 100 MB.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Dropzone
            label={
              file === null
                ? tr('upload.drop_a_file_or_choose_one', 'Drop a file, or choose one')
                : file.name
            }
            accept={ACCEPT}
            variant="inline"
            onFiles={(files) => {
              const first = files[0];
              if (first === undefined) return;
              setFile(first);
              setSent(null);
              setReading(null);
              if (title === '') setTitle(first.name.replace(/\.[^.]+$/u, ''));
              suggest(first);
            }}
          />
          {reading === 'reading' ? (
            <Spinner
              size="sm"
              label={tr('upload.kithena_is_reading_the_file', 'Kithena is reading the file')}
            />
          ) : reading === 'read' ? (
            <Alert tone="info" icon={<icons.assistant />}>
              {tr(
                'upload.kithena_filled_in_what_it_read',
                'Kithena filled in what it read. Check each before adding.',
              )}
            </Alert>
          ) : null}
          <Field required>
            <FieldLabel>{tr('upload.name', 'Name')}</FieldLabel>
            <FieldControl>
              <Input
                value={title}
                maxLength={200}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {hr && !fixed ? (
            <Field>
              <FieldLabel>{tr('upload.type', 'Type')}</FieldLabel>
              <Select value={typeKey} onValueChange={setTypeKey}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value={PERSONAL}>
                    {tr('upload.my_own_document', 'My own document')}
                  </SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {type?.confidential === true ? (
                <FieldDescription>
                  {tr('upload.confidential_as_its_type_says', 'Confidential, as its type says.')}
                </FieldDescription>
              ) : null}
            </Field>
          ) : null}
          {hr && needsPerson && !fixed ? (
            <Field required>
              <FieldLabel>{tr('upload.about', 'About')}</FieldLabel>
              <FieldControl>
                <Combobox
                  label={tr('upload.about', 'About')}
                  options={people.map((p) => ({
                    value: p.personId,
                    label: p.name,
                    ...(p.teamName === null ? {} : { description: p.teamName }),
                  }))}
                  value={subject}
                  onChange={(v) => {
                    setSubject(typeof v === 'string' ? v : null);
                  }}
                  placeholder={tr('upload.who_it_is_about', 'Who it is about')}
                  searchPlaceholder={tr('upload.find_someone', 'Find someone')}
                  emptyMessage={tr('upload.nobody_by_that_name', 'Nobody by that name')}
                />
              </FieldControl>
            </Field>
          ) : null}
          <Field>
            <FieldLabel>{tr('upload.expires', 'Expires')}</FieldLabel>
            <FieldControl>
              <DatePicker
                label={tr('upload.expires', 'Expires')}
                placeholder={tr('upload.never', 'Never')}
                value={expiresOn}
                onChange={setExpiresOn}
              />
            </FieldControl>
            <FieldDescription>
              {tr('upload.kithena_reminds_before_it_does', 'Kithena reminds before it does.')}
            </FieldDescription>
          </Field>
          {write.error === null ? null : (
            <Alert tone="danger" title={tr('upload.not_added', 'Not added')}>
              {write.error}
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {tr('upload.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            loading={write.pending}
            disabled={file === null || reading === 'reading' || (needsPerson && subject === null)}
            onClick={send}
          >
            {tr('upload.add', 'Add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Private, then one question (C3, MD4): keep it private, or share it now. It
 * can be switched off, and then never asks again.
 */
export function ShareQuestion({
  open,
  title,
  onKeep,
  onShare,
  onStopAsking,
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onKeep: () => void;
  readonly onShare: () => void;
  readonly onStopAsking: (() => void) | undefined;
}): JSX.Element {
  const [stop, setStop] = useState(false);
  const close = (share: boolean): void => {
    if (stop) onStopAsking?.();
    if (share) onShare();
    else onKeep();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('upload.its_private', 'It’s private')}</DialogTitle>
          <DialogDescription>
            {tr(
              'upload.only_you_can_see_do_you',
              'Only you can see {{title}}. Do you want to share it?',
              { title },
            )}
          </DialogDescription>
        </DialogHeader>
        {onStopAsking === undefined ? null : (
          <DialogBody>
            <Field orientation="horizontal">
              <FieldLabel>
                {tr('upload.dont_ask_me_after_uploads', 'Don’t ask me after uploads')}
              </FieldLabel>
              <FieldControl>
                <Checkbox
                  checked={stop}
                  onCheckedChange={(v) => {
                    setStop(v === true);
                  }}
                />
              </FieldControl>
            </Field>
          </DialogBody>
        )}
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              close(false);
            }}
          >
            {tr('upload.keep_it_private', 'Keep it private')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              close(true);
            }}
          >
            {tr('upload.share', 'Share')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
