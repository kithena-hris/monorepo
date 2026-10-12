import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropzone,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  KeyValues,
  List,
  ListItem,
  PageHeader,
  Skeleton,
  Spinner,
  Switch,
  icons,
} from '@reach/ui';
import { useEffect, useState, type JSX } from 'react';

import { Loaded, type Loadable } from '../load';
import { ShareDialog } from '../share';
import { Reading, type ReadingProps } from './reading';
import { AccessBadge, StatusBadge, pages, putFile, shortDate, useWrite } from '../shared';
import type { DocumentData, FileLink, FileRef, GrantInput, Outcome, StartUpload } from '../types';

/**
 * A document (D1, E2, E3; MR1, MR4, MA2): the page itself, then who can see
 * it and why, its versions, and what its owner and HR may do. A Confidential
 * document is drawn from a copy carrying the viewer's name; one you cannot
 * open says who owns it and offers one way forward.
 */

export interface DocumentViewProps {
  readonly load: Loadable<DocumentData>;
  readonly onNavigate?: ((href: string) => void) | undefined;
  readonly onStartUpload?: StartUpload | undefined;
  readonly onFileLink?: FileLink | undefined;
  readonly onAddVersion?:
    ((id: string, upload: FileRef, note: string | null) => Promise<Outcome>) | undefined;
  readonly onShare?: ((id: string, grants: readonly GrantInput[]) => Promise<Outcome>) | undefined;
  readonly onConfidential?: ((id: string, on: boolean) => Promise<Outcome>) | undefined;
  readonly onRename?: ((id: string, title: string) => Promise<Outcome>) | undefined;
  readonly onDelete?: ((id: string) => Promise<Outcome>) | undefined;
  readonly onRestore?: ((id: string) => Promise<Outcome>) | undefined;
  readonly onRequestAccess?: ((id: string, reason: string) => Promise<Outcome>) | undefined;
  readonly onDecideAccess?: ((requestId: string, grant: boolean) => Promise<Outcome>) | undefined;
  readonly onAcknowledge?: ((campaignId: string) => Promise<Outcome>) | undefined;
  readonly onSendForAcknowledgement?:
    | ((
        documentId: string,
        audience: { kind: 'everyone' },
        dueOn: string | null,
      ) => Promise<{ ok: true; id: string } | { ok: false; message: string }>)
    | undefined;
  readonly path?: string | undefined;
  readonly onSummarize?: ReadingProps['onSummarize'];
  readonly onAskDocument?: ReadingProps['onAsk'];
  readonly onCompare?: ReadingProps['onCompare'];
}

export function DocumentView(props: DocumentViewProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') return <Skeleton shape="page" label="Loading the document" />;
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Document" /> : null}
      <Loaded load={load} what="the document">
        {(data) =>
          data.document === null ? (
            <Closed
              owner={data.closed?.owner ?? 'Its owner'}
              requested={data.closed?.requested === true}
              {...props}
            />
          ) : (
            <Open doc={data.document} {...props} />
          )
        }
      </Loaded>
    </div>
  );
}

const idOf = (path: string | undefined): string => (path ?? '').split('/')[3] ?? '';

function Closed({
  owner,
  requested,
  path,
  onRequestAccess,
}: { readonly owner: string; readonly requested: boolean } & DocumentViewProps): JSX.Element {
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(requested);
  const write = useWrite();
  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 py-8">
      <EmptyState
        icon={<icons.locked />}
        title="You can’t open this yet"
        description={`${owner} owns it. They’ll get a task in their Inbox, and you’ll hear back as an update.`}
      />
      {sent ? (
        <Alert tone="success" title="Asked">
          {owner} will decide.
        </Alert>
      ) : (
        <>
          <Field required>
            <FieldLabel>Why you need it</FieldLabel>
            <FieldControl>
              <Input
                value={reason}
                maxLength={1000}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
          <Button
            variant="primary"
            startIcon={<icons.send aria-hidden />}
            loading={write.pending}
            disabled={reason.trim() === ''}
            onClick={() => {
              write.run(
                () => onRequestAccess?.(idOf(path), reason) ?? Promise.resolve({ ok: true }),
                () => {
                  setSent(true);
                },
              );
            }}
          >
            Ask for access
          </Button>
        </>
      )}
    </div>
  );
}

type Doc = NonNullable<DocumentData['document']>;

function Open({ doc, ...props }: { readonly doc: Doc } & DocumentViewProps): JSX.Element {
  const { row } = doc;
  const [sharing, setSharing] = useState(false);
  const [versioning, setVersioning] = useState(false);
  const write = useWrite();
  const deleted = row.deletedAt !== null;
  const download = (): void => {
    write.run(async () => {
      const link = await (props.onFileLink?.(row.id, 'download') ??
        Promise.resolve({ ok: false as const, message: 'Not available here' }));
      if (!link.ok) return link;
      window.location.assign(link.url);
      return { ok: true };
    });
  };
  return (
    <>
      <PageHeader
        title={row.title}
        description={[row.typeName ?? 'Your document', row.subject?.name ?? null, pages(row.pages)]
          .filter(Boolean)
          .join(' · ')}
        actions={
          deleted ? (
            doc.may.delete ? (
              <Button
                variant="primary"
                loading={write.pending}
                onClick={() => {
                  write.run(() => props.onRestore?.(row.id) ?? Promise.resolve({ ok: true }));
                }}
              >
                Restore
              </Button>
            ) : undefined
          ) : (
            <>
              {doc.may.download ? (
                <Button
                  variant="secondary"
                  startIcon={<icons.download aria-hidden />}
                  onClick={download}
                >
                  Download
                </Button>
              ) : null}
              {doc.may.share &&
              doc.pdf &&
              (doc.signing === null || doc.signing.status !== 'sent') ? (
                <Button variant="secondary" startIcon={<icons.edit aria-hidden />} asChild>
                  <a
                    href={`/documents/d/${row.id}/send`}
                    onClick={(e) => {
                      if (props.onNavigate === undefined) return;
                      e.preventDefault();
                      props.onNavigate(`/documents/d/${row.id}/send`);
                    }}
                  >
                    Request signature
                  </a>
                </Button>
              ) : null}
              {doc.may.share ? (
                <Button
                  variant="primary"
                  startIcon={<icons.share aria-hidden />}
                  onClick={() => {
                    setSharing(true);
                  }}
                >
                  Share
                </Button>
              ) : null}
            </>
          )
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <AccessBadge row={row} />
        <StatusBadge status={row.status} />
        {doc.held ? (
          <Badge tone="danger" size="sm">
            Legal hold
          </Badge>
        ) : null}
      </div>
      {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Preview doc={doc} onFileLink={props.onFileLink} />
        <div className="flex flex-col gap-4">
          {deleted || !doc.pdf ? null : (
            <Reading
              documentId={row.id}
              current={doc.current.n}
              onSummarize={props.onSummarize}
              onAsk={props.onAskDocument}
              onCompare={props.onCompare}
            />
          )}
          {row.confidential ? (
            <Alert tone="warning" title="Confidential" icon={<icons.sensitive />}>
              {doc.may.download
                ? 'Your name is on every page you view. You can download it; most people cannot.'
                : 'Your name is on every page. It cannot be downloaded or printed, and every open is logged.'}
            </Alert>
          ) : null}
          <Card padded>
            <KeyValues
              layout="split"
              items={[
                { label: 'Who can see it', value: row.who.label },
                { label: 'Owner', value: doc.owner },
                {
                  label: 'Version',
                  value: `${String(doc.current.n)} of ${String(doc.versions.length)} · ${shortDate(doc.current.uploadedAt)}`,
                },
                ...(row.expiresOn === null
                  ? []
                  : [{ label: 'Expires', value: shortDate(row.expiresOn) }]),
              ]}
            />
          </Card>
          {doc.signing === null ? null : (
            <Card padded>
              <div className="flex flex-col gap-2">
                <span className="font-semibold">
                  {doc.signing.status === 'sent'
                    ? `Out for signature · ${String(doc.signing.signed)} of ${String(doc.signing.of)} signed`
                    : doc.signing.status === 'completed'
                      ? 'Signed and sealed'
                      : `Signature request ${doc.signing.status}`}
                </span>
                <Button
                  asChild
                  size="sm"
                  variant={
                    doc.signing.mine && doc.signing.status === 'sent' ? 'primary' : 'secondary'
                  }
                  className="self-start"
                >
                  <a href={`/documents/envelopes/${doc.signing.id}`}>
                    {doc.signing.mine && doc.signing.status === 'sent'
                      ? 'Review and sign'
                      : 'Open the request'}
                  </a>
                </Button>
              </div>
            </Card>
          )}
          {doc.campaigns.map((c) => (
            <Card padded key={c.id}>
              <div className="flex flex-col gap-2">
                <span className="font-semibold">
                  {c.asked && !c.acknowledged
                    ? 'Read it, then acknowledge it'
                    : `Acknowledged by ${String(c.done)} of ${String(c.of)}`}
                </span>
                {c.asked && !c.acknowledged ? (
                  <Acknowledge id={c.id} onAcknowledge={props.onAcknowledge} />
                ) : c.asked ? (
                  <Badge tone="success" size="sm">
                    You acknowledged it
                  </Badge>
                ) : (
                  <Button asChild size="sm" variant="secondary" className="self-start">
                    <a href={`/documents/campaigns/${c.id}`}>See who is left</a>
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {doc.may.share && !deleted && doc.row.typeKey !== null && doc.row.subject === null ? (
            <SendAsPolicy id={row.id} onSend={props.onSendForAcknowledgement} />
          ) : null}
          {!deleted && (doc.may.protect || doc.may.unprotect) ? (
            <Card padded>
              <ProtectSwitch doc={doc} onConfidential={props.onConfidential} />
            </Card>
          ) : null}
          {doc.accessRequests.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>Asked to open it</CardTitle>
              </CardHeader>
              <CardContent>
                <List>
                  {doc.accessRequests.map((r) => (
                    <ListItem
                      key={r.id}
                      description={r.reason}
                      trailing={<Decide id={r.id} onDecide={props.onDecideAccess} />}
                    >
                      {r.who}
                    </ListItem>
                  ))}
                </List>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle level={2}>Versions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <List>
                {doc.versions.map((v) => (
                  <ListItem
                    key={v.n}
                    description={[shortDate(v.uploadedAt), v.uploadedBy, v.note]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    Version {v.n}
                  </ListItem>
                ))}
              </List>
              {doc.may.edit && !deleted ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  startIcon={<icons.upload aria-hidden />}
                  onClick={() => {
                    setVersioning(true);
                  }}
                >
                  New version
                </Button>
              ) : null}
            </CardContent>
          </Card>
          {doc.views.length + doc.activity.length === 0 ? null : (
            <Card>
              <CardHeader>
                <CardTitle level={2}>Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <List>
                  {[
                    ...doc.views.map((v) => ({
                      ...v,
                      action: v.action === 'view' ? 'viewed' : 'downloaded',
                    })),
                    ...doc.activity,
                  ]
                    .toSorted((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 12)
                    .map((a, i) => (
                      <ListItem key={`${a.at}-${String(i)}`} description={shortDate(a.at)}>
                        {a.who} {a.action.replaceAll('_', ' ')}
                      </ListItem>
                    ))}
                </List>
              </CardContent>
            </Card>
          )}
          {doc.may.delete && !deleted ? (
            <Button
              variant="ghost"
              className="self-start"
              startIcon={<icons.delete aria-hidden />}
              disabled={doc.held || write.pending}
              onClick={() => {
                write.run(
                  () => props.onDelete?.(row.id) ?? Promise.resolve({ ok: true }),
                  () => props.onNavigate?.('/documents/all'),
                );
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </div>
      {sharing ? (
        <ShareDialog
          open
          onOpenChange={setSharing}
          title={row.title}
          documentId={row.id}
          grants={doc.grants}
          people={doc.people}
          me={null}
          hr={false}
          onShare={props.onShare}
        />
      ) : null}
      {versioning ? (
        <NewVersion
          open
          onOpenChange={setVersioning}
          id={row.id}
          onStartUpload={props.onStartUpload}
          onAddVersion={props.onAddVersion}
        />
      ) : null}
    </>
  );
}

/** The page itself: the browser's own PDF viewer, or the image, from a link that lasts minutes. */
function Preview({
  doc,
  onFileLink,
}: {
  readonly doc: Doc;
  readonly onFileLink: FileLink | undefined;
}): JSX.Element {
  const [link, setLink] = useState<{ url: string; mediaType: string } | { error: string } | null>(
    null,
  );
  const deleted = doc.row.deletedAt !== null;
  useEffect(() => {
    if (deleted || onFileLink === undefined) return;
    let live = true;
    void onFileLink(doc.row.id, 'view').then((got) => {
      if (live)
        setLink(got.ok ? { url: got.url, mediaType: got.mediaType } : { error: got.message });
    });
    return () => {
      live = false;
    };
  }, [doc.row.id, doc.current.n, deleted, onFileLink]);
  if (deleted) {
    return (
      <EmptyState icon={<icons.delete />} title="In Deleted" description="Restore it to open it." />
    );
  }
  if (link === null) {
    return (
      <Card variant="fill" className="grid min-h-[36rem] place-items-center">
        <Spinner label="Opening the document" />
      </Card>
    );
  }
  if ('error' in link)
    return (
      <Alert tone="danger" title="Could not open it">
        {link.error}
      </Alert>
    );
  if (link.mediaType.startsWith('image/')) {
    return (
      <Card variant="fill" className="flex justify-center p-4">
        <img
          src={link.url}
          alt={doc.row.title}
          className="max-h-[48rem] max-w-full object-contain"
        />
      </Card>
    );
  }
  if (link.mediaType === 'application/pdf') {
    return (
      <Card variant="fill" className="overflow-hidden">
        <iframe title={doc.row.title} src={link.url} className="h-[48rem] w-full" />
      </Card>
    );
  }
  return (
    <EmptyState
      icon={<icons.file />}
      title={doc.current.fileName}
      description="This kind of file opens in its own app."
      action={
        <Button asChild variant="secondary">
          <a href={link.url}>Open</a>
        </Button>
      }
    />
  );
}

function ProtectSwitch({
  doc,
  onConfidential,
}: {
  readonly doc: Doc;
  readonly onConfidential: DocumentViewProps['onConfidential'];
}): JSX.Element {
  const write = useWrite();
  return (
    <div className="flex flex-col gap-2">
      <Field orientation="horizontal">
        <FieldLabel>Confidential</FieldLabel>
        <FieldControl>
          <Switch
            checked={doc.row.confidential}
            disabled={write.pending}
            onCheckedChange={(on) => {
              write.run(() => onConfidential?.(doc.row.id, on) ?? Promise.resolve({ ok: true }));
            }}
          />
        </FieldControl>
      </Field>
      <p className="text-sm text-fg-muted">
        A watermark, no download or print, and every open logged.
        {doc.confidentialBy === 'hr' || doc.confidentialBy === 'type'
          ? ' Set by HR: only HR can lower it.'
          : ''}
      </p>
      {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
    </div>
  );
}

function Decide({
  id,
  onDecide,
}: {
  readonly id: string;
  readonly onDecide: DocumentViewProps['onDecideAccess'];
}): JSX.Element {
  const write = useWrite();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={write.pending}
        onClick={() => {
          write.run(() => onDecide?.(id, false) ?? Promise.resolve({ ok: true }));
        }}
      >
        Refuse
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={write.pending}
        onClick={() => {
          write.run(() => onDecide?.(id, true) ?? Promise.resolve({ ok: true }));
        }}
      >
        Grant
      </Button>
    </div>
  );
}

function Acknowledge({
  id,
  onAcknowledge,
}: {
  readonly id: string;
  readonly onAcknowledge: DocumentViewProps['onAcknowledge'];
}): JSX.Element {
  const write = useWrite();
  return (
    <Button
      size="sm"
      variant="primary"
      className="self-start"
      loading={write.pending}
      onClick={() => {
        write.run(() => onAcknowledge?.(id) ?? Promise.resolve({ ok: true }));
      }}
    >
      I’ve read it
    </Button>
  );
}

/** Sending a policy out (F2): to everyone, to read and acknowledge. */
function SendAsPolicy({
  id,
  onSend,
}: {
  readonly id: string;
  readonly onSend: DocumentViewProps['onSendForAcknowledgement'];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const write = useWrite();
  return (
    <>
      <Button
        variant="secondary"
        className="self-start"
        startIcon={<icons.send aria-hidden />}
        onClick={() => {
          setOpen(true);
        }}
      >
        Ask everyone to acknowledge it
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send for acknowledgement</DialogTitle>
            <DialogDescription>
              Everyone at the company gets a task to read it and say so. New joiners are asked too.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={write.pending}
              onClick={() => {
                write.run(
                  async () => {
                    const sent = await (onSend?.(id, { kind: 'everyone' }, null) ??
                      Promise.resolve({ ok: true as const, id: '' }));
                    return sent.ok ? { ok: true } : sent;
                  },
                  () => {
                    setOpen(false);
                  },
                );
              }}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A new version, not a duplicate (C4): the same document, the next version. */
function NewVersion({
  open,
  onOpenChange,
  id,
  onStartUpload,
  onAddVersion,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly id: string;
  readonly onStartUpload: StartUpload | undefined;
  readonly onAddVersion: DocumentViewProps['onAddVersion'];
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const write = useWrite();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New version</DialogTitle>
          <DialogDescription>
            Everyone who can open it sees the new version; the old ones stay.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Dropzone
            label={file === null ? 'Drop the new file, or choose it' : file.name}
            variant="inline"
            onFiles={(files) => {
              setFile(files[0] ?? null);
            }}
          />
          <Field>
            <FieldLabel>What changed</FieldLabel>
            <FieldControl>
              <Input
                value={note}
                maxLength={500}
                onChange={(e) => {
                  setNote(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {write.error === null ? null : <Alert tone="danger">{write.error}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={write.pending}
            disabled={file === null}
            onClick={() => {
              if (file === null) return;
              write.run(
                async () => {
                  if (onStartUpload === undefined)
                    return { ok: false, message: 'Not available here' };
                  const put = await putFile(file, onStartUpload);
                  if (!put.ok) return put;
                  return onAddVersion?.(id, put.ref, note.trim() || null) ?? { ok: true };
                },
                () => {
                  onOpenChange(false);
                },
              );
            }}
          >
            Add version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
