import {
  Alert,
  Badge,
  Button,
  Card,
  ChatComposer,
  ChatLog,
  ChatMessage,
  ChatTyping,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  List,
  ListItem,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import type { Read } from '../types';

/**
 * A document drafted with Kithena (PRD §14.2): HR says what they need, Kithena
 * asks for what is missing and writes it, and the draft beside the
 * conversation is filed and sent to sign in one press, each signer's box
 * already on their own line. Nothing is kept until then: the conversation and
 * the draft travel with each turn.
 */

export interface DraftSigner {
  readonly name: string;
  readonly email: string | null;
  readonly order: number;
  readonly personId: string | null;
}

export interface Draft {
  readonly title: string;
  readonly typeKey: string | null;
  readonly typeName: string | null;
  readonly about: string | null;
  readonly aboutPersonId: string | null;
  readonly body: string;
  readonly signers: readonly DraftSigner[];
  readonly figures: readonly string[];
  readonly ready: boolean;
}

export interface DraftReply {
  readonly available: boolean;
  readonly reply: string;
  readonly draft: Draft | null;
}

interface Said {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface DraftProps {
  readonly onDraftDocument?:
    | ((turn: {
        readonly messages: readonly Said[];
        readonly draft: Readonly<Record<string, unknown>> | null;
      }) => Promise<Read<DraftReply>>)
    | undefined;
  readonly onFileDraft?:
    | ((
        draft: Readonly<Record<string, unknown>>,
        send: boolean,
      ) => Promise<Read<{ readonly id: string; readonly envelopeId: string | null }>>)
    | undefined;
}

const OPENING =
  'What do you need? Tell me what the document is, whom it is for and who signs it, in which order.';

export function DraftDialog({
  open,
  onOpenChange,
  onDraftDocument,
  onFileDraft,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Where to go once it is filed: its signing tracker, or the document. */
  readonly onDone: (href: string) => void;
} & DraftProps): JSX.Element {
  const [said, setSaid] = useState<readonly Said[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (text: string): void => {
    if (onDraftDocument === undefined || text.trim() === '') return;
    const messages = [...said, { role: 'user' as const, text: text.trim() }];
    setSaid(messages);
    setError(null);
    start(async () => {
      const r = await onDraftDocument({
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
      });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setSaid([...messages, { role: 'assistant', text: r.data.reply }]);
      if (r.data.draft !== null) setDraft(r.data.draft);
    });
  };

  const file = (andSend: boolean): void => {
    if (onFileDraft === undefined || draft === null) return;
    setError(null);
    start(async () => {
      const r = await onFileDraft(
        {
          title: draft.title,
          typeKey: draft.typeKey,
          aboutPersonId: draft.aboutPersonId,
          body: draft.body,
          signers: draft.signers.map(({ name, email, order, personId }) => ({
            name,
            email,
            order,
            personId,
          })),
        },
        andSend,
      );
      if (!r.ok) {
        setError(r.message);
        return;
      }
      onDone(
        r.data.envelopeId === null
          ? `/documents/d/${r.data.id}`
          : `/documents/envelopes/${r.data.envelopeId}`,
      );
    });
  };

  const signs = draft !== null && draft.signers.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheetOnTouch className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Draft with Kithena</DialogTitle>
          <DialogDescription>
            Say what you need. Kithena asks for anything missing, writes it, and places a box for
            each signer in the order you give.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4 md:grid-cols-2">
          <div className="flex min-h-80 flex-col gap-3">
            <ChatLog label="Conversation with Kithena" className="max-h-[50vh] flex-1">
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
              {pending ? <ChatTyping author="Kithena" /> : null}
            </ChatLog>
            <ChatComposer
              label="Message Kithena"
              placeholder="An offer letter for Omar Lewis, 85,000 a year from 1 November. He signs, then me."
              busy={pending}
              disabled={onDraftDocument === undefined}
              onSend={send}
            />
          </div>
          {draft === null ? (
            <Card variant="outlined" padded className="text-sm text-fg-muted">
              The draft appears here as Kithena writes it.
            </Card>
          ) : (
            <Card variant="outlined" padded className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{draft.title}</h3>
                {draft.typeName === null ? null : <Badge>{draft.typeName}</Badge>}
              </div>
              {draft.about === null ? null : (
                <p className="text-sm text-fg-muted">About {draft.about}</p>
              )}
              <p className="max-h-[40vh] overflow-y-auto text-sm whitespace-pre-wrap">
                {draft.body}
              </p>
              {draft.figures.length === 0 ? null : (
                <Alert tone="warning">
                  Check {draft.figures.join(', ')}: nobody gave Kithena{' '}
                  {draft.figures.length === 1 ? 'this figure' : 'these figures'}.
                </Alert>
              )}
              {signs ? (
                <List aria-label="Who signs, in order">
                  {draft.signers
                    .toSorted((a, b) => a.order - b.order)
                    .map((s) => (
                      <ListItem key={`${String(s.order)}-${s.name}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span>
                            {s.order}. {s.name}
                            {s.email === null ? '' : ` · ${s.email}`}
                          </span>
                          {s.personId === null && s.email === null ? (
                            <Badge tone="warning">Not found</Badge>
                          ) : s.personId === null ? (
                            <Badge tone="info">Outside</Badge>
                          ) : null}
                        </div>
                      </ListItem>
                    ))}
                </List>
              ) : null}
            </Card>
          )}
        </DialogBody>
        {error === null ? null : (
          <Alert tone="danger" className="mx-6">
            {error}
          </Alert>
        )}
        <DialogFooter>
          <Button
            variant={signs ? 'secondary' : 'primary'}
            disabled={draft === null || !draft.ready || pending}
            onClick={() => {
              file(false);
            }}
          >
            {signs ? 'File without sending' : 'File it'}
          </Button>
          {signs ? (
            <Button
              variant="primary"
              disabled={!draft.ready || pending}
              onClick={() => {
                file(true);
              }}
            >
              Send for signature
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
