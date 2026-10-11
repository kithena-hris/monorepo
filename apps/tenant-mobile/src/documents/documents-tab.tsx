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
  Stat,
  Text,
} from '@reach/ui-native';
import {
  FileUp,
  FolderOpen,
  FolderPlus,
  Plus,
  ScanLine,
  Search,
  Upload,
} from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import {
  access,
  askDocuments,
  chooseFile,
  meta,
  putFile,
  scan,
  useDocuments,
  type Picked,
  type PersonRef,
  type Row,
  type TypeOption,
} from './api';

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
    kind: 'request' | 'access_request';
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
  const plus = (
    <Button
      size="sm"
      variant="primary"
      accessibilityLabel="Add a document"
      startIcon={<Icon icon={Plus} tone="on-accent" />}
      onPress={() => {
        setAdding({ typeKey: null, requestId: null });
      }}
    >
      Add
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
        placeholder="Search your documents"
        startAdornment={<Icon icon={Search} />}
        accessibilityLabel="Search documents"
      />
      {load.status === 'error' ? (
        <Failed message={load.message} onRetry={reload} />
      ) : load.status === 'loading' ? (
        <Loading label="Loading your documents" />
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
        />
      )}
      <ActionSheet
        open={adding !== null}
        onOpenChange={(o) => {
          if (!o) setAdding(null);
        }}
      >
        <ActionSheetContent title="Add a document">
          <ActionSheetItem icon={ScanLine} onSelect={() => void pick('scan')}>
            Scan a paper document
          </ActionSheetItem>
          <ActionSheetItem icon={FileUp} onSelect={() => void pick('file')}>
            Choose a file
          </ActionSheetItem>
          <ActionSheetItem
            icon={FolderPlus}
            onSelect={() => {
              setAdding(null);
              setTimeout(() => {
                setNewSection(true);
              }, 300);
            }}
          >
            New section
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
      {data.needsYou.length === 0 ? null : (
        <>
          <Heading title="Needs you" />
          <List>
            {data.needsYou.map((n) => (
              <ListItem
                key={n.id}
                icon={n.kind === 'request' ? Upload : FolderOpen}
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
                      Add
                    </Button>
                  ) : (
                    <View className="flex-row gap-1.5">
                      <Button
                        size="xs"
                        onPress={() => {
                          decide(n.id, false);
                        }}
                      >
                        Refuse
                      </Button>
                      <Button
                        size="xs"
                        variant="primary"
                        onPress={() => {
                          decide(n.id, true);
                        }}
                      >
                        Grant
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
              removeLabel="Show every document"
            >
              {shownQueue.label}
            </Chip>
          </View>
          {data.queueRows.length === 0 ? (
            <EmptyState icon={FolderOpen} title="Nothing in this queue" />
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
          <Heading title="Everything" />
          <Field>
            <Select value={show} onValueChange={onShow}>
              <FieldControl>
                <SelectTrigger accessibilityLabel="Show">
                  <SelectValue />
                </SelectTrigger>
              </FieldControl>
              <SelectContent title="Show">
                <SelectItem value="all">All documents</SelectItem>
                <SelectItem value="about-me">About me</SelectItem>
                <SelectItem value="shared">Shared with me</SelectItem>
                <SelectItem value="mine">My own</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                {data.sections.map((s) => (
                  <SelectItem key={s.id} value={`section:${s.id}`}>
                    {`${s.name} (${String(s.count)})`}
                  </SelectItem>
                ))}
                <SelectItem value="__new">New section…</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {data.rows.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Nothing here yet"
              description="Add a document with +."
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
  const type = types.find((t) => t.key === typeKey);
  const fixed = filing.requestId !== null;
  const save = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    const put = await putFile(signed, filing.file);
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
        expiresOn: null,
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
          <DialogTitle>Add a document</DialogTitle>
          <DialogDescription>It starts Private.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input value={title} onChange={setTitle} />
          </Field>
          {hr && !fixed ? (
            <Field>
              <FieldLabel>Type</FieldLabel>
              <Select value={typeKey} onValueChange={setTypeKey}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent title="Type">
                  <SelectItem value={PERSONAL}>My own document</SelectItem>
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
              <FieldLabel>About</FieldLabel>
              <Select value={subject ?? ''} onValueChange={setSubject}>
                <FieldControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Who it is about" />
                  </SelectTrigger>
                </FieldControl>
                <SelectContent title="About">
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
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy}
            disabled={type?.filedTo === 'person' && subject === null}
            onPress={() => void save()}
          >
            Save
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
          <DialogTitle>It’s private</DialogTitle>
          <DialogDescription>{`Only you can see ${title}. Do you want to share it?`}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Button
            variant="ghost"
            onPress={() => {
              onStop();
              onClose();
            }}
          >
            Don’t ask me after uploads
          </Button>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Keep it private
          </Button>
          <Button className="flex-1" variant="primary" onPress={onShare}>
            Share
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
          <DialogTitle>New section</DialogTitle>
          <DialogDescription>Only you see it. Documents keep their own access.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input value={name} onChange={setName} />
          </Field>
          {problem === null ? null : <Text tone="danger">{problem}</Text>}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
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
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
