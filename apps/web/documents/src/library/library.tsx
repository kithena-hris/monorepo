import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  List,
  ListItem,
  PageHeader,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  icons,
} from '@reach/ui';
import { useState, type JSX } from 'react';

import { useTyped } from '../held';
import { Loaded, type Loadable } from '../load';
import { ShareDialog } from '../share';
import { AccessBadge, DocIcon, StatusBadge, meta, shortDate, useWrite } from '../shared';
import { Answers, type AnswersProps } from '../answers';
import { AcrossAnswer } from '../document/reading';
import type {
  Answer,
  Created,
  FilingSuggestion,
  GrantInput,
  LibraryData,
  Outcome,
  QueueKey,
  Read,
  Row,
  StartUpload,
} from '../types';
import { ShareQuestion, UploadDialog, type UploadInput, type UploadPreset } from '../upload';
import { DraftDialog, type DraftProps } from './draft';
import { LettersDialog, type LettersProps } from './letters';
import { SplitDialog, type SplitProps } from './split';

/**
 * The Documents screen (B1, B2, B6, H1, H3; MD1, MH1, MH6): one item, one
 * screen. Search, what needs you, HR's four queues as tiles that filter in
 * place, one dropdown for what the list shows, then every document this
 * person can open, each saying who can see it. Every filter is the address.
 */

export interface LibraryProps {
  readonly load: Loadable<LibraryData>;
  readonly onFilter?: ((patch: Readonly<Record<string, string | null>>) => void) | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
  readonly onStartUpload?: StartUpload | undefined;
  readonly onUpload?: ((input: UploadInput) => Promise<Created>) | undefined;
  readonly onShare?:
    ((documentId: string, grants: readonly GrantInput[]) => Promise<Outcome>) | undefined;
  readonly onAskAfterUpload?: ((ask: boolean) => Promise<Outcome>) | undefined;
  readonly onCreateSection?:
    | ((input: {
        name: string;
        kind: 'personal' | 'company';
        documentIds: readonly string[];
      }) => Promise<Created>)
    | undefined;
  readonly onChangeSection?:
    | ((
        sectionId: string,
        input: { add?: readonly string[]; remove?: readonly string[]; delete?: boolean },
      ) => Promise<Outcome>)
    | undefined;
  readonly onDecideAccess?: ((requestId: string, grant: boolean) => Promise<Outcome>) | undefined;
  readonly onAsk?:
    | ((input: {
        personId: string;
        typeKey: string;
        dueOn: string | null;
        message: string;
      }) => Promise<Outcome>)
    | undefined;
  readonly onRemind?: ((requestId: string) => Promise<Outcome>) | undefined;
  readonly onRestore?: ((documentId: string) => Promise<Outcome>) | undefined;
  readonly onConfirmDeletion?: ((documentIds: readonly string[]) => Promise<Outcome>) | undefined;
  /** B4: a question across what this person may open. */
  readonly onAskAcross?: ((question: string) => Promise<Read<Answer>>) | undefined;
  /** C1: what an upload looks like it is. */
  readonly onSuggest?:
    ((uploadId: string, name: string) => Promise<Read<FilingSuggestion>>) | undefined;
  /** J2: what the record is waiting for, looked for in your own documents. */
  readonly onWaitingFor?: AnswersProps['onWaitingFor'];
  readonly onLookFor?: AnswersProps['onLookFor'];
  readonly onAnswer?: AnswersProps['onAnswer'];
  /** G3: letters from a template, one per person (HR). */
  readonly onPreviewLetters?: LettersProps['onPreviewLetters'];
  readonly onGenerateLetters?: LettersProps['onGenerateLetters'];
  /** §14.2: a document drafted with Kithena, filed and sent to sign (HR). */
  readonly onDraftDocument?: DraftProps['onDraftDocument'];
  readonly onFileDraft?: DraftProps['onFileDraft'];
  /** C2: a scanned stack split into its documents (HR). */
  readonly onProposeSplit?: SplitProps['onProposeSplit'];
  readonly onFileSplit?: SplitProps['onFileSplit'];
}

export function Library(props: LibraryProps): JSX.Element {
  const { load } = props;
  if (load.status === 'loading') {
    return <Skeleton shape="page" label="Loading your documents" />;
  }
  return (
    <div className="flex flex-col gap-6">
      {load.status === 'error' ? <PageHeader title="Documents" /> : null}
      <Loaded load={load} what="your documents">
        {(data) => <Ready data={data} {...props} />}
      </Loaded>
    </div>
  );
}

const href = (id: string) => `/documents/d/${id}`;

function Ready({
  data,
  ...props
}: { readonly data: LibraryData } & Omit<LibraryProps, 'load'>): JSX.Element {
  const [uploading, setUploading] = useState<UploadPreset | null>(null);
  const [asking, setAsking] = useState<{ id: string; title: string } | null>(null);
  const [sharing, setSharing] = useState<{ id: string; title: string } | null>(null);
  const [newSection, setNewSection] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [lettering, setLettering] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [query, type] = useTyped(data.q, (q) => props.onFilter?.({ q: q === '' ? null : q }));
  const [answer, setAnswer] = useState<{ q: string; a: Answer | null; error?: string } | null>(
    null,
  );
  // A search that reads as a question is offered to Kithena; a word or two stays a search.
  const question = query.trim().endsWith('?') || query.trim().split(/\s+/u).length >= 4;
  const askAcross = (): void => {
    const q = query.trim();
    if (props.onAskAcross === undefined || q === '') return;
    setAnswer({ q, a: null });
    void props.onAskAcross(q).then((r) => {
      setAnswer(r.ok ? { q, a: r.data } : { q, a: null, error: r.message });
    });
  };
  const go = (to: string) => (event: { preventDefault: () => void }) => {
    if (props.onNavigate === undefined) return;
    event.preventDefault();
    props.onNavigate(to);
  };
  const upload = (preset: Partial<UploadPreset> = {}): void => {
    setUploading({
      typeKey: null,
      subjectPersonId: null,
      requestId: null,
      sectionId: data.show.startsWith('section:') ? data.show.slice(8) : null,
      ...preset,
    });
  };

  return (
    <>
      <PageHeader
        title={data.deleted ? 'Deleted' : 'Documents'}
        description={
          data.deleted
            ? 'Deleted documents wait 30 days, then are gone. A legal hold keeps them.'
            : `${String(data.total)} document${data.total === 1 ? '' : 's'} you can open`
        }
        actions={
          <>
            {data.viewer.hr && props.onDraftDocument !== undefined ? (
              <Button
                variant="secondary"
                startIcon={<icons.assistant aria-hidden />}
                onClick={() => {
                  setDrafting(true);
                }}
              >
                Draft with Kithena
              </Button>
            ) : null}
            <Button
              variant="primary"
              startIcon={<icons.upload aria-hidden />}
              onClick={() => {
                upload();
              }}
            >
              Add
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  aria-label="More"
                  startIcon={<icons.more aria-hidden />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setNewSection(true);
                  }}
                >
                  New section
                </DropdownMenuItem>
                {data.viewer.hr && props.onGenerateLetters !== undefined ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setLettering(true);
                    }}
                  >
                    Generate letters
                  </DropdownMenuItem>
                ) : null}
                {data.viewer.hr && props.onProposeSplit !== undefined ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setSplitting(true);
                    }}
                  >
                    Split a scan
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    props.onFilter?.({ deleted: data.deleted ? null : 'true', queue: null });
                  }}
                >
                  {data.deleted ? 'Back to documents' : 'Deleted'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <Input
        aria-label="Search documents"
        placeholder="Search documents"
        startAdornment={<icons.search aria-hidden />}
        value={query}
        onChange={(e) => {
          type(e.target.value);
        }}
        className="max-w-xl"
      />
      {question &&
      props.onAskAcross !== undefined &&
      !data.deleted &&
      answer?.q !== query.trim() ? (
        <Button
          variant="secondary"
          className="self-start"
          startIcon={<icons.assistant aria-hidden />}
          onClick={askAcross}
        >
          Ask Kithena
        </Button>
      ) : null}
      {answer === null ? null : answer.a === null ? (
        answer.error === undefined ? (
          <Spinner size="sm" label="Kithena is reading your documents" />
        ) : (
          <Alert tone="danger">{answer.error}</Alert>
        )
      ) : (
        <AcrossAnswer question={answer.q} answer={answer.a} onNavigate={props.onNavigate} />
      )}

      {data.deleted || data.queue !== null || data.q !== '' ? null : (
        <Answers
          documentIds={data.rows
            .filter((r) => (r.mine || r.aboutMe) && r.kind !== 'Medical')
            .slice(0, 5)
            .map((r) => r.id)}
          titles={Object.fromEntries(data.rows.map((r) => [r.id, r.title]))}
          onWaitingFor={props.onWaitingFor}
          onLookFor={props.onLookFor}
          onAnswer={props.onAnswer}
        />
      )}
      {data.needsYou.length > 0 && !data.deleted ? (
        <section className="flex flex-col gap-3" aria-labelledby="needs-you">
          <h2 id="needs-you" className="text-md font-semibold">
            Needs you{' '}
            <Badge tone="accent" size="sm">
              {data.needsYou.length}
            </Badge>
          </h2>
          <List>
            {data.needsYou.map((n) => (
              <ListItem
                key={n.id}
                icon={
                  n.kind === 'request' ? (
                    <icons.upload />
                  ) : n.kind === 'sign' ? (
                    <icons.edit />
                  ) : n.kind === 'acknowledge' ? (
                    <icons.document />
                  ) : (
                    <icons.locked />
                  )
                }
                iconTone="accent"
                description={[n.detail, n.dueOn === null ? null : `Due ${shortDate(n.dueOn)}`]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  n.kind === 'request' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        upload({
                          typeKey: n.typeKey,
                          subjectPersonId: data.viewer.personId,
                          requestId: n.id,
                        });
                      }}
                    >
                      Add it
                    </Button>
                  ) : n.kind === 'sign' || n.kind === 'acknowledge' ? (
                    <Button size="sm" variant="primary" asChild>
                      <a
                        href={
                          n.kind === 'sign'
                            ? `/documents/envelopes/${n.id}`
                            : href(n.documentId ?? '')
                        }
                      >
                        {n.kind === 'sign' ? 'Review and sign' : 'Read it'}
                      </a>
                    </Button>
                  ) : (
                    <AccessDecision id={n.id} onDecide={props.onDecideAccess} />
                  )
                }
              >
                {n.title}
              </ListItem>
            ))}
          </List>
        </section>
      ) : null}

      {data.viewer.hr && !data.deleted ? <Tiles data={data} onFilter={props.onFilter} /> : null}

      {data.queue !== null && !data.deleted ? (
        <QueueList data={data} {...props} />
      ) : (
        <section className="flex flex-col gap-3" aria-label="Every document">
          <div className="flex flex-wrap items-center gap-3">
            <ShowPicker
              data={data}
              onShow={(show) => props.onFilter?.({ show: show === 'all' ? null : show })}
              onNew={() => {
                setNewSection(true);
              }}
            />
          </div>
          {data.rows.length === 0 ? (
            <EmptyState
              icon={<icons.folder />}
              title={data.q === '' ? 'Nothing here yet' : `Nothing matches “${data.q}”`}
              description={
                data.deleted
                  ? 'Nothing has been deleted in the last 30 days.'
                  : 'Add a document, or choose another section.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Access</TableHead>
                  <TableHead>Who can see it</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <DocumentRow
                    key={row.id}
                    row={row}
                    deleted={data.deleted}
                    onOpen={go(href(row.id))}
                    onShare={() => {
                      setSharing({ id: row.id, title: row.title });
                    }}
                    onRestore={props.onRestore}
                    sections={data.sections}
                    onChangeSection={props.onChangeSection}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      )}

      {uploading === null ? null : (
        <UploadDialog
          open
          onOpenChange={(open) => {
            if (!open) setUploading(null);
          }}
          hr={data.viewer.hr}
          types={data.types}
          people={data.people}
          preset={uploading}
          onStartUpload={props.onStartUpload}
          onUpload={props.onUpload}
          onSuggest={props.onSuggest}
          onDone={(id, title, typed) => {
            // A typed document follows its type's access; only one's own gets the question.
            if (!typed && data.viewer.askAfterUpload) setAsking({ id, title });
          }}
        />
      )}
      <ShareQuestion
        open={asking !== null}
        title={asking?.title ?? ''}
        onKeep={() => {
          setAsking(null);
        }}
        onShare={() => {
          setSharing(asking);
          setAsking(null);
        }}
        onStopAsking={
          props.onAskAfterUpload === undefined
            ? undefined
            : () => {
                void props.onAskAfterUpload?.(false);
              }
        }
      />
      {sharing === null ? null : (
        <ShareDialog
          open
          onOpenChange={(open) => {
            if (!open) setSharing(null);
          }}
          title={sharing.title}
          documentId={sharing.id}
          grants={[]}
          people={data.people}
          me={data.viewer.personId}
          hr={data.viewer.hr}
          onShare={props.onShare}
        />
      )}
      {drafting ? (
        <DraftDialog
          open
          onOpenChange={setDrafting}
          onDraftDocument={props.onDraftDocument}
          onFileDraft={props.onFileDraft}
          onDone={(to) => {
            setDrafting(false);
            props.onNavigate?.(to);
          }}
        />
      ) : null}
      {lettering ? (
        <LettersDialog
          open
          onOpenChange={setLettering}
          templates={data.rows.filter((r) => r.kind === 'Template' && r.deletedAt === null)}
          people={data.people}
          onPreviewLetters={props.onPreviewLetters}
          onGenerateLetters={props.onGenerateLetters}
          onDone={() => {
            props.onFilter?.({ q: null });
          }}
        />
      ) : null}
      {splitting ? (
        <SplitDialog
          open
          onOpenChange={setSplitting}
          types={data.types}
          people={data.people}
          onStartUpload={props.onStartUpload}
          onProposeSplit={props.onProposeSplit}
          onFileSplit={props.onFileSplit}
        />
      ) : null}
      <NewSection
        open={newSection}
        onOpenChange={setNewSection}
        hr={data.viewer.hr}
        onCreate={props.onCreateSection}
        onCreated={(id) => props.onFilter?.({ show: `section:${id}` })}
      />
    </>
  );
}

function AccessDecision({
  id,
  onDecide,
}: {
  readonly id: string;
  readonly onDecide: LibraryProps['onDecideAccess'];
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

/** HR's four queues (H1): each tile filters the list below; the open one says so. */
function Tiles({
  data,
  onFilter,
}: {
  readonly data: LibraryData;
  readonly onFilter: LibraryProps['onFilter'];
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="list" aria-label="Queues">
      {data.tiles.map((t) => {
        const on = data.queue === t.key;
        return (
          <div role="listitem" key={t.key}>
            <Card
              interactive
              padded
              variant={on ? 'outline' : 'raised'}
              className="relative h-full"
            >
              <a
                href={`/documents/all?queue=${t.key}`}
                aria-current={on ? 'true' : undefined}
                className="flex flex-col gap-1 after:absolute after:inset-0"
                onClick={(e) => {
                  if (onFilter === undefined) return;
                  e.preventDefault();
                  onFilter({ queue: on ? null : t.key });
                }}
              >
                <span className="text-sm text-fg-muted">{t.label}</span>
                <span className="text-2xl font-semibold tabular-nums">{t.count}</span>
                <span className="text-sm text-fg-muted">{t.detail}</span>
              </a>
            </Card>
          </div>
        );
      })}
    </div>
  );
}

const QUEUE_TITLES: Record<QueueKey, string> = {
  to_sign: 'Waiting for a signature',
  expiring: 'Expiring in 60 days',
  missing: 'Missing from people’s files',
  to_delete: 'Retention ended',
};

function QueueList({
  data,
  ...props
}: { readonly data: LibraryData } & Omit<LibraryProps, 'load'>): JSX.Element {
  const queue = data.queue ?? 'expiring';
  const [asking, setAsking] = useState<{ personId: string; typeKey: string; name: string } | null>(
    null,
  );
  const write = useWrite();
  const deletable = data.queueRows
    .filter((r) => r.action === 'confirm_delete')
    .map((r) => r.documentId ?? '');
  return (
    <section className="flex flex-col gap-3" aria-label={QUEUE_TITLES[queue]}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          tone="accent"
          onRemove={() => props.onFilter?.({ queue: null })}
          removeLabel="Show every document"
        >
          {QUEUE_TITLES[queue]}
        </Badge>
        {queue === 'to_delete' && deletable.length > 0 ? (
          <Button
            size="sm"
            variant="danger"
            loading={write.pending}
            onClick={() => {
              write.run(
                () => props.onConfirmDeletion?.(deletable) ?? Promise.resolve({ ok: true }),
              );
            }}
          >
            Delete {deletable.length}
          </Button>
        ) : null}
      </div>
      {write.error === null ? null : (
        <Alert tone="danger" title="Not deleted">
          {write.error}
        </Alert>
      )}
      {data.queueRows.length === 0 ? (
        <EmptyState icon={<icons.success />} title="Nothing in this queue" />
      ) : (
        <List>
          {data.queueRows.map((r) => (
            <ListItem
              key={r.id}
              leading={
                r.person === null ? (
                  <DocIconFor kind={r.kind} />
                ) : (
                  <Avatar name={r.person.name} size="lg" />
                )
              }
              description={r.detail}
              trailing={
                (r.action === 'sign' || r.action === 'view') &&
                r.requestId !== null &&
                queue === 'to_sign' ? (
                  <Button size="sm" variant={r.action === 'sign' ? 'primary' : 'secondary'} asChild>
                    <a href={`/documents/envelopes/${r.requestId}`}>
                      {r.action === 'sign' ? 'Sign' : 'Open'}
                    </a>
                  </Button>
                ) : r.action === 'view' && r.documentId !== null ? (
                  <Button size="sm" variant="secondary" asChild>
                    <a href={href(r.documentId)}>Open</a>
                  </Button>
                ) : r.action === 'remind' && r.requestId !== null ? (
                  <Remind id={r.requestId} onRemind={props.onRemind} />
                ) : r.action === 'ask' && r.person !== null && r.typeKey !== null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (r.person !== null && r.typeKey !== null) {
                        setAsking({
                          personId: r.person.personId,
                          typeKey: r.typeKey,
                          name: r.person.name,
                        });
                      }
                    }}
                  >
                    Ask
                  </Button>
                ) : r.documentId === null ? null : (
                  <Badge tone={r.tone} size="sm">
                    {r.dueOn === null ? 'Due' : shortDate(r.dueOn)}
                  </Badge>
                )
              }
            >
              {r.title}
            </ListItem>
          ))}
        </List>
      )}
      {asking === null ? null : (
        <AskDialog
          open
          onOpenChange={(open) => {
            if (!open) setAsking(null);
          }}
          personId={asking.personId}
          name={asking.name}
          typeKey={asking.typeKey}
          types={data.types}
          onAsk={props.onAsk}
        />
      )}
    </section>
  );
}

const DocIconFor = ({ kind }: { readonly kind: Row['kind'] }): JSX.Element => (
  <DocIcon kind={kind} />
);

export function Remind({
  id,
  onRemind,
}: {
  readonly id: string;
  readonly onRemind: ((id: string) => Promise<Outcome>) | undefined;
}): JSX.Element {
  const write = useWrite();
  const [sent, setSent] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={write.pending || sent}
      onClick={() => {
        write.run(
          () => onRemind?.(id) ?? Promise.resolve({ ok: true }),
          () => {
            setSent(true);
          },
        );
      }}
    >
      {sent ? 'Reminded' : 'Remind'}
    </Button>
  );
}

/** Asking somebody for a document (H2, MH3): a task in their Inbox. */
export function AskDialog({
  open,
  onOpenChange,
  personId,
  name,
  typeKey,
  types,
  onAsk,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly personId: string;
  readonly name: string;
  readonly typeKey: string;
  readonly types: LibraryData['types'];
  readonly onAsk: LibraryProps['onAsk'];
}): JSX.Element {
  const first = name.split(' ')[0] ?? name;
  const [key, setKey] = useState(typeKey);
  const typeName = types.find((t) => t.key === key)?.name ?? 'document';
  const [message, setMessage] = useState(
    `Hi ${first}, we need your ${typeName.toLowerCase()}. A photo is fine.`,
  );
  const write = useWrite();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ask {first} for a document</DialogTitle>
          <DialogDescription>
            {first} gets a task in their Inbox; their upload is filed and ticked off here.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>Document</FieldLabel>
            <Select value={key} onValueChange={setKey}>
              <FieldControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent>
                {types
                  .filter((t) => t.filedTo === 'person')
                  .map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Message</FieldLabel>
            <FieldControl>
              <Input
                value={message}
                maxLength={2000}
                onChange={(e) => {
                  setMessage(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {write.error === null ? null : (
            <Alert tone="danger" title="Not sent">
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
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={write.pending}
            onClick={() => {
              write.run(
                () =>
                  onAsk?.({ personId, typeKey: key, dueOn: null, message }) ??
                  Promise.resolve({ ok: true }),
                () => {
                  onOpenChange(false);
                },
              );
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One dropdown for what the list shows (B6): views, company sections, then your own. */
function ShowPicker({
  data,
  onShow,
  onNew,
}: {
  readonly data: LibraryData;
  readonly onShow: (show: string) => void;
  readonly onNew: () => void;
}): JSX.Element {
  const company = data.sections.filter((s) => s.kind === 'company');
  const mine = data.sections.filter((s) => s.kind === 'personal');
  return (
    <Select
      value={data.show}
      onValueChange={(v) => {
        if (v === '__new') onNew();
        else onShow(v);
      }}
    >
      <SelectTrigger aria-label="Show" className="min-w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="all">All documents</SelectItem>
          <SelectItem value="about-me">About me</SelectItem>
          <SelectItem value="shared">Shared with me</SelectItem>
          <SelectItem value="mine">My own</SelectItem>
          <SelectItem value="company">Company</SelectItem>
          {data.viewer.hr ? <SelectItem value="people">People files</SelectItem> : null}
        </SelectGroup>
        {company.length === 0 ? null : (
          <>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Company · set up by HR</SelectLabel>
              {company.map((s) => (
                <SelectItem key={s.id} value={`section:${s.id}`}>
                  {s.name} ({s.count})
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Yours · only you see these</SelectLabel>
          {mine.map((s) => (
            <SelectItem key={s.id} value={`section:${s.id}`}>
              {s.name} ({s.count})
            </SelectItem>
          ))}
          <SelectItem value="__new">New section…</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function DocumentRow({
  row,
  deleted,
  onOpen,
  onShare,
  onRestore,
  sections,
  onChangeSection,
}: {
  readonly row: Row;
  readonly deleted: boolean;
  readonly onOpen: (event: { preventDefault: () => void }) => void;
  readonly onShare: () => void;
  readonly onRestore: LibraryProps['onRestore'];
  readonly sections: LibraryData['sections'];
  readonly onChangeSection: LibraryProps['onChangeSection'];
}): JSX.Element {
  const write = useWrite();
  const mine = sections.filter((s) => s.kind === 'personal');
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-3">
          <DocIcon kind={row.kind} />
          <div className="min-w-0">
            {deleted ? (
              <span className="font-semibold">{row.title}</span>
            ) : (
              <a href={href(row.id)} onClick={onOpen} className="font-semibold hover:underline">
                {row.title}
              </a>
            )}
            <p className="truncate text-sm text-fg-muted">{meta(row)}</p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <AccessBadge row={row} />
      </TableCell>
      <TableCell>
        <span className="text-sm text-fg-muted">{row.who.label}</span>
      </TableCell>
      <TableCell>
        <span className="text-sm text-fg-muted">{shortDate(row.updatedAt)}</span>
      </TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell>
        {deleted ? (
          <Button
            size="sm"
            variant="secondary"
            loading={write.pending}
            onClick={() => {
              write.run(() => onRestore?.(row.id) ?? Promise.resolve({ ok: true }));
            }}
          >
            Restore
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`More for ${row.title}`}
                startIcon={<icons.more aria-hidden />}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <a href={href(row.id)} onClick={onOpen}>
                  Open
                </a>
              </DropdownMenuItem>
              {row.mine && !row.aboutMe ? (
                <DropdownMenuItem onSelect={onShare}>Share…</DropdownMenuItem>
              ) : null}
              {mine.length === 0 ? null : <DropdownMenuSeparator />}
              {mine.map((s) => {
                const inIt = row.sectionIds.includes(s.id);
                return (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => {
                      write.run(
                        () =>
                          onChangeSection?.(
                            s.id,
                            inIt ? { remove: [row.id] } : { add: [row.id] },
                          ) ?? Promise.resolve({ ok: true }),
                      );
                    }}
                  >
                    {inIt ? `Remove from ${s.name}` : `Add to ${s.name}`}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

/** A personal section (B5, MD5): one field; sections organise, they never share. */
function NewSection({
  open,
  onOpenChange,
  hr,
  onCreate,
  onCreated,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly hr: boolean;
  readonly onCreate: LibraryProps['onCreateSection'];
  readonly onCreated: (id: string) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'personal' | 'company'>('personal');
  const write = useWrite();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New section</DialogTitle>
          <DialogDescription>
            {kind === 'personal'
              ? 'Only you see it. Documents keep their own access.'
              : 'Everyone sees it, with only the documents each of them can open.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <Field required>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          {hr ? (
            <Field>
              <FieldLabel>For</FieldLabel>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v === 'company' ? 'company' : 'personal');
                }}
              >
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent>
                  <SelectItem value="personal">Only me</SelectItem>
                  <SelectItem value="company">The company</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {write.error === null ? null : (
            <Alert tone="danger" title="Not created">
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
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={write.pending}
            disabled={name.trim() === ''}
            onClick={() => {
              write.run(async () => {
                const made = await (onCreate?.({ name, kind, documentIds: [] }) ??
                  Promise.resolve({ ok: false as const, message: 'Not available here' }));
                if (!made.ok) return made;
                setName('');
                onOpenChange(false);
                onCreated(made.id);
                return { ok: true };
              });
            }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
