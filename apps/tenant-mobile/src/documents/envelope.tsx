import {
  Alert,
  Avatar,
  Badge,
  Button,
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
  List,
  ListItem,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  Textarea,
} from '@reach/ui-native';
import { Eye } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { Failed, Heading, Loading, Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askDocuments, useDocuments } from './api';
import { SignDocument } from './signing';

/**
 * Signing on the phone (MX1–MX4, MX6): the document itself, full screen, with
 * the signer's own boxes on it (`signing.tsx`) — and, for whoever sent it,
 * each signer's trail with Remind and Cancel.
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
    kind: 'signature' | 'initials' | 'date' | 'name' | 'title' | 'checkbox' | 'text';
    page: number;
    x: number;
    y: number;
    w: number;
    h: number;
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
  const total = env.signers.length;
  const signedCount = env.signers.filter((s) => s.status === 'signed').length;
  const otherDialog = (
    <OtherDialog
      other={other}
      sender={env.sender}
      text={text}
      busy={busy !== null}
      onText={setText}
      onClose={() => {
        setOther(null);
      }}
      onSend={() => {
        if (other === 'ask')
          void act('AskEnvelopeSender', { input: { question: text } }, 'Your question was sent.');
        else if (other === 'decline')
          void act('DeclineEnvelope', { input: { reason: text } }, 'Declined. The sender is told.');
        else void act('VoidEnvelope', { input: { reason: text } }, 'Cancelled.');
      }}
    />
  );
  if (env.me?.turn === true && done === null) {
    return (
      <>
        <SignDocument
          env={env}
          back={back}
          onAsk={() => {
            setOther('ask');
          }}
          onDecline={() => {
            setOther('decline');
          }}
          onSigned={(completed) => {
            setDone(
              completed
                ? 'Everybody has signed: the document is sealed and filed.'
                : `${env.sender} and anyone after you sign next. The signed copy lands in your documents.`,
            );
            reload();
          }}
        />
        {otherDialog}
      </>
    );
  }
  return (
    <Page title="Signature status" back={back}>
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
      {otherDialog}
    </Page>
  );
}

/** Asking the sender, declining, or cancelling the request: each says why. */
function OtherDialog({
  other,
  sender,
  text,
  busy,
  onText,
  onClose,
  onSend,
}: {
  readonly other: 'ask' | 'decline' | 'void' | null;
  readonly sender: string;
  readonly text: string;
  readonly busy: boolean;
  readonly onText: (text: string) => void;
  readonly onClose: () => void;
  readonly onSend: () => void;
}): React.JSX.Element {
  return (
    <Dialog
      open={other !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {other === 'ask'
              ? `Ask ${sender}`
              : other === 'decline'
                ? 'Decline to sign'
                : 'Cancel this request'}
          </DialogTitle>
          <DialogDescription>
            {other === 'ask'
              ? 'The request waits for you.'
              : other === 'decline'
                ? `${sender} is told; say why.`
                : 'Nobody can sign it afterwards. Say why.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>{other === 'ask' ? 'Your question' : 'Why'}</FieldLabel>
            <Textarea value={text} onChange={onText} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            Back
          </Button>
          <Button
            className="flex-1"
            variant={other === 'ask' ? 'primary' : 'danger'}
            disabled={text.trim() === ''}
            loading={busy}
            onPress={onSend}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
