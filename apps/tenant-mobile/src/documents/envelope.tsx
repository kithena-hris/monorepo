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
import { t as tr } from '../i18n';

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

const STATUS = (): Record<
  string,
  readonly [string, 'neutral' | 'info' | 'success' | 'danger']
> => ({
  waiting: [tr('documents.envelope.waiting', 'Waiting'), 'neutral'],
  sent: [tr('documents.envelope.sent', 'Sent'), 'info'],
  opened: [tr('documents.envelope.opened', 'Opened'), 'info'],
  verified: [tr('documents.envelope.opened', 'Opened'), 'info'],
  signed: [tr('documents.envelope.signed', 'Signed'), 'success'],
  declined: [tr('documents.envelope.declined', 'Declined'), 'danger'],
});

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
  const back = { label: tr('documents.envelope.close', 'Close'), onPress: navigation.goBack };
  if (load.status !== 'ready') {
    return (
      <Page title={tr('documents.envelope.signature', 'Signature')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('documents.envelope.opening_the_request', 'Opening the request')} />
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
    else
      setProblem(
        link.ok
          ? tr('documents.envelope.there_is_no_file_store_here', 'There is no file store here.')
          : link.message,
      );
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
          void act(
            'AskEnvelopeSender',
            { input: { question: text } },
            tr('documents.envelope.your_question_was_sent', 'Your question was sent.'),
          );
        else if (other === 'decline')
          void act(
            'DeclineEnvelope',
            { input: { reason: text } },
            tr('documents.envelope.declined_the_sender_is_told', 'Declined. The sender is told.'),
          );
        else
          void act(
            'VoidEnvelope',
            { input: { reason: text } },
            tr('documents.envelope.cancelled', 'Cancelled.'),
          );
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
          onSigned={(completed, next) => {
            // As the web says it (K7): where it went next, and that their copy is on its way.
            const names =
              next.length <= 1
                ? (next[0] ?? '')
                : `${next.slice(0, -1).join(', ')} and ${next.at(-1) ?? ''}`;
            setDone(
              completed
                ? tr(
                    'documents.envelope.everybody_has_signed_the_sealed_copy',
                    'Everybody has signed. The sealed copy, with its certificate of completion, is on its way to your email.',
                  )
                : names === ''
                  ? tr(
                      'documents.envelope.your_signature_is_in_your_copy',
                      'Your signature is in. Your copy is on its way to your email.',
                    )
                  : tr(
                      'documents.envelope.sent_to_for_their_signature_your',
                      'Sent to {{names}} for their signature. Your copy, as signed so far, is on its way to your email.',
                      { names },
                    ),
            );
            reload();
          }}
        />
        {otherDialog}
      </>
    );
  }
  return (
    <Page title={tr('documents.envelope.signature_status', 'Signature status')} back={back}>
      <Text variant="title2">{env.title}</Text>
      <View className="flex-row flex-wrap gap-1.5">
        <Badge
          tone={
            env.status === 'completed' ? 'success' : env.status === 'sent' ? 'warning' : 'neutral'
          }
        >
          {env.status === 'sent'
            ? tr('documents.envelope.of_signed', '{{String}} of {{String2}} signed', {
                String: String(signedCount),
                String2: String(total),
              })
            : env.status === 'completed'
              ? tr('documents.envelope.signed_and_sealed', 'Signed and sealed')
              : env.status}
        </Badge>
        {env.dueOn === null ? null : (
          <Badge>{tr('documents.envelope.due', 'Due {{dueOn}}', { dueOn: env.dueOn })}</Badge>
        )}
      </View>
      {env.message === '' ? null : (
        <Alert
          tone="info"
          title={tr('documents.envelope.says', '{{sender}} says', { sender: env.sender })}
        >
          {env.message}
        </Alert>
      )}
      {done === null ? null : <Alert tone="success">{done}</Alert>}
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      <Button startIcon={<Icon icon={Eye} />} onPress={() => void open()}>
        {tr('documents.envelope.read_the_document', 'Read the document')}
      </Button>
      <Heading title={tr('documents.envelope.signers', 'Signers')} />
      <Progress
        value={total === 0 ? 0 : (signedCount / total) * 100}
        label={tr('documents.envelope.of_signed', '{{String}} of {{String2}} signed', {
          String: String(signedCount),
          String2: String(total),
        })}
      />
      <List>
        {env.signers.map((s) => (
          <ListItem
            key={s.id}
            leading={<Avatar name={s.name} size="md" />}
            description={
              s.check === 'login'
                ? tr('documents.envelope.kithena_login', 'Kithena login')
                : tr('documents.envelope.code_by_email', 'Code by email')
            }
            trailing={
              <Badge tone={STATUS()[s.status]?.[1] ?? 'neutral'}>
                {STATUS()[s.status]?.[0] ?? s.status}
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
                      tr('documents.envelope.passed_on', 'Passed on.'),
                    )
                  }
                >
                  <SelectTrigger
                    accessibilityLabel={tr(
                      'documents.envelope.pass_s_turn_to',
                      'Pass {{name}}’s turn to',
                      { name: s.name },
                    )}
                  >
                    <SelectValue placeholder={tr('documents.envelope.pass_it_to', 'Pass it to…')} />
                  </SelectTrigger>
                  <SelectContent title={tr('documents.envelope.pass_to', 'Pass to')}>
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
            onPress={() =>
              void act(
                'RemindEnvelope',
                {
                  input: {
                    origin: signed.company.origin,
                    companyName: signed.company.displayName ?? signed.company.slug,
                  },
                },
                tr(
                  'documents.envelope.reminded_whoever_it_waits_on_now',
                  'Reminded whoever it waits on now.',
                ),
              )
            }
          >
            {tr('documents.envelope.remind', 'Remind')}
          </Button>
          <Button
            className="flex-1"
            variant="ghost"
            onPress={() => {
              setOther('void');
            }}
          >
            {tr('documents.envelope.cancel_the_request', 'Cancel the request')}
          </Button>
        </View>
      ) : null}
      {env.follows && env.trail.length > 0 ? (
        <>
          <Heading title={tr('documents.envelope.what_happened', 'What happened')} />
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
              ? tr('documents.envelope.ask', 'Ask {{sender}}', { sender })
              : other === 'decline'
                ? tr('documents.envelope.decline_to_sign', 'Decline to sign')
                : tr('documents.envelope.cancel_this_request', 'Cancel this request')}
          </DialogTitle>
          <DialogDescription>
            {other === 'ask'
              ? tr('documents.envelope.the_request_waits_for_you', 'The request waits for you.')
              : other === 'decline'
                ? `${sender} is told; say why.`
                : tr(
                    'documents.envelope.nobody_can_sign_it_afterwards_say',
                    'Nobody can sign it afterwards. Say why.',
                  )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>
              {other === 'ask'
                ? tr('documents.envelope.your_question', 'Your question')
                : tr('documents.envelope.why', 'Why')}
            </FieldLabel>
            <Textarea value={text} onChange={onText} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button className="flex-1" onPress={onClose}>
            {tr('documents.envelope.back', 'Back')}
          </Button>
          <Button
            className="flex-1"
            variant={other === 'ask' ? 'primary' : 'danger'}
            disabled={text.trim() === ''}
            loading={busy}
            onPress={onSend}
          >
            {tr('documents.envelope.send', 'Send')}
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
  const back = {
    label: tr('documents.envelope.documents', 'Documents'),
    onPress: navigation.goBack,
  };
  if (load.status !== 'ready') {
    return (
      <Page title={tr('documents.envelope.acknowledgements', 'Acknowledgements')} back={back}>
        {load.status === 'error' ? (
          <Failed message={load.message} onRetry={reload} />
        ) : (
          <Loading label={tr('documents.envelope.loading_the_policy', 'Loading the policy')} />
        )}
      </Page>
    );
  }
  const c = load.data;
  return (
    <Page title={c.title} back={back}>
      <Text variant="title2">
        {tr('documents.envelope.of_done', '{{String}} of {{String2}} done', {
          String: String(c.done),
          String2: String(c.of),
        })}
      </Text>
      <Progress
        value={c.of === 0 ? 0 : (c.done / c.of) * 100}
        label={tr('documents.envelope.of_acknowledged', '{{String}} of {{String2}} acknowledged', {
          String: String(c.done),
          String2: String(c.of),
        })}
      />
      {c.dueOn === null ? null : (
        <Text tone="muted">
          {tr('documents.envelope.due', 'Due {{dueOn}}', { dueOn: c.dueOn })}
        </Text>
      )}
      <Heading title={tr('documents.envelope.still_to_go', 'Still to go')} />
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
