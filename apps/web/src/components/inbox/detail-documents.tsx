'use client';

import { DocumentsInboxDetail } from '@kithena/contracts';
import { Button, Dropzone } from '@reach/ui';
import { useState, type JSX } from 'react';

import {
  acknowledgeDocument,
  decideAccess,
  startUpload,
  uploadDocument,
} from '../../app/(app)/documents/actions';
import type { Outcome } from '../../app/(app)/inbox/actions';
import { Actions, type BodyProps, OpenHere } from './pane';
import { t as tr } from '../../lib/t';

/**
 * Documents' tasks done in the Inbox: the file HR asked for, uploaded into
 * their request; a policy read and acknowledged; somebody's ask to open a
 * document granted or refused. A signature opens the envelope in Documents,
 * whose ceremony (reading, placing, adopting a mark) is its own.
 */

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,text/csv,.docx,.xlsx,.pptx';

/** The browser PUTs the file to the bucket, then files it against the request. */
async function sendFor(
  file: File,
  d: Extract<DocumentsInboxDetail, { kind: 'request' }>,
): Promise<Outcome> {
  const mediaType = file.type || 'application/octet-stream';
  const started = await startUpload({ name: file.name, mediaType, size: file.size });
  if (!started.ok) return started;
  const { put } = started;
  const failed = {
    ok: false as const,
    message: tr(
      'components.inbox.detail-documents.the_file_could_not_be_uploaded',
      'The file could not be uploaded. Try again.',
    ),
  };
  try {
    const sent = await fetch(put.url, { method: put.method, headers: put.headers, body: file });
    if (!sent.ok) return failed;
  } catch {
    return failed;
  }
  const filed = await uploadDocument({
    title: d.typeName,
    typeKey: d.typeKey,
    subjectPersonId: d.personId,
    sectionId: null,
    expiresOn: null,
    requestId: d.requestId,
    upload: { uploadId: put.uploadId, name: file.name, mediaType },
  });
  return filed.ok ? { ok: true } : filed;
}

function Request({
  item,
  act,
  d,
}: BodyProps & { readonly d: Extract<DocumentsInboxDetail, { kind: 'request' }> }): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Dropzone
        label={
          file === null
            ? tr(
                'components.inbox.detail-documents.drop_a_file_or_choose_one',
                'Drop a file, or choose one',
              )
            : file.name
        }
        accept={ACCEPT}
        variant="inline"
        onFiles={(files) => {
          setFile(files[0] ?? null);
        }}
      />
      <Actions
        hint={tr(
          'components.inbox.detail-documents.pdfs_images_office_files',
          'PDFs, images, Office files and CSV, up to 100 MB',
        )}
      >
        <Button
          disabled={file === null || act.pending}
          onClick={() => {
            if (file === null) return;
            act.run(() => sendFor(file, d), {
              title: tr('components.inbox.detail-documents.sent_your', 'Sent your {{name}}', {
                name: d.typeName,
              }),
              description: tr(
                'components.inbox.detail-documents.it_is_in_your_documents',
                'It is in your documents, private to you and HR',
              ),
              next: true,
            });
          }}
        >
          {tr('components.inbox.detail-documents.upload_and_send', 'Upload and send')}
        </Button>
      </Actions>
    </div>
  );
}

function Acknowledge({
  item,
  act,
  d,
}: BodyProps & {
  readonly d: Extract<DocumentsInboxDetail, { kind: 'acknowledge' }>;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base text-fg-muted">
        {tr(
          'components.inbox.detail-documents.read_it_then_say_so',
          'Read it, then say so here. Your acknowledgement is recorded with the date.',
        )}
      </p>
      <Actions>
        <Button
          disabled={act.pending}
          onClick={() => {
            act.run(() => acknowledgeDocument(d.campaignId), {
              title: tr('components.inbox.detail-documents.acknowledged', 'Acknowledged'),
              next: true,
            });
          }}
        >
          {tr(
            'components.inbox.detail-documents.i_have_read_and_understood_it',
            'I have read and understood it',
          )}
        </Button>
        <OpenHere href={item.link} variant="secondary">
          {tr('components.inbox.detail-documents.read_it', 'Read it')}
        </OpenHere>
      </Actions>
    </div>
  );
}

function Access({
  item,
  act,
  d,
}: BodyProps & { readonly d: Extract<DocumentsInboxDetail, { kind: 'access' }> }): JSX.Element {
  const who = item.from?.name ?? tr('components.inbox.detail-documents.they', 'They');
  return (
    <div className="flex flex-col gap-4">
      {item.summary === null ? null : <p className="text-base text-fg-muted">{item.summary}</p>}
      <Actions>
        <Button
          disabled={act.pending}
          onClick={() => {
            act.run(() => decideAccess(d.requestId, true), {
              title: tr('components.inbox.detail-documents.granted', 'Granted'),
              description: tr(
                'components.inbox.detail-documents.who_can_open_it_now',
                '{{who}} can open it now',
                { who },
              ),
              next: true,
            });
          }}
        >
          {tr('components.inbox.detail-documents.grant', 'Grant')}
        </Button>
        <Button
          variant="secondary"
          disabled={act.pending}
          onClick={() => {
            act.run(() => decideAccess(d.requestId, false), {
              title: tr('components.inbox.detail-documents.refused', 'Refused'),
              description: tr(
                'components.inbox.detail-documents.who_is_told',
                '{{who}} is told it was refused',
                { who },
              ),
              next: true,
            });
          }}
        >
          {tr('components.inbox.detail-documents.refuse', 'Refuse')}
        </Button>
        <OpenHere href={item.link} variant="ghost">
          {tr('components.inbox.detail-documents.see_the_document', 'See the document')}
        </OpenHere>
      </Actions>
    </div>
  );
}

export function DocumentsBody(props: BodyProps): JSX.Element {
  const parsed = DocumentsInboxDetail.safeParse(props.item.detail);
  if (parsed.success && props.item.lane === 'task') {
    const d = parsed.data;
    if (d.kind === 'request') return <Request {...props} d={d} />;
    if (d.kind === 'acknowledge') return <Acknowledge {...props} d={d} />;
    return <Access {...props} d={d} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {props.item.summary === null ? null : (
        <p className="text-base text-fg-muted">{props.item.summary}</p>
      )}
      <Actions>
        <OpenHere href={props.item.link}>
          {tr('components.inbox.detail-documents.open_in_documents', 'Open in Documents')}
        </OpenHere>
      </Actions>
    </div>
  );
}
