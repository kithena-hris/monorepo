import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldLabel,
  Icon,
  List,
  ListItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Text,
  Textarea,
} from '@reach/ui-native';
import {
  Download,
  Eye,
  Lock,
  PenLine,
  Send,
  Share2,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import {
  access,
  askDocuments,
  chooseFile,
  meta,
  openFile,
  putFile,
  scan,
  useDocuments,
  type PersonRef,
  type Row,
} from './api';
import { Answers, Certificate } from './answers';
import { Reading } from './reading';
import { ActOnLetter, FillRecord } from './record';

/**
 * A document on the phone (MR1, MR4, MA1, MA2): who can see it, open it in
 * the phone's own viewer (watermarked when Confidential), download it when it
 * is yours to, share it, add a version. One you cannot open says who owns it
 * and offers one button.
 */

interface DocumentData {
  readonly document: {
    readonly row: Row;
    readonly owner: string;
    readonly versions: readonly {
      n: number;
      uploadedAt: string;
      uploadedBy: string | null;
      note: string | null;
    }[];
    readonly grants: readonly {
      kind: 'member' | 'team' | 'everyone';
      id: string;
      label: string;
      permission: 'view' | 'edit';
      endsOn: string | null;
    }[];
    readonly may: {
      edit: boolean;
      share: boolean;
      download: boolean;
      delete: boolean;
      protect: boolean;
      unprotect: boolean;
    };
    readonly confidentialBy: 'owner' | 'hr' | 'type' | null;
    readonly accessRequests: readonly { id: string; who: string; reason: string }[];
    readonly held: boolean;
    readonly people: readonly PersonRef[];
    readonly signing: {
      id: string;
      status: string;
      signed: number;
      of: number;
      mine: boolean;
    } | null;
    readonly campaigns: readonly {
      id: string;
      done: number;
      of: number;
      asked: boolean;
      acknowledged: boolean;
    }[];
    readonly pdf: boolean;
  } | null;
  readonly closed: { readonly owner: string; readonly requested: boolean } | null;
}

export function DocumentDetail({
  navigation,
  route,
}: PeopleScreen<'DocumentDetail'>): React.JSX.Element {
  const signed = useSigned();
  const { id, title } = route.params;
  const { load, reload } = useDocuments<DocumentData>('DocumentsDocument', { documentId: id });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [sending, setSending] = useState(false);
  const [filling, setFilling] = useState(false);
  const [acting, setActing] = useState(false);
  const back = { label: 'Documents', onPress: navigation.goBack };
  const act = async (name: string, variables: Record<string, unknown>): Promise<boolean> => {
    setBusy(name);
    setProblem(null);
    const done = await askDocuments(
      signed,
      name,
      name === 'AcknowledgeDocument' ? variables : { documentId: id, ...variables },
    );
    setBusy(null);
    if (!done.ok) setProblem(done.message);
    else reload();
    return done.ok;
  };
  if (load.status === 'error') {
    return (
      <Page title={title} back={back}>
        <Failed message={load.message} onRetry={reload} />
      </Page>
    );
  }
  if (load.status === 'loading') {
    return (
      <Page title={title} back={back}>
        <Loading label="Opening the document" />
      </Page>
    );
  }
  const doc = load.data.document;
  if (doc === null) {
    return (
      <Closed
        id={id}
        title={title}
        owner={load.data.closed?.owner ?? 'Its owner'}
        requested={load.data.closed?.requested === true}
        back={back}
      />
    );
  }
  const { row } = doc;
  const tag = access(row);
  return (
    <Page title={row.title} back={back}>
      <View className="flex-row flex-wrap gap-1.5">
        <Badge tone={tag.tone}>{tag.label}</Badge>
        {row.status === null ? null : <Badge tone={row.status.tone}>{row.status.label}</Badge>}
        {doc.held ? <Badge tone="danger">Legal hold</Badge> : null}
      </View>
      <Text tone="muted">{meta(row)}</Text>
      {row.confidential ? (
        <Alert tone="warning" title="Confidential">
          {doc.may.download
            ? 'Your name is on every page you view. You can download it because it’s yours.'
            : 'Your name is on every page. It cannot be downloaded, and every open is logged.'}
        </Alert>
      ) : null}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      <Button
        variant="primary"
        startIcon={<Icon icon={Eye} tone="on-accent" />}
        loading={busy === 'view'}
        onPress={() => {
          setBusy('view');
          void openFile(signed, id, 'view').then((message) => {
            setBusy(null);
            setProblem(message);
          });
        }}
      >
        Open
      </Button>
      <View className="flex-row gap-2.5">
        {doc.may.download ? (
          <Button
            className="flex-1"
            startIcon={<Icon icon={Download} />}
            onPress={() => void openFile(signed, id, 'download').then(setProblem)}
          >
            Download
          </Button>
        ) : null}
        {doc.may.share ? (
          <Button
            className="flex-1"
            startIcon={<Icon icon={Share2} />}
            onPress={() => {
              setSharing(true);
            }}
          >
            Share
          </Button>
        ) : null}
      </View>
      {doc.signing === null ? null : (
        <Button
          variant={doc.signing.mine && doc.signing.status === 'sent' ? 'primary' : 'secondary'}
          onPress={() => {
            if (doc.signing !== null)
              navigation.navigate('DocumentEnvelope', { id: doc.signing.id });
          }}
        >
          {doc.signing.mine && doc.signing.status === 'sent'
            ? 'Review and sign'
            : doc.signing.status === 'sent'
              ? `Signature status · ${String(doc.signing.signed)} of ${String(doc.signing.of)}`
              : 'Signature request'}
        </Button>
      )}
      {doc.campaigns.map((c) =>
        c.asked && !c.acknowledged ? (
          <Button
            key={c.id}
            variant="primary"
            loading={busy === c.id}
            onPress={() => void act('AcknowledgeDocument', { campaignId: c.id })}
          >
            I’ve read it
          </Button>
        ) : c.asked ? (
          <Badge key={c.id} tone="success">
            You acknowledged it
          </Badge>
        ) : (
          <Button
            key={c.id}
            onPress={() => {
              navigation.navigate('DocumentCampaign', { id: c.id });
            }}
          >
            {`Acknowledged by ${String(c.done)} of ${String(c.of)}`}
          </Button>
        ),
      )}
      {doc.may.share && doc.pdf && (doc.signing === null || doc.signing.status !== 'sent') ? (
        <Button
          startIcon={<Icon icon={PenLine} />}
          onPress={() => {
            setSending(true);
          }}
        >
          Send for signature
        </Button>
      ) : null}
      {doc.may.share && doc.pdf && row.deletedAt === null && row.subject !== null ? (
        <Button
          startIcon={<Icon icon={Sparkles} />}
          onPress={() => {
            setFilling(true);
          }}
        >
          Fill the record from it
        </Button>
      ) : null}
      {doc.may.share && row.kind === 'Letter' && row.deletedAt === null && row.subject !== null ? (
        <Button
          onPress={() => {
            setActing(true);
          }}
        >
          Act on this letter
        </Button>
      ) : null}
      {acting && row.subject !== null ? (
        <ActOnLetter
          documentId={id}
          personId={row.subject.personId}
          name={row.subject.name}
          onClose={() => {
            setActing(false);
            reload();
          }}
        />
      ) : null}
      {filling && row.subject !== null ? (
        <FillRecord
          documentId={id}
          personId={row.subject.personId}
          name={row.subject.name}
          onClose={() => {
            setFilling(false);
          }}
        />
      ) : null}
      {row.deletedAt === null && (row.mine || row.aboutMe) && row.typeKey === 'certificate' ? (
        <Certificate
          documentId={id}
          onRequest={(leaveTypeKey, from) => {
            navigation.navigate('TimeOffRequest', {
              leaveTypeKey,
              ...(from === undefined ? {} : { from }),
            });
          }}
        />
      ) : null}
      {row.deletedAt === null && (row.mine || row.aboutMe) ? <Answers documentIds={[id]} /> : null}
      {doc.pdf && row.deletedAt === null ? <Reading documentId={id} /> : null}
      <Heading title="Who can see it" />
      <List>
        <ListItem description={`Owner: ${doc.owner}`}>{row.who.label}</ListItem>
      </List>
      {doc.may.protect || doc.may.unprotect ? (
        <ListItem
          listitem={false}
          icon={Lock}
          description="A watermark, no download, every open logged."
          trailing={
            <Switch
              accessibilityLabel="Confidential"
              checked={row.confidential}
              disabled={busy !== null}
              onCheckedChange={(on) => void act('SetDocumentConfidential', { input: { on } })}
            />
          }
        >
          Confidential
        </ListItem>
      ) : null}
      {doc.accessRequests.length === 0 ? null : (
        <>
          <Heading title="Asked to open it" />
          <List>
            {doc.accessRequests.map((r) => (
              <ListItem
                key={r.id}
                description={r.reason}
                trailing={
                  <View className="flex-row gap-1.5">
                    <Button
                      size="xs"
                      onPress={() =>
                        void askDocuments(signed, 'DecideDocumentAccess', {
                          requestId: r.id,
                          input: { grant: false },
                        }).then(reload)
                      }
                    >
                      Refuse
                    </Button>
                    <Button
                      size="xs"
                      variant="primary"
                      onPress={() =>
                        void askDocuments(signed, 'DecideDocumentAccess', {
                          requestId: r.id,
                          input: { grant: true },
                        }).then(reload)
                      }
                    >
                      Grant
                    </Button>
                  </View>
                }
              >
                {r.who}
              </ListItem>
            ))}
          </List>
        </>
      )}
      <Heading title="Versions" />
      <List>
        {doc.versions.map((v) => (
          <ListItem
            key={v.n}
            description={[v.uploadedAt.slice(0, 10), v.uploadedBy, v.note]
              .filter(Boolean)
              .join(' · ')}
          >
            {`Version ${String(v.n)}`}
          </ListItem>
        ))}
      </List>
      {doc.may.edit ? (
        <Button
          startIcon={<Icon icon={Upload} />}
          loading={busy === 'version'}
          onPress={() => {
            void (async () => {
              const file = (await chooseFile()) ?? null;
              if (file === null) return;
              setBusy('version');
              const put = await putFile(signed, file);
              if (!put.ok) {
                setBusy(null);
                setProblem(put.message);
                return;
              }
              await act('AddDocumentVersion', { input: { upload: put.data, note: null } });
            })();
          }}
        >
          New version
        </Button>
      ) : null}
      {doc.may.edit ? (
        <Button
          variant="ghost"
          onPress={() => {
            void (async () => {
              const file = await scan();
              if (file === null) return;
              setBusy('version');
              const put = await putFile(signed, file);
              if (!put.ok) {
                setBusy(null);
                setProblem(put.message);
                return;
              }
              await act('AddDocumentVersion', { input: { upload: put.data, note: 'Scanned' } });
            })();
          }}
        >
          Scan a new version
        </Button>
      ) : null}
      {doc.may.delete ? (
        <Button
          variant="ghost"
          startIcon={<Icon icon={Trash2} />}
          disabled={doc.held}
          onPress={() =>
            void act('DeleteDocument', {}).then((ok) => {
              if (ok) navigation.goBack();
            })
          }
        >
          Delete
        </Button>
      ) : null}
      {sending ? (
        <SendDialog
          documentId={id}
          people={doc.people}
          subject={row.subject}
          onClose={(envelopeId) => {
            setSending(false);
            reload();
            if (envelopeId !== null) navigation.navigate('DocumentEnvelope', { id: envelopeId });
          }}
        />
      ) : null}
      {sharing ? (
        <ShareDialog
          documentId={id}
          title={row.title}
          grants={doc.grants}
          people={doc.people}
          onClose={() => {
            setSharing(false);
            reload();
          }}
        />
      ) : null}
    </Page>
  );
}

function Closed({
  id,
  title,
  owner,
  requested,
  back,
}: {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
  readonly requested: boolean;
  readonly back: { label: string; onPress: () => void };
}): React.JSX.Element {
  const signed = useSigned();
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(requested);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Page title={title} back={back}>
      <EmptyState
        icon={Lock}
        title="You can’t open this yet"
        description={`${owner} owns it. They’ll get a task in their Inbox, and you’ll hear back as an update.`}
      />
      {sent ? (
        <Alert tone="success" title="Asked">{`${owner} will decide.`}</Alert>
      ) : (
        <>
          <Field>
            <FieldLabel>Why you need it</FieldLabel>
            <Textarea value={reason} onChange={setReason} />
          </Field>
          {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
          <Button
            variant="primary"
            startIcon={<Icon icon={Send} tone="on-accent" />}
            loading={busy}
            disabled={reason.trim() === ''}
            onPress={() => {
              setBusy(true);
              void askDocuments(signed, 'RequestDocumentAccess', {
                documentId: id,
                input: { reason },
              }).then((done) => {
                setBusy(false);
                if (done.ok) setSent(true);
                else setProblem(done.message);
              });
            }}
          >
            Ask for access
          </Button>
        </>
      )}
    </Page>
  );
}

/** Sharing (MA1): people and their permission; none left is Private. */
function ShareDialog({
  documentId,
  title,
  grants,
  people,
  onClose,
}: {
  readonly documentId: string;
  readonly title: string;
  readonly grants: DocumentData['document'] extends infer D
    ? D extends { grants: infer G }
      ? G
      : never
    : never;
  readonly people: readonly PersonRef[];
  readonly onClose: () => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [list, setList] = useState(grants.map((g) => ({ ...g })));
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const named = new Set(list.map((g) => g.id));
  const save = (): void => {
    setBusy(true);
    void askDocuments(signed, 'ShareDocument', {
      documentId,
      input: {
        grants: list.map((g) => ({
          grantee:
            g.kind === 'member'
              ? { kind: 'member', personId: g.id }
              : g.kind === 'team'
                ? { kind: 'team', teamKey: g.id }
                : { kind: 'everyone' },
          permission: g.permission,
          endsOn: g.endsOn,
        })),
      },
    }).then((done) => {
      setBusy(false);
      if (done.ok) onClose();
      else setProblem(done.message);
    });
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
          <DialogTitle>{`Share ${title}`}</DialogTitle>
          <DialogDescription>Removing everyone makes it Private again.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Add someone</FieldLabel>
            <Select
              value={adding}
              onValueChange={(personId) => {
                const p = people.find((x) => x.personId === personId);
                if (p === undefined) return;
                setList([
                  ...list,
                  {
                    kind: 'member',
                    id: p.personId,
                    label: p.name,
                    permission: 'view',
                    endsOn: null,
                  },
                ]);
                setAdding('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose someone" />
              </SelectTrigger>
              <SelectContent title="Share with">
                {people
                  .filter((p) => !named.has(p.personId))
                  .map((p) => (
                    <SelectItem key={p.personId} value={p.personId}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <List>
            {list.map((g) => (
              <ListItem
                key={`${g.kind}:${g.id}`}
                description={g.permission === 'edit' ? 'Can edit' : 'Can view'}
                trailing={
                  <Button
                    size="xs"
                    variant="ghost"
                    onPress={() => {
                      setList(list.filter((x) => x !== g));
                    }}
                  >
                    Remove
                  </Button>
                }
              >
                {g.label}
              </ListItem>
            ))}
          </List>
          {list.length === 0 ? (
            <Text tone="muted">Private: only its owner and HR can open it.</Text>
          ) : null}
          {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" variant="primary" loading={busy} onPress={save}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sending from the phone (MX5): signers in order; Kithena places the fields. */
function SendDialog({
  documentId,
  people,
  subject,
  onClose,
}: {
  readonly documentId: string;
  readonly people: readonly PersonRef[];
  readonly subject: PersonRef | null;
  readonly onClose: (envelopeId: string | null) => void;
}): React.JSX.Element {
  const signed = useSigned();
  const [chosen, setChosen] = useState<readonly PersonRef[]>(subject === null ? [] : [subject]);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send for signature</DialogTitle>
          <DialogDescription>
            They sign in this order. Kithena places a signature and the date for each on the last
            page; moving fields is the web’s.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <List>
            {chosen.map((p, i) => (
              <ListItem
                key={p.personId}
                description={`Signs ${String(i + 1)}`}
                trailing={
                  <Button
                    size="xs"
                    variant="ghost"
                    onPress={() => {
                      setChosen(chosen.filter((x) => x !== p));
                    }}
                  >
                    Remove
                  </Button>
                }
              >
                {p.name}
              </ListItem>
            ))}
          </List>
          <Field>
            <FieldLabel>Add a signer</FieldLabel>
            <Select
              value={adding}
              onValueChange={(personId) => {
                const p = people.find((x) => x.personId === personId);
                if (p !== undefined) setChosen([...chosen, p]);
                setAdding('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose someone" />
              </SelectTrigger>
              <SelectContent title="Signer">
                {people
                  .filter((p) => !chosen.some((c) => c.personId === p.personId))
                  .map((p) => (
                    <SelectItem key={p.personId} value={p.personId}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
        </DialogBody>
        <DialogFooter>
          <Button
            className="flex-1"
            onPress={() => {
              onClose(null);
            }}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            loading={busy}
            disabled={chosen.length === 0}
            onPress={() => {
              setBusy(true);
              void askDocuments<{ id: string }>(signed, 'SendForSignature', {
                documentId,
                input: {
                  signers: chosen.map((p, i) => ({ personId: p.personId, order: i + 1 })),
                  fields: [],
                  message: '',
                  dueOn: null,
                  origin: signed.company.origin,
                  companyName: signed.company.displayName ?? signed.company.slug,
                },
              }).then((r) => {
                setBusy(false);
                if (r.ok) onClose(r.data.id);
                else setProblem(r.message);
              });
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
