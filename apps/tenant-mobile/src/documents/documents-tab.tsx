import {
  ActionSheet,
  ActionSheetContent,
  ActionSheetItem,
  Alert,
  Badge,
  Button,
  Chip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldControl,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Stat,
  Text,
} from '@reach/ui-native';
import {
  FileUp,
  FolderOpen,
  FolderPlus,
  PenLine,
  Plus,
  ScanLine,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import { Answers } from './answers';
import { AcrossAnswer, type Answer } from './reading';
import type { PeopleScreen } from '../people/routes';
import {
  access,
  askDocuments,
  chooseFile,
  meta,
  putFile,
  scan,
  useDocuments,
  type FileRef,
  type Picked,
  type PersonRef,
  type Row,
  type TypeOption,
} from './api';
import { t as tr } from '../i18n';

/**
 * The Documents tab (MD1, MD2, MD4–MD6, MH1, MH6): one scroll, no
 * sub-pages. A search, what needs you, HR's queues as tiles that filter the
 * same scroll, one dropdown for what the list shows, then every document you
 * can open. The + offers scanning first: on a phone most documents start as
 * paper.
 */

interface Library {
  readonly viewer: { hr: boolean; personId: string | null; askAfterUpload: boolean };
  readonly show: string;
  readonly queue: string | null;
  readonly sections: readonly {
    id: string;
    kind: 'company' | 'personal';
    name: string;
    count: number;
  }[];
  readonly needsYou: readonly {
    id: string;
    kind: 'request' | 'access_request' | 'sign' | 'acknowledge';
    title: string;
    detail: string;
    dueOn: string | null;
    documentId: string | null;
    typeKey: string | null;
  }[];
  readonly tiles: readonly { key: string; label: string; count: number; detail: string }[];
  readonly queueRows: readonly {
    id: string;
    title: string;
    person: PersonRef | null;
    detail: string;
    documentId: string | null;
    requestId: string | null;
    typeKey: string | null;
    action: string;
  }[];
  readonly rows: readonly Row[];
  readonly types: readonly TypeOption[];
  readonly people: readonly PersonRef[];
}

interface Filing {
  readonly file: Picked;
  readonly typeKey: string | null;
  readonly subjectPersonId: string | null;
  readonly requestId: string | null;
}

export function DocumentsHome({ navigation }: PeopleScreen<'Documents'>): React.JSX.Element {
  const signed = useSigned();
  const [show, setShow] = useState('all');
  const [q, setQ] = useState('');
  const [queue, setQueue] = useState<string | null>(null);
  const { load, reload } = useDocuments<Library>('DocumentsLibrary', {
    show,
    q,
    queue,
    deleted: false,
  });
  const [adding, setAdding] = useState<{ typeKey: string | null; requestId: string | null } | null>(
    null,
  );
  const [filing, setFiling] = useState<Filing | null>(null);
  const [asking, setAsking] = useState<{ id: string; title: string } | null>(null);
  const [newSection, setNewSection] = useState(false);
  const [across, setAcross] = useState<{ q: string; a: Answer | null; error?: string } | null>(
    null,
  );
  // A search that reads as a question goes to Kithena (MR5); a word or two stays a search.
  const isQuestion = q.trim().endsWith('?') || q.trim().split(/\s+/u).length >= 4;
  const askAcross = (): void => {
    const question = q.trim();
    setAcross({ q: question, a: null });
    void askDocuments<Answer>(signed, 'AskDocuments', { input: { question } }).then((r) => {
      setAcross(r.ok ? { q: question, a: r.data } : { q: question, a: null, error: r.message });
    });
  };
  const plus = (
    <Button
      size="sm"
      variant="primary"
      accessibilityLabel={tr('documents.documents-tab.add_a_document', 'Add a document')}
      startIcon={<Icon icon={Plus} tone="on-accent" />}
      onPress={() => {
        setAdding({ typeKey: null, requestId: null });
      }}
    >
      {tr('documents.documents-tab.add', 'Add')}
    </Button>
  );
  const pick = async (how: 'scan' | 'file'): Promise<void> => {
    const preset = adding;
    setAdding(null);
    const file = how === 'scan' ? await scan() : await chooseFile();
    if (file === null || preset === null) return;
    setFiling({
      file,
      typeKey: preset.typeKey,
      requestId: preset.requestId,
      subjectPersonId:
        preset.typeKey === null ? null : load.status === 'ready' ? load.data.viewer.personId : null,
    });
  };
  return (
    <Page large="Documents" trailing={plus}>
      <Input
        value={q}
        onChange={setQ}
        placeholder={tr('documents.documents-tab.search_your_documents', 'Search your documents')}
        startAdornment={<Icon icon={Search} />}
        accessibilityLabel={tr('documents.documents-tab.search_documents', 'Search documents')}
      />
      {isQuestion && across?.q !== q.trim() ? (
        <Button startIcon={<Icon icon={Sparkles} />} onPress={askAcross}>
          {tr('documents.documents-tab.ask_kithena', 'Ask Kithena')}
        </Button>
      ) : null}
      {across === null ? null : across.a === null ? (
        across.error === undefined ? (
          <Loading
            label={tr(
              'documents.documents-tab.kithena_is_reading_your_documents',
              'Kithena is reading your documents',
            )}
          />
        ) : (
          <Alert tone="danger">{across.error}</Alert>
        )
      ) : (
        <AcrossAnswer
          question={across.q}
          answer={across.a}
          onOpen={(id, title) => {
            navigation.navigate('DocumentDetail', { id, title });
          }}
        />
      )}
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading
          label={tr('documents.documents-tab.loading_your_documents', 'Loading your documents')}
        />
      ) : (
        <Body
          data={load.data}
          queue={queue}
          onQueue={setQueue}
          show={show}
          onShow={(next) => {
            if (next === '__new') setNewSection(true);
            else setShow(next);
          }}
          onOpen={(id, title) => {
            navigation.navigate('DocumentDetail', { id, title });
          }}
          onPerson={(personId, name) => {
            navigation.navigate('DocumentsPersonFile', { personId, name });
          }}
          onAnswer={(typeKey, requestId) => {
            setAdding({ typeKey, requestId });
          }}
          onDecided={reload}
          onSign={(envelopeId) => {
            navigation.navigate('DocumentEnvelope', { id: envelopeId });
          }}
        />
      )}
      <ActionSheet
        open={adding !== null}
        onOpenChange={(o) => {
          if (!o) setAdding(null);
        }}
      >
        <ActionSheetContent title={tr('documents.documents-tab.add_a_document', 'Add a document')}>
          <ActionSheetItem icon={ScanLine} onSelect={() => void pick('scan')}>
            {tr('documents.documents-tab.scan_a_paper_document', 'Scan a paper document')}
          </ActionSheetItem>
          <ActionSheetItem icon={FileUp} onSelect={() => void pick('file')}>
            {tr('documents.documents-tab.choose_a_file', 'Choose a file')}
          </ActionSheetItem>
          {load.status === 'ready' && load.data.viewer.hr ? (
            <ActionSheetItem
              icon={Sparkles}
              onSelect={() => {
                setAdding(null);
                navigation.navigate('DocumentDraft');
              }}
            >
              {tr('documents.documents-tab.draft_with_kithena', 'Draft with Kithena')}
            </ActionSheetItem>
          ) : null}
          <ActionSheetItem
            icon={FolderPlus}
            onSelect={() => {
              setAdding(null);
              setTimeout(() => {
                setNewSection(true);
              }, 300);
            }}
          >
            {tr('documents.documents-tab.new_section', 'New section')}
          </ActionSheetItem>
        </ActionSheetContent>
      </ActionSheet>
      {filing === null || load.status !== 'ready' ? null : (
        <FileDialog
          filing={filing}
          hr={load.data.viewer.hr}
          types={load.data.types}
          people={load.data.people}
          onClose={() => {
            setFiling(null);
          }}
          onFiled={(id, title, typed) => {
            setFiling(null);
            reload();
            if (!typed && load.data.viewer.askAfterUpload) setAsking({ id, title });
          }}
        />
      )}
      {asking === null ? null : (
        <ShareQuestion
          title={asking.title}
          onClose={() => {
            setAsking(null);
          }}
          onShare={() => {
            const open = asking;
            setAsking(null);
            navigation.navigate('DocumentDetail', { id: open.id, title: open.title });
          }}
          onStop={() => void askDocuments(signed, 'SetAskAfterUpload', { input: { ask: false } })}
        />
      )}
      {newSection ? (
        <NewSection
          onClose={() => {
            setNewSection(false);
          }}
          onCreated={(id) => {
            setNewSection(false);
            setShow(`section:${id}`);
          }}
        />
      ) : null}
    </Page>
  );
}

function Body({
  data,
  queue,
  onQueue,
  show,
  onShow,
  onOpen,
  onPerson,
  onAnswer,
  onDecided,
  onSign,
}: {
  readonly data: Library;
  readonly queue: string | null;
  readonly onQueue: (queue: string | null) => void;
  readonly show: string;
  readonly onShow: (show: string) => void;
  readonly onOpen: (id: string, title: string) => void;
  readonly onPerson: (personId: string, name: string) => void;
  readonly onAnswer: (typeKey: string | null, requestId: string) => void;
  readonly onDecided: () => void;
  readonly onSign: (envelopeId: string) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const decide = (id: string, grant: boolean): void => {
    void askDocuments(signed, 'DecideDocumentAccess', { requestId: id, input: { grant } }).then(
      onDecided,
    );
  };
  const shownQueue = data.tiles.find((t) => t.key === queue);
  return (
    <>
      {queue !== null ? null : (
        <Answers
          documentIds={data.rows
            .filter((r) => (r.mine || r.aboutMe) && r.kind !== 'Medical')
            .slice(0, 5)
            .map((r) => r.id)}
          titles={Object.fromEntries(data.rows.map((r) => [r.id, r.title]))}
        />
      )}
      {data.needsYou.length === 0 ? null : (
        <>
          <Heading title={tr('documents.documents-tab.needs_you', 'Needs you')} />
          <List>
            {data.needsYou.map((n) => (
              <ListItem
                key={n.id}
                icon={n.kind === 'request' ? Upload : n.kind === 'sign' ? PenLine : FolderOpen}
                description={n.detail}
                trailing={
                  n.kind === 'request' ? (
                    <Button
                      size="xs"
                      variant="primary"
                      onPress={() => {
                        onAnswer(n.typeKey, n.id);
                      }}
                    >
                      {tr('documents.documents-tab.add', 'Add')}
                    </Button>
                  ) : n.kind === 'sign' ? (
                    <Button
                      size="xs"
                      variant="primary"
                      onPress={() => {
                        onSign(n.id);
                      }}
                    >
                      {tr('documents.documents-tab.sign', 'Sign')}
                    </Button>
                  ) : n.kind === 'acknowledge' ? (
                    <Button
                      size="xs"
                      variant="primary"
                      onPress={() => {
                        if (n.documentId !== null) onOpen(n.documentId, n.title);
                      }}
                    >
                      {tr('documents.documents-tab.read', 'Read')}
                    </Button>
                  ) : (
                    <View className="flex-row gap-1.5">
                      <Button
                        size="xs"
                        onPress={() => {
                          decide(n.id, false);
                        }}
                      >
                        {tr('documents.documents-tab.refuse', 'Refuse')}
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        onPress={() => {
                          decide(n.id, true);
                        }}
                      >
                        {tr('documents.documents-tab.grant', 'Grant')}
                      </Button>
                    </View>
                  )
                }
              >
                {n.title}
              </ListItem>
            ))}
          </List>
        </>
      )}
      {data.viewer.hr ? (
        <View className="flex-row flex-wrap gap-2.5">
          {data.tiles.map((t) => (
            <Pressable
              key={t.key}
              className="w-[48%]"
              accessibilityRole="button"
              accessibilityState={{ selected: queue === t.key }}
              onPress={() => {
                onQueue(queue === t.key ? null : t.key);
              }}
            >
              <Stat label={t.label} value={String(t.count)} size={26} description={t.detail} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {shownQueue !== undefined ? (
        <>
          <View className="flex-row">
            <Chip
              selected
              onRemove={() => {
                onQueue(null);
              }}
              removeLabel={tr('documents.documents-tab.show_every_document', 'Show every document')}
            >
              {shownQueue.label}
            </Chip>
          </View>
          {data.queueRows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={tr('documents.documents-tab.nothing_in_this_queue', 'Nothing in this queue')}
            />
          ) : (
            <List>
              {data.queueRows.map((r) => (
                <ListItem
                  key={r.id}
                  description={r.detail}
                  chevron
                  onPress={() => {
                    if (r.person !== null) onPerson(r.person.personId, r.person.name);
                    else if (r.documentId !== null) onOpen(r.documentId, r.title);
                  }}
                >
                  {r.title}
                </ListItem>
              ))}
            </List>
          )}
        </>
      ) : (
        <>
          <Heading title={tr('documents.documents-tab.everything', 'Everything')} />
          <Field>
            <Select value={show} onValueChange={onShow}>
              <FieldControl>
                <SelectTrigger accessibilityLabel={tr('documents.documents-tab.show', 'Show')}>
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent title={tr('documents.documents-tab.show', 'Show')}>
                <SelectItem value="all">
                  {tr('documents.documents-tab.all_documents', 'All documents')}
                </SelectItem>
                <SelectItem value="about-me">
                  {tr('documents.documents-tab.about_me', 'About me')}
                </SelectItem>
                <SelectItem value="shared">
                  {tr('documents.documents-tab.shared_with_me', 'Shared with me')}
                </SelectItem>
                <SelectItem value="mine">
                  {tr('documents.documents-tab.my_own', 'My own')}
                </SelectItem>
                <SelectItem value="company">
                  {tr('documents.documents-tab.company', 'Company')}
                </SelectItem>
                {data.sections.map((s) => (
                  <SelectItem key={s.id} value={`section:${s.id}`}>
                    {`${s.name} (${String(s.count)})`}
                  </SelectItem>
                ))}
                <SelectItem value="__new">
                  {tr('documents.documents-tab.new_section_2', 'New section…')}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {data.rows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={tr('documents.documents-tab.nothing_here_yet', 'Nothing here yet')}
              description={tr(
                'documents.documents-tab.add_a_document_with',
                'Add a document with +.',
              )}
            />
          ) : (
            <List>
              {data.rows.map((row) => (
                <ListItem
                  key={row.id}
                  description={meta(row)}
                  supporting={
                    <View className="mt-1 flex-row flex-wrap gap-1.5">
                      <Badge tone={access(row).tone} size="sm">
                        {access(row).label}
                      </Badge>
                      {row.status === null ? null : (
                        <Badge tone={row.status.tone} size="sm">
                          {row.status.label}
                        </Badge>
                      )}
                    </View>
                  }
                  chevron
                  onPress={() => {
                    onOpen(row.id, row.title);
                  }}
                >
                  {row.title}
                </ListItem>
              ))}
            </List>
          )}
        </>
      )}
    </>
  );
}

const PERSONAL = '__personal';

/** Name it, and for HR its type and person; it starts Private (MD3, MD4). */
function FileDialog({
  filing,
  hr,
  types,
  people,
  onClose,
  onFiled,
}: {
  readonly filing: Filing;
  readonly hr: boolean;
  readonly types: readonly TypeOption[];
  readonly people: readonly PersonRef[];
  readonly onClose: () => void;
  readonly onFiled: (id: string, title: string, typed: boolean) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [title, setTitle] = useState(filing.file.name.replace(/\.[^.]+$/u, ''));
  const [typeKey, setTypeKey] = useState(filing.typeKey ?? PERSONAL);
  const [subject, setSubject] = useState<string | null>(filing.subjectPersonId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [expiresOn, setExpiresOn] = useState<string | null>(null);
  // HR's scan goes up as the dialog opens, so Kithena can read it while HR checks (MD3).
  const [sent, setSent] = useState<FileRef | null>(null);
  const [reading, setReading] = useState<'reading' | 'read' | null>(null);
  const type = types.find((t) => t.key === typeKey);
  const fixed = filing.requestId !== null;
  useEffect(() => {
    if (!hr || filing.requestId !== null || filing.typeKey !== null) return;
    let live = true;
    setReading('reading');
    void putFile(signed, filing.file).then(async (put) => {
      if (!put.ok) {
        if (live) setReading(null);
        return;
      }
      if (live) setSent(put.data);
      const s = await askDocuments<{
        available: boolean;
        title: string | null;
        typeKey: string | null;
        subjectPersonId: string | null;
        expiresOn: string | null;
      }>(signed, 'SuggestDocumentFiling', {
        uploadId: put.data.uploadId,
        input: { name: filing.file.name },
      });
      if (!live) return;
      if (!s.ok || !s.data.available) {
        setReading(null);
        return;
      }
      if (s.data.title !== null) setTitle(s.data.title);
      if (s.data.typeKey !== null) setTypeKey(s.data.typeKey);
      if (s.data.subjectPersonId !== null) setSubject(s.data.subjectPersonId);
      setExpiresOn(s.data.expiresOn);
      setReading('read');
    });
    return () => {
      live = false;
    };
  }, [hr, filing, signed]);
  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const put =
      sent === null ? await putFile(signed, filing.file) : { ok: true as const, data: sent };
    if (!put.ok) {
      setBusy(false);
      setProblem(put.message);
      return;
    }
    const filed = await askDocuments<{ id: string }>(signed, 'UploadDocument', {
      input: {
        title: title.trim() || filing.file.name,
        typeKey: typeKey === PERSONAL ? null : typeKey,
        subjectPersonId: typeKey === PERSONAL ? null : subject,
        sectionId: null,
        expiresOn,
        requestId: filing.requestId,
        upload: put.data,
      },
    });
    setBusy(false);
    if (!filed.ok) {
      setProblem(filed.message);
      return;
    }
    onFiled(filed.data.id, title, typeKey !== PERSONAL);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tr('documents.documents-tab.add_a_document', 'Add a document')}
          </DialogTitle>
          <DialogDescription>
            {tr('documents.documents-tab.it_starts_private', 'It starts Private.')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {reading === 'reading' ? (
            <Spinner
              label={tr(
                'documents.documents-tab.kithena_is_reading_the_scan',
                'Kithena is reading the scan',
              )}
            />
          ) : reading === 'read' ? (
            <Text variant="footnote" tone="muted">
              {tr(
                'documents.documents-tab.kithena_filled_in_what_it_read',
                'Kithena filled in what it read{{value}}. Check each before adding.',
                { value: expiresOn === null ? '' : `, expiring ${expiresOn}` },
              )}
            </Text>
          ) : null}
          <Field>
            <FieldLabel>{tr('documents.documents-tab.name', 'Name')}</FieldLabel>
            <Input value={title} onChange={setTitle} />
          </Field>
          {hr && !fixed ? (
            <Field>
              <FieldLabel>{tr('documents.documents-tab.type', 'Type')}</FieldLabel>
              <Select value={typeKey} onValueChange={setTypeKey}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent title={tr('documents.documents-tab.type', 'Type')}>
                  <SelectItem value={PERSONAL}>
                    {tr('documents.documents-tab.my_own_document', 'My own document')}
                  </SelectItem>
                  {types.map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {hr && !fixed && type?.filedTo === 'person' ? (
            <Field>
              <FieldLabel>{tr('documents.documents-tab.about', 'About')}</FieldLabel>
              <Select value={subject ?? ''} onValueChange={setSubject}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={tr('documents.documents-tab.who_it_is_about', 'Who it is about')}
                    />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent title={tr('documents.documents-tab.about', 'About')}>
                  {people.map((p) => (
                    <SelectItem key={p.personId} value={p.personId}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('documents.documents-tab.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy}
            disabled={type?.filedTo === 'person' && subject === null}
            onPress={() => void save()}
          >
            {tr('documents.documents-tab.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareQuestion({
  title,
  onClose,
  onShare,
  onStop,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly onShare: () => void;
  readonly onStop: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('documents.documents-tab.its_private', 'It’s private')}</DialogTitle>
          <DialogDescription>
            {tr(
              'documents.documents-tab.only_you_can_see_do_you',
              'Only you can see {{title}}. Do you want to share it?',
              { title },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Button
            variant="ghost"
            onPress={() => {
              onStop();
              onClose();
            }}
          >
            {tr('documents.documents-tab.dont_ask_me_after_uploads', 'Don’t ask me after uploads')}
          </Button>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('documents.documents-tab.keep_it_private', 'Keep it private')}
          </Button>
          <Button className="flex-1" variant="primary" onPress={onShare}>
            {tr('documents.documents-tab.share', 'Share')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A personal section (MD5): only you see it; documents keep their own access. */
function NewSection({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (id: string) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr('documents.documents-tab.new_section', 'New section')}</DialogTitle>
          <DialogDescription>
            {tr(
              'documents.documents-tab.only_you_see_it_documents_keep',
              'Only you see it. Documents keep their own access.',
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>{tr('documents.documents-tab.name', 'Name')}</FieldLabel>
            <Input value={name} onChange={setName} />
          </Field>
          {problem === null ? null : <Text tone="danger">{problem}</Text>}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('documents.documents-tab.cancel', 'Cancel')}
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy}
            disabled={name.trim() === ''}
            onPress={() => {
              setBusy(true);
              void askDocuments<{ id: string }>(signed, 'CreateDocumentSection', {
                input: { name, kind: 'personal', documentIds: [] },
              }).then((made) => {
                setBusy(false);
                if (made.ok) onCreated(made.data.id);
                else setProblem(made.message);
              });
            }}
          >
            {tr('documents.documents-tab.create', 'Create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
