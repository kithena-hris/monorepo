import {
  Alert,
  Badge,
  Button,
  Card,
  ChatComposer,
  ChatLog,
  ChatMessage,
  ChatTyping,
  Chip,
  ChipRow,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  List,
  ListItem,
  PdfPages,
  icons,
} from '@reach/ui';
import { useState, useTransition, type JSX } from 'react';

import type { Read } from '../types';
import { t } from '../i18n';

/**
 * A document drafted with Kithena (PRD §14.2): HR says what they need, Kithena
 * asks for what is missing and writes it, and the draft beside the
 * conversation is filed and sent to sign in one press, or by saying so ("send
 * it"), each signer's box already on their own line. Nothing is kept until then: the conversation and
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
  /** "Send it" or "just file it", said in words once the draft is ready. */
  readonly action: 'send' | 'file' | null;
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
  /** The draft drawn as it would be filed: the PDF's URL, to read over before sending. */
  readonly onPreviewDraft?:
    | ((draft: Readonly<Record<string, unknown>>) => Promise<Read<{ readonly url: string }>>)
    | undefined;
  readonly onFileDraft?:
    | ((
        draft: Readonly<Record<string, unknown>>,
        send: boolean,
      ) => Promise<Read<{ readonly id: string; readonly envelopeId: string | null }>>)
    | undefined;
}

const OPENING = t(
  'library.draft.what_do_you_need_tell_me',
  'What do you need? Tell me what the document is, whom it is for and who signs it, in which order.',
);

/** What HR usually asks for next, offered as a press once there is a draft. */
const SUGGESTIONS = [
  t('library.draft.make_it_shorter', 'Make it shorter'),
  t('library.draft.make_it_warmer', 'Make it warmer'),
  t('library.draft.add_a_probation_period', 'Add a probation period'),
  t('library.draft.add_a_confidentiality_clause', 'Add a confidentiality clause'),
  t('library.draft.use_plainer_words', 'Use plainer words'),
] as const;

export function DraftDialog({
  open,
  onOpenChange,
  onDraftDocument,
  onPreviewDraft,
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
  // The draft drawn as it would be filed, for the one it was drawn from: a
  // later turn changes the draft, and the preview is asked for again.
  const [preview, setPreview] = useState<{ readonly of: Draft; readonly url: string } | null>(null);
  const [previewing, startPreview] = useTransition();
  const shown = preview !== null && preview.of === draft ? preview.url : null;

  const previewNow = (): void => {
    if (draft === null || onPreviewDraft === undefined) return;
    const of = draft;
    setError(null);
    startPreview(async () => {
      const r = await onPreviewDraft({
        title: of.title,
        body: of.body,
        signers: of.signers.map(({ name, order }) => ({ name, order })),
      });
      if (!r.ok) setError(r.message);
      else setPreview({ of, url: r.data.url });
    });
  };

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
      if (r.data.action !== null && r.data.draft !== null) {
        await filing(r.data.draft, r.data.action === 'send');
      }
    });
  };

  /** Filed as it stands, and sent to its signers when `andSend`. */
  const filing = async (doc: Draft, andSend: boolean): Promise<void> => {
    if (onFileDraft === undefined) return;
    const r = await onFileDraft(
      {
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
  };

  const file = (andSend: boolean): void => {
    if (draft === null) return;
    setError(null);
    start(() => filing(draft, andSend));
  };

  const signs = draft !== null && draft.signers.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent sheetOnTouch className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('library.draft.draft_with_kithena', 'Draft with Kithena')}</DialogTitle>
          <DialogDescription>
            {t(
              'library.draft.say_what_you_need_kithena_asks',
              'Say what you need. Kithena asks for anything missing, writes it, and places a box for each signer in the order you give. Say “send it” when it is right.',
            )}
          </DialogDescription>
        </DialogHeader>
        {/* One column, top to bottom: the draft as it stands, its preview, then the conversation that changes it. */}
        <DialogBody className="flex flex-col gap-4">
          {draft === null ? (
            <Card variant="outlined" padded className="text-sm text-fg-muted">
              {t(
                'library.draft.the_draft_appears_here_as_kithena',
                'The draft appears here as Kithena writes it.',
              )}
            </Card>
          ) : (
            <Card variant="outlined" padded className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{draft.title}</h3>
                {draft.typeName === null ? null : <Badge>{draft.typeName}</Badge>}
                {onPreviewDraft === undefined ? null : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ms-auto"
                    loading={previewing}
                    startIcon={<icons.document aria-hidden />}
                    onClick={previewNow}
                  >
                    {shown === null
                      ? t('library.draft.preview_the_pdf', 'Preview the PDF')
                      : t('library.draft.preview_again', 'Preview again')}
                  </Button>
                )}
              </div>
              {draft.about === null ? null : (
                <p className="text-sm text-fg-muted">
                  {t('library.draft.about', 'About')} {draft.about}
                </p>
              )}
              {shown === null ? (
                <p className="max-h-[40vh] overflow-y-auto text-sm whitespace-pre-wrap">
                  {draft.body}
                </p>
              ) : (
                <PdfPages
                  src={shown}
                  label={draft.title}
                  className="max-h-[60dvh] overflow-y-auto overscroll-y-contain rounded-md bg-surface-sunken p-3"
                />
              )}
              {draft.figures.length === 0 ? null : (
                <Alert tone="warning">
                  {t(
                    'library.draft.check_nobody_gave_kithena',
                    'Check {{join}}: nobody gave Kithena',
                    { join: draft.figures.join(', ') },
                  )}{' '}
                  {draft.figures.length === 1
                    ? t('library.draft.this_figure', 'this figure')
                    : t('library.draft.these_figures', 'these figures')}
                  .
                </Alert>
              )}
              {signs ? (
                <List aria-label={t('library.draft.who_signs_in_order', 'Who signs, in order')}>
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
                            <Badge tone="warning">
                              {t('library.draft.not_found', 'Not found')}
                            </Badge>
                          ) : s.personId === null ? (
                            <Badge tone="info">{t('library.draft.outside', 'Outside')}</Badge>
                          ) : null}
                        </div>
                      </ListItem>
                    ))}
                </List>
              ) : null}
              <ChipRow aria-label={t('library.draft.ask_for_a_change', 'Ask for a change')}>
                {SUGGESTIONS.map((s) => (
                  <Chip
                    key={s}
                    disabled={pending || onDraftDocument === undefined}
                    onClick={() => {
                      send(s);
                    }}
                  >
                    {s}
                  </Chip>
                ))}
              </ChipRow>
            </Card>
          )}
          <div className="flex min-h-64 flex-col gap-3">
            <ChatLog
              label={t('library.draft.conversation_with_kithena', 'Conversation with Kithena')}
              className="max-h-[40vh] flex-1"
            >
              <ChatMessage author="Kithena">{OPENING}</ChatMessage>
              {said.map((m, i) => (
                <ChatMessage
                  // The conversation only grows; a turn's place is its identity.
                  key={i}
                  from={m.role === 'user' ? 'self' : 'other'}
                  author={
                    m.role === 'user'
                      ? t('library.draft.you', 'You')
                      : t('library.draft.kithena', 'Kithena')
                  }
                >
                  {m.text}
                </ChatMessage>
              ))}
              {pending ? <ChatTyping author="Kithena" /> : null}
            </ChatLog>
            <ChatComposer
              label={t('library.draft.message_kithena', 'Message Kithena')}
              placeholder={t(
                'library.draft.an_offer_letter_for_omar_lewis',
                'An offer letter for Omar Lewis, 85,000 a year from 1 November. He signs, then me.',
              )}
              busy={pending}
              disabled={onDraftDocument === undefined}
              onSend={send}
            />
          </div>
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
            {signs
              ? t('library.draft.file_without_sending', 'File without sending')
              : t('library.draft.file_it', 'File it')}
          </Button>
          {signs ? (
            <Button
              variant="primary"
              disabled={!draft.ready || pending}
              onClick={() => {
                file(true);
              }}
            >
              {t('library.draft.send_for_signature', 'Send for signature')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
