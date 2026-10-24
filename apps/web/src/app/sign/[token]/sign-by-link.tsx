'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
  Input,
  PageHeader,
  PinInput,
  Signature,
  icons,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

import {
  AdoptDialog,
  DocumentToSign,
  SIGNED,
  doneMessage,
  useSigning,
  type EnvelopeData,
  type Stamped,
} from '@kithena/web-documents/sign';

import { declineLink, requestCode, signLink, verifyCode } from './actions';
import { t } from '../../../lib/t';

/** What a link's request looks like to its signer: Documents' `EnvelopeView`. */
export type LinkEnvelope = EnvelopeData;

/**
 * K4–K6 for somebody outside the company, from the link in their email: the
 * document opens at once with their boxes on it and the step bar under it,
 * as a colleague sees it. Finish asks for the code we email them — proof the
 * mailbox is theirs — once, and then signs.
 */
export function SignByLink({
  token,
  company,
  envelope,
  fileUrl,
  problem = null,
}: {
  readonly token: string;
  readonly company: string;
  readonly envelope: LinkEnvelope | null;
  readonly fileUrl: string | null;
  /** Why the request could not be read: a link that opens nothing, or Kithena out of reach. */
  readonly problem?: string | null;
}): JSX.Element {
  const [done, setDone] = useState<string | null>(null);
  // What they just signed, drawn over the copy on screen until the new copy has loaded.
  const [stamped, setStamped] = useState<Stamped | null>(null);

  if (envelope === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        {problem == null || /does not open|another company/u.test(problem) ? (
          <EmptyState
            icon={<icons.locked />}
            title={t(
              'app.sign.[token].sign-by-link.this_link_does_not_open_anything',
              'This link does not open anything',
            )}
            description={t(
              'app.sign.[token].sign-by-link.it_may_have_been_replaced_by',
              'It may have been replaced by a newer email, cancelled or signed already.',
            )}
          />
        ) : (
          <EmptyState
            icon={<icons.warning />}
            title={t(
              'app.sign.[token].sign-by-link.kithena_could_not_open_this_just',
              'Kithena could not open this just now',
            )}
            description={t(
              'app.sign.[token].sign-by-link.reload_the_page_in_a_moment',
              '{{problem}} Reload the page in a moment.',
              { problem },
            )}
          />
        )}
      </main>
    );
  }
  if (envelope.status !== 'sent' || envelope.me?.turn !== true || done !== null) {
    // The document as it stands under the message: every signature so far
    // drawn in with its trace (K7), theirs too once they have signed.
    const signedNow = done !== null || envelope.me?.status === 'signed';
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
        <PageHeader
          title={envelope.title}
          description={t(
            'app.sign.[token].sign-by-link.from_at',
            'From {{sender}} at {{company}}',
            { sender: envelope.sender, company },
          )}
        />
        <Alert
          tone={signedNow || envelope.status === 'completed' ? 'success' : 'info'}
          title={
            signedNow
              ? t('app.sign.[token].sign-by-link.signed', 'Signed')
              : envelope.status === 'completed'
                ? t('app.sign.[token].sign-by-link.everybody_has_signed', 'Everybody has signed')
                : envelope.status === 'sent'
                  ? t('app.sign.[token].sign-by-link.not_your_turn_yet', 'Not your turn yet')
                  : t(
                      'app.sign.[token].sign-by-link.this_request_was',
                      'This request was {{status}}',
                      { status: envelope.status },
                    )
          }
        >
          {done ??
            (envelope.status === 'sent' && !signedNow
              ? t(
                  'app.sign.[token].sign-by-link.you_get_an_email_when_it',
                  'You get an email when it is your turn to sign.',
                )
              : t(
                  'app.sign.[token].sign-by-link.you_can_close_this_page',
                  'You can close this page.',
                ))}
        </Alert>
        {fileUrl === null ? null : (
          <DocumentToSign env={envelope} url={fileUrl} signing={null} name="" stamped={stamped} />
        )}
      </main>
    );
  }
  return (
    <SignNow
      token={token}
      company={company}
      envelope={envelope}
      fileUrl={fileUrl}
      verified={envelope.me.status === 'verified'}
      onDone={(message, signed) => {
        // A decline has nothing to draw.
        setStamped(signed ?? null);
        setDone(message);
      }}
    />
  );
}

/** Their boxes on the document, the step bar under it, and the code at Finish. */
function SignNow({
  token,
  company,
  envelope,
  fileUrl,
  verified: verifiedAlready,
  onDone,
}: {
  readonly token: string;
  readonly company: string;
  readonly envelope: LinkEnvelope;
  readonly fileUrl: string | null;
  /** They confirmed the code already, on an earlier visit. */
  readonly verified: boolean;
  /** Signed: what to say, and what they signed, to draw until the new copy loads. */
  readonly onDone: (done: string, stamped?: Stamped) => void;
}): JSX.Element {
  // The name the sender gave them: what a typed signature says.
  const name = envelope.signers.find((s) => s.id === envelope.me?.signerId)?.name ?? '';
  const signing = useSigning(envelope, name);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [verified, setVerified] = useState(verifiedAlready);
  const [checking, setChecking] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [declining, setDeclining] = useState(false);
  const router = useRouter();
  const [reason, setReason] = useState('');
  const needsMark = signing.mine.some((f) => SIGNED.has(f.kind));
  const act = (run: () => Promise<void>) => {
    setProblem(null);
    start(run);
  };

  const submit = async () => {
    const mark = signing.mark ?? { kind: 'typed' as const, text: name };
    const r = await signLink(token, mark, signing.values, signing.day, signing.traceId);
    if (!r.ok) setProblem(r.message);
    else {
      // At once: every box of theirs holds their signature, its print under it.
      onDone(doneMessage(r.data.completed, r.data.next), {
        signerId: envelope.me?.signerId ?? '',
        mark,
        filled: signing.filled,
        traceId: signing.traceId,
        at: new Date(),
      });
      // Read again: the copy shown now has this signature drawn in.
      router.refresh();
    }
  };

  // Finish: the code first, the one time, then the signature.
  const finish = () => {
    if (verified) {
      act(submit);
      return;
    }
    setChecking(true);
    if (sentTo === null)
      act(async () => {
        const r = await requestCode(token);
        if (r.ok) setSentTo(r.data.sentTo);
        else setProblem(r.message);
      });
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader
        title={envelope.title}
        description={t('app.sign.[token].sign-by-link.from_at', 'From {{sender}} at {{company}}', {
          sender: envelope.sender,
          company,
        })}
      />
      {envelope.message === '' ? null : (
        <Alert
          tone="info"
          title={t('app.sign.[token].sign-by-link.says', '{{sender}} says', {
            sender: envelope.sender,
          })}
        >
          {envelope.message}
        </Alert>
      )}
      {/* One column: their part first, then the document with its step bar under it. */}
      <div className="flex flex-col gap-6">
        <Card variant="assistant">
          <CardHeader>
            <CardTitle level={2}>
              {t('app.sign.[token].sign-by-link.your_part', 'Your part')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              {signing.ready
                ? t(
                    'app.sign.[token].sign-by-link.everything_is_filled_in_finish_under',
                    'Everything is filled in. Finish, under the document, signs it.',
                  )
                : t(
                    'app.sign.[token].sign-by-link.start_under_the_document_takes_you',
                    'Start, under the document, takes you to each place to sign.',
                  )}
            </p>
            {signing.mark === null ? null : (
              <div className="h-16 rounded-md bg-surface-sunken">
                <Signature
                  value={signing.mark}
                  label={t('app.sign.[token].sign-by-link.s_signature', '{{name}}’s signature', {
                    name,
                  })}
                />
              </div>
            )}
            {needsMark ? (
              <Button
                variant="secondary"
                startIcon={<icons.edit aria-hidden />}
                onClick={() => {
                  signing.setAdopting(true);
                }}
              >
                {signing.mark === null
                  ? t('app.sign.[token].sign-by-link.adopt_your_signature', 'Adopt your signature')
                  : t(
                      'app.sign.[token].sign-by-link.change_your_signature',
                      'Change your signature',
                    )}
              </Button>
            ) : null}
            {problem === null || checking ? null : <Alert tone="danger">{problem}</Alert>}
            <p className="text-xs text-fg-muted">
              {verified
                ? t(
                    'app.sign.[token].sign-by-link.adopting_a_signature_you_agree_it',
                    'Adopting a signature, you agree it is the legal equivalent of your handwritten one.',
                  )
                : t(
                    'app.sign.[token].sign-by-link.adopting_a_signature_you_agree_it_2',
                    'Adopting a signature, you agree it is the legal equivalent of your handwritten one. At Finish we email you a code to confirm it is you.',
                  )}
            </p>
            {declining ? (
              <>
                <Field required>
                  <FieldLabel>
                    {t('app.sign.[token].sign-by-link.why_you_decline', 'Why you decline')}
                  </FieldLabel>
                  <FieldControl>
                    <Input
                      value={reason}
                      maxLength={1000}
                      onChange={(e) => {
                        setReason(e.target.value);
                      }}
                    />
                  </FieldControl>
                </Field>
                <Button
                  variant="danger"
                  disabled={reason.trim() === ''}
                  onClick={() => {
                    act(async () => {
                      const r = await declineLink(token, reason);
                      if (r.ok)
                        onDone(
                          t(
                            'app.sign.[token].sign-by-link.declined_the_sender_is_told',
                            'Declined. The sender is told.',
                          ),
                        );
                      else setProblem(r.message);
                    });
                  }}
                >
                  {t('app.sign.[token].sign-by-link.decline_to_sign', 'Decline to sign')}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => {
                  setDeclining(true);
                }}
              >
                {t('app.sign.[token].sign-by-link.decline', 'Decline')}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card variant="fill" padded>
          {fileUrl === null ? (
            <Alert tone="danger">
              {t(
                'app.sign.[token].sign-by-link.the_document_could_not_be_opened',
                'The document could not be opened.',
              )}
            </Alert>
          ) : (
            <DocumentToSign
              env={envelope}
              url={fileUrl}
              signing={signing}
              name={name}
              onFinish={finish}
              finishing={pending}
            />
          )}
        </Card>
      </div>
      <AdoptDialog
        open={signing.adopting}
        name={name}
        onOpenChange={signing.setAdopting}
        onAdopt={signing.adopt}
      />
      <Dialog
        open={checking}
        onOpenChange={(open) => {
          if (!open) setChecking(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t('app.sign.[token].sign-by-link.confirm_its_you', 'Confirm it’s you')}
            </DialogTitle>
            <DialogDescription>
              {sentTo === null
                ? t(
                    'app.sign.[token].sign-by-link.we_are_emailing_you_a_six',
                    'We are emailing you a six-digit code.',
                  )
                : t(
                    'app.sign.[token].sign-by-link.we_emailed_a_six_digit_code',
                    'We emailed a six-digit code to {{sentTo}}. It works for ten minutes.',
                    { sentTo },
                  )}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <PinInput
              label={t('app.sign.[token].sign-by-link.your_code', 'Your code')}
              value={code}
              onChange={setCode}
              length={6}
              type="numeric"
              autoFocus
              disabled={sentTo === null || pending}
              onComplete={(full) => {
                act(async () => {
                  const r = await verifyCode(token, full);
                  if (!r.ok) setProblem(r.message);
                  else if (!r.verified) {
                    setProblem(
                      t(
                        'app.sign.[token].sign-by-link.that_code_is_not_right_try_again',
                        'That code is not right. Try again.',
                      ),
                    );
                    setCode('');
                  } else {
                    setVerified(true);
                    setChecking(false);
                    await submit();
                  }
                });
              }}
            />
            {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
          </DialogBody>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setCode('');
                setSentTo(null);
                act(async () => {
                  const r = await requestCode(token);
                  if (r.ok) setSentTo(r.data.sentTo);
                  else setProblem(r.message);
                });
              }}
            >
              {t('app.sign.[token].sign-by-link.send_a_new_code', 'Send a new code')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
