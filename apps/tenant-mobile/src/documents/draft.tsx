import {
  Alert,
  Badge,
  Button,
  ChatComposer,
  ChatLog,
  ChatMessage,
  ChatTyping,
  List,
  ListItem,
  Text,
} from '@reach/ui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { Page } from '../frame';
import { useSigned } from '../people/api';
import type { PeopleScreen } from '../people/routes';
import { askDocuments } from './api';

/**
 * Draft with Kithena on the phone, as on the web (PRD §14.2): HR says what
 * they need, Kithena asks for what is missing and writes it, and the draft is
 * filed and sent to sign by a press or by saying so ("send it"), each
 * signer's box already on their own line. Nothing is kept until then.
 */

interface Signer {
  readonly name: string;
  readonly email: string | null;
  readonly order: number;
  readonly personId: string | null;
}

interface Draft {
  readonly title: string;
  readonly typeKey: string | null;
  readonly typeName: string | null;
  readonly about: string | null;
  readonly aboutPersonId: string | null;
  readonly body: string;
  readonly signers: readonly Signer[];
  readonly figures: readonly string[];
  readonly ready: boolean;
}

interface Reply {
  readonly available: boolean;
  readonly reply: string;
  readonly action: 'send' | 'file' | null;
  readonly draft: Draft | null;
}

interface Said {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

const OPENING =
  'What do you need? Tell me what the document is, whom it is for and who signs it, in which order.';

export function DocumentDraft({ navigation }: PeopleScreen<'DocumentDraft'>): React.JSX.Element {
  const signed = useSigned();
  const companyName = signed.company.displayName ?? signed.company.slug;
  const [said, setSaid] = useState<readonly Said[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  /** Filed as it stands, sent to its signers when `andSend`, then opened. */
  const file = async (doc: Draft, andSend: boolean): Promise<void> => {
    const r = await askDocuments<{ id: string; envelopeId: string | null }>(signed, 'FileDraft', {
      input: {
        title: doc.title,
        typeKey: doc.typeKey,
        aboutPersonId: doc.aboutPersonId,
        body: doc.body,
        signers: doc.signers.map(({ name, email, order, personId }) => ({
          name,
          email,
          order,
          personId,
        })),
        send: andSend,
        origin: signed.company.origin,
        companyName,
      },
    });
    if (!r.ok) {
      setProblem(r.message);
      return;
    }
    if (r.data.envelopeId === null) {
      navigation.replace('DocumentDetail', { id: r.data.id, title: doc.title });
    } else {
      navigation.replace('DocumentEnvelope', { id: r.data.envelopeId });
    }
  };

  const send = (text: string): void => {
    const messages = [...said, { role: 'user' as const, text }];
    setSaid(messages);
    setProblem(null);
    setBusy(true);
    void (async () => {
      const r = await askDocuments<Reply>(signed, 'DraftDocument', {
        input: {
          messages,
          draft:
            draft === null
              ? null
              : {
                  title: draft.title,
                  typeKey: draft.typeKey,
                  about: draft.about,
                  body: draft.body,
                  signers: draft.signers.map(({ name, email, order }) => ({ name, email, order })),
                },
          companyName,
        },
      });
      if (!r.ok) {
        setProblem(r.message);
        setBusy(false);
        return;
      }
      setSaid([...messages, { role: 'assistant', text: r.data.reply }]);
      if (r.data.draft !== null) setDraft(r.data.draft);
      // "Send it", said once the draft is ready, does what the button does.
      if (r.data.action !== null && r.data.draft !== null) {
        await file(r.data.draft, r.data.action === 'send');
      }
      setBusy(false);
    })();
  };

  const press = (andSend: boolean): void => {
    if (draft === null) return;
    setProblem(null);
    setBusy(true);
    void file(draft, andSend).finally(() => {
      setBusy(false);
    });
  };

  const signs = draft !== null && draft.signers.length > 0;

  return (
    <Page
      title="Draft with Kithena"
      back={{ label: 'Close', onPress: navigation.goBack }}
      foot={
        <ChatComposer
          accessibilityLabel="Message Kithena"
          placeholder="An offer letter for Omar, 85,000 a year. He signs, then me."
          busy={busy}
          onSend={send}
        />
      }
    >
      <ChatLog accessibilityLabel="Conversation with Kithena">
        <ChatMessage author="Kithena">{OPENING}</ChatMessage>
        {said.map((m, i) => (
          <ChatMessage
            // The conversation only grows; a turn's place is its identity.
            key={i}
            from={m.role === 'user' ? 'self' : 'other'}
            author={m.role === 'user' ? 'You' : 'Kithena'}
          >
            {m.text}
          </ChatMessage>
        ))}
        {busy ? <ChatTyping author="Kithena" /> : null}
      </ChatLog>
      {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      {draft === null ? null : (
        <View className="gap-3">
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text variant="title3">{draft.title}</Text>
            {draft.typeName === null ? null : <Badge>{draft.typeName}</Badge>}
          </View>
          {draft.about === null ? null : (
            <Text variant="footnote" tone="muted">{`About ${draft.about}`}</Text>
          )}
          <Text>{draft.body}</Text>
          {draft.figures.length === 0 ? null : (
            <Alert tone="warning">
              {`Check ${draft.figures.join(', ')}: nobody gave Kithena ${draft.figures.length === 1 ? 'this figure' : 'these figures'}.`}
            </Alert>
          )}
          {signs ? (
            <List>
              {[...draft.signers]
                .sort((a, b) => a.order - b.order)
                .map((s) => {
                  const badge =
                    s.personId !== null ? null : s.email === null ? (
                      <Badge tone="warning">Not found</Badge>
                    ) : (
                      <Badge tone="info">Outside</Badge>
                    );
                  return (
                    <ListItem
                      key={`${String(s.order)}-${s.name}`}
                      {...(s.email === null ? {} : { description: s.email })}
                      {...(badge === null ? {} : { trailing: badge })}
                    >
                      {`${String(s.order)}. ${s.name}`}
                    </ListItem>
                  );
                })}
            </List>
          ) : null}
          {signs ? (
            <Button
              variant="primary"
              disabled={!draft.ready || busy}
              onPress={() => {
                press(true);
              }}
            >
              Send for signature
            </Button>
          ) : null}
          <Button
            disabled={!draft.ready || busy}
            onPress={() => {
              press(false);
            }}
          >
            {signs ? 'File without sending' : 'File it'}
          </Button>
        </View>
      )}
    </Page>
  );
}
