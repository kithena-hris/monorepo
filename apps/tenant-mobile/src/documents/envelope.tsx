import {
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Icon,
  Input,
  List,
  ListItem,
  Progress,
  SegmentedControl,
  SegmentedControlItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SignaturePad,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Eye, PenLine } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askDocuments, useDocuments } from './api';

/**
 * Signing on the phone (MX1–MX4, MX6): full screen, field by field — the
 * document opens in the phone's viewer, what is yours is listed, the first
 * signature is drawn or typed once — and, for whoever sent it, each signer's
 * trail with Remind and Cancel.
 */

interface EnvelopeData {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly status: 'sent' | 'completed' | 'declined' | 'voided';
  readonly message: string;
  readonly dueOn: string | null;
  readonly sender: string;
  readonly follows: boolean;
  readonly signedVersion: number | null;
  readonly signers: readonly {
    id: string;
    name: string;
    status: string;
    check: string;
    signedAt: string | null;
    allowDelegate: boolean;
  }[];
  readonly fields: readonly {
    id: string;
    signerId: string;
    kind: string;
    page: number;
    label: string | null;
    required: boolean;
  }[];
  readonly me: { signerId: string; status: string; turn: boolean } | null;
  readonly trail: readonly { who: string; action: string; at: string; note: string | null }[];
  readonly people: readonly { personId: string; name: string }[];
}

const STATUS: Record<string, readonly [string, 'neutral' | 'info' | 'success' | 'danger']> = {
  waiting: ['Waiting', 'neutral'],
  sent: ['Sent', 'info'],
  opened: ['Opened', 'info'],
  verified: ['Opened', 'info'],
  signed: ['Signed', 'success'],
  declined: ['Declined', 'danger'],
};

export function DocumentEnvelope({
  navigation,
  route,
}: PeopleScreen<'DocumentEnvelope'>): React.JSX.Element {
  const signed = useSigned();
  const { id } = route.params;
  const { load, reload } = useDocuments<EnvelopeData>('DocumentsEnvelope', { envelopeId: id });
  const [adopting, setAdopting] = useState(false);
  const [mark, setMark] = useState<
    { kind: 'typed'; text: string } | { kind: 'drawn'; path: string } | null
  >(null);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [other, setOther] = useState<'ask' | 'decline' | 'void' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const back = { label: 'Close', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Signature" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Opening the request" />
        )}
      </Page>
    );
  }
  const env = load.data;
  const mine = env.fields.filter((f) => f.signerId === env.me?.signerId);
  const act = async (
    name: string,
    variables: Record<string, unknown>,
    after: string,
  ): Promise<void> => {
    setBusy(name);
    setProblem(null);
    const r = await askDocuments(signed, name, { envelopeId: id, ...variables });
    setBusy(null);
    if (!r.ok) setProblem(r.message);
    else {
      setOther(null);
      setDone(after);
      reload();
    }
  };
  const open = async (): Promise<void> => {
    const link = await askDocuments<{ url: string | null }>(signed, 'DocumentsEnvelopeFile', {
      envelopeId: id,
    });
    if (link.ok && link.data.url !== null) await WebBrowser.openBrowserAsync(link.data.url);
    else setProblem(link.ok ? 'There is no file store here.' : link.message);
  };
  const ready =
    mark !== null &&
    mine.every((f) => !f.required || f.kind !== 'checkbox' || values[f.id] === 'true');
  const total = env.signers.length;
  const signedCount = env.signers.filter((s) => s.status === 'signed').length;
  const company = signed.company.displayName ?? signed.company.slug;
  return (
    <Page
      title={env.me?.turn === true ? 'Sign' : 'Signature status'}
      back={back}
      {...(env.me?.turn === true && done === null
        ? {
            foot: (
              <Button
                className="flex-1"
                variant="primary"
                startIcon={<Icon icon={PenLine} tone="on-accent" />}
                disabled={!ready}
                loading={busy === 'SignEnvelope'}
                onPress={() => {
                  if (mark === null) return;
                  void act(
                    'SignEnvelope',
                    {
                      input: {
                        signature: mark,
                        values,
                        origin: signed.company.origin,
                        companyName: company,
                      },
                    },
                    'Signed. The signed copy lands in your documents.',
                  );
                }}
              >
                Sign
              </Button>
            ),
          }
        : {})}
    >
      <Text variant="title2">{env.title}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        <Badge
          tone={
            env.status === 'completed' ? 'success' : env.status === 'sent' ? 'warning' : 'neutral'
          }
        >
          {env.status === 'sent'
            ? `${String(signedCount)} of ${String(total)} signed`
            : env.status === 'completed'
              ? 'Signed and sealed'
              : env.status}
        </Badge>
        {env.dueOn === null ? null : <Badge>{`Due ${env.dueOn}`}</Badge>}
      </View>
      {env.message === '' ? null : (
        <Alert tone="info" title={`${env.sender} says`}>
          {env.message}
        </Alert>
      )}
      {done === null ? null : <Alert tone="success">{done}</Alert>}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      <Button startIcon={<Icon icon={Eye} />} onPress={() => void open()}>
        Read the document
      </Button>
      {env.me?.turn === true && done === null ? (
        <>
          <Heading title="Your part" />
          <List>
            {mine.map((f) => (
              <ListItem
                key={f.id}
                description={`Page ${String(f.page)}`}
                trailing={
                  f.kind === 'checkbox' ? (
                    <Checkbox
                      accessibilityLabel={f.label ?? 'Tick'}
                      checked={values[f.id] === 'true'}
                      onCheckedChange={(v) => {
                        setValues({ ...values, [f.id]: v ? 'true' : 'false' });
                      }}
                    />
                  ) : f.kind === 'date' ? (
                    <Text variant="footnote" tone="muted">
                      When you sign
                    </Text>
                  ) : (
                    <Badge tone={mark === null ? 'accent' : 'success'}>
                      {mark === null ? 'Sign here' : 'Ready'}
                    </Badge>
                  )
                }
              >
                {f.label ??
                  (f.kind === 'signature'
                    ? 'Signature'
                    : f.kind === 'initials'
                      ? 'Initials'
                      : f.kind === 'date'
                        ? 'Date signed'
                        : 'Field')}
              </ListItem>
            ))}
          </List>
          <Button
            onPress={() => {
              setAdopting(true);
            }}
          >
            {mark === null ? 'Adopt your signature' : 'Change your signature'}
          </Button>
          <View className="flex-row gap-2.5">
            <Button
              className="flex-1"
              variant="ghost"
              onPress={() => {
                setOther('ask');
              }}
            >
              Ask a question
            </Button>
            <Button
              className="flex-1"
              variant="ghost"
              onPress={() => {
                setOther('decline');
              }}
            >
              Decline
            </Button>
          </View>
        </>
      ) : null}
      <Heading title="Signers" />
      <Progress
        value={total === 0 ? 0 : (signedCount / total) * 100}
        label={`${String(signedCount)} of ${String(total)} signed`}
      />
      <List>
        {env.signers.map((s) => (
          <ListItem
            key={s.id}
            leading={<Avatar name={s.name} size="md" />}
            description={s.check === 'login' ? 'Kithena login' : 'Code by email'}
            trailing={
              <Badge tone={STATUS[s.status]?.[1] ?? 'neutral'}>
                {STATUS[s.status]?.[0] ?? s.status}
              </Badge>
            }
            supporting={
              env.follows && env.status === 'sent' && s.allowDelegate && s.status !== 'signed' ? (
                <Select
                  value=""
                  onValueChange={(personId) =>
                    void act(
                      'ReassignEnvelopeSigner',
                      { input: { signerId: s.id, personId } },
                      'Passed on.',
                    )
                  }
                >
                  <SelectTrigger accessibilityLabel={`Pass ${s.name}’s turn to`}>
                    <SelectValue placeholder="Pass it to…" />
                  </SelectTrigger>
                  <SelectContent title="Pass to">
                    {env.people.map((p) => (
                      <SelectItem key={p.personId} value={p.personId}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : undefined
            }
          >
            {s.name}
          </ListItem>
        ))}
      </List>
      {env.follows && env.status === 'sent' ? (
        <View className="flex-row gap-2.5">
          <Button
            className="flex-1"
            loading={busy === 'RemindEnvelope'}
            onPress={() => void act('RemindEnvelope', {}, 'Reminded.')}
          >
            Remind
          </Button>
          <Button
            className="flex-1"
            variant="ghost"
            onPress={() => {
              setOther('void');
            }}
          >
            Cancel the request
          </Button>
        </View>
      ) : null}
      {env.follows && env.trail.length > 0 ? (
        <>
          <Heading title="What happened" />
          <List>
            {env.trail.map((t, i) => (
              <ListItem
                key={`${t.at}-${String(i)}`}
                description={[t.at.slice(0, 16).replace('T', ' '), t.note]
                  .filter(Boolean)
                  .join(' · ')}
              >
                {`${t.who} · ${t.action.replaceAll('_', ' ')}`}
              </ListItem>
            ))}
          </List>
        </>
      ) : null}
      <Dialog open={adopting} onOpenChange={setAdopting}>
        <AdoptContent
          onAdopt={(m) => {
            setMark(m);
            setAdopting(false);
          }}
          onCancel={() => {
            setAdopting(false);
          }}
        />
      </Dialog>
      <Dialog
        open={other !== null}
        onOpenChange={(o) => {
          if (!o) setOther(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {other === 'ask'
                ? `Ask ${env.sender}`
                : other === 'decline'
                  ? 'Decline to sign'
                  : 'Cancel this request'}
            </DialogTitle>
            <DialogDescription>
              {other === 'ask'
                ? 'The request waits for you.'
                : other === 'decline'
                  ? `${env.sender} is told; say why.`
                  : 'Nobody can sign it afterwards. Say why.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel>{other === 'ask' ? 'Your question' : 'Why'}</FieldLabel>
              <Textarea value={text} onChange={setText} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              className="flex-1"
              onPress={() => {
                setOther(null);
              }}
            >
              Back
            </Button>
            <Button
              className="flex-1"
              variant={other === 'ask' ? 'primary' : 'danger'}
              disabled={text.trim() === ''}
              loading={busy !== null}
              onPress={() => {
                if (other === 'ask')
                  void act(
                    'AskEnvelopeSender',
                    { input: { question: text } },
                    'Your question was sent.',
                  );
                else if (other === 'decline')
                  void act(
                    'DeclineEnvelope',
                    { input: { reason: text } },
                    'Declined. The sender is told.',
                  );
                else void act('VoidEnvelope', { input: { reason: text } }, 'Cancelled.');
              }}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

/** MX2: draw with a finger, or type; adopting it signs every field of yours. */
function AdoptContent({
  onAdopt,
  onCancel,
}: {
  readonly onAdopt: (
    mark: { kind: 'typed'; text: string } | { kind: 'drawn'; path: string },
  ) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [how, setHow] = useState<'draw' | 'type'>('draw');
  const [path, setPath] = useState('');
  const [typed, setTyped] = useState('');
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Your signature</DialogTitle>
        <DialogDescription>Draw it, or type it.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <SegmentedControl
          fullWidth
          value={how}
          accessibilityLabel="How you sign"
          onValueChange={(v) => {
            setHow(v === 'type' ? 'type' : 'draw');
          }}
        >
          <SegmentedControlItem value="draw">Draw</SegmentedControlItem>
          <SegmentedControlItem value="type">Type</SegmentedControlItem>
        </SegmentedControl>
        {how === 'draw' ? (
          <SignaturePad label="Draw your signature" value={path} onValueChange={setPath} />
        ) : (
          <Field>
            <FieldLabel>Your name</FieldLabel>
            <Input value={typed} onChange={setTyped} />
          </Field>
        )}
        <Text variant="footnote" tone="muted">
          By adopting it, you agree this electronic signature is the legal equivalent of your
          handwritten one.
        </Text>
      </DialogBody>
      <DialogFooter>
        <Button className="flex-1" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          variant="primary"
          disabled={how === 'draw' ? path.trim() === '' : typed.trim() === ''}
          onPress={() => {
            onAdopt(
              how === 'draw'
                ? { kind: 'drawn', path: path.trim() }
                : { kind: 'typed', text: typed.trim() },
            );
          }}
        >
          Adopt and sign
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** MH5: how many have acknowledged a policy, and who is left. */
export function DocumentCampaign({
  navigation,
  route,
}: PeopleScreen<'DocumentCampaign'>): React.JSX.Element {
  const { load, reload } = useDocuments<{
    title: string;
    done: number;
    of: number;
    dueOn: string | null;
    left: readonly { personId: string; name: string; teamName: string | null }[];
  }>('DocumentsCampaign', { campaignId: route.params.id });
  const back = { label: 'Documents', onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title="Acknowledgements" back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label="Loading the policy" />
        )}
      </Page>
    );
  }
  const c = load.data;
  return (
    <Page title={c.title} back={back}>
      <Text variant="title2">{`${String(c.done)} of ${String(c.of)} done`}</Text>
      <Progress
        value={c.of === 0 ? 0 : (c.done / c.of) * 100}
        label={`${String(c.done)} of ${String(c.of)} acknowledged`}
      />
      {c.dueOn === null ? null : <Text tone="muted">{`Due ${c.dueOn}`}</Text>}
      <Heading title="Still to go" />
      <List>
        {c.left.map((p) => (
          <ListItem
            key={p.personId}
            leading={<Avatar name={p.name} size="md" />}
            description={p.teamName ?? undefined}
          >
            {p.name}
          </ListItem>
        ))}
      </List>
    </Page>
  );
}
