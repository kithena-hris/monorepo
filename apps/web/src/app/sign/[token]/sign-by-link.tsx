'use client';

import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { useState, useTransition, type JSX } from 'react';

import {
  AdoptDialog,
  DocumentToSign,
  useSigning,
  type EnvelopeData,
} from '@kithena/web-documents/sign';

import { declineLink, requestCode, signLink, verifyCode } from './actions';

/** What a link's request looks like to its signer: Documents' `EnvelopeView`. */
export type LinkEnvelope = EnvelopeData;

/**
 * K6 then K4–K5 for somebody outside: a code by email, then their fields,
 * a signature typed or drawn, and Sign. The document is shown beside it,
 * from a link that lasts minutes.
 */
export function SignByLink({
  token,
  company,
  envelope,
  fileUrl,
}: {
  readonly token: string;
  readonly company: string;
  readonly envelope: LinkEnvelope | null;
  readonly fileUrl: string | null;
}): JSX.Element {
  const [verified, setVerified] = useState(envelope?.me?.status === 'verified');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (envelope === null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <EmptyState
          icon={<icons.locked />}
          title="This link does not open anything"
          description="It may have been replaced, cancelled or signed already."
        />
      </main>
    );
  }
  if (envelope.status !== 'sent' || envelope.me?.turn !== true || done !== null) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <EmptyState
          icon={<icons.success />}
          title={
            done ??
            (envelope.status === 'completed'
              ? 'Signed'
              : envelope.status === 'sent'
                ? 'Not your turn yet'
                : `This request was ${envelope.status}`)
          }
          description={
            done === null ? `${envelope.sender} at ${company} sent it.` : 'You can close this page.'
          }
        />
      </main>
    );
  }
  const act = (run: () => Promise<void>) => {
    setProblem(null);
    start(run);
  };

  if (!verified) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
        <PageHeader
          title="Check it’s you"
          description={`${company} sent you ${envelope.title} to sign.`}
        />
        {sentTo === null ? (
          <Button
            variant="primary"
            loading={pending}
            onClick={() => {
              act(async () => {
                const r = await requestCode(token);
                if (r.ok) setSentTo(r.data.sentTo);
                else setProblem(r.message);
              });
            }}
          >
            Email me a code
          </Button>
        ) : (
          <>
            <PinInput
              label={`The code we emailed to ${sentTo}`}
              value={code}
              onChange={setCode}
              length={6}
              type="numeric"
              autoFocus
              onComplete={(full) => {
                act(async () => {
                  const r = await verifyCode(token, full);
                  if (!r.ok) setProblem(r.message);
                  else if (r.verified) setVerified(true);
                  else {
                    setProblem('That code is not right. Try again.');
                    setCode('');
                  }
                });
              }}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setSentTo(null);
                setCode('');
              }}
            >
              Send a new code
            </Button>
          </>
        )}
        {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
      </main>
    );
  }

  return (
    <SignNow
      token={token}
      company={company}
      envelope={envelope}
      fileUrl={fileUrl}
      onDone={setDone}
    />
  );
}

/** Verified: their boxes on the document, Start and Next to each, Finish. */
function SignNow({
  token,
  company,
  envelope,
  fileUrl,
  onDone,
}: {
  readonly token: string;
  readonly company: string;
  readonly envelope: LinkEnvelope;
  readonly fileUrl: string | null;
  readonly onDone: (done: string) => void;
}): JSX.Element {
  const name = envelope.signers.find((s) => s.id === envelope.me?.signerId)?.name ?? '';
  const signing = useSigning(envelope, name);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const needsMark = signing.mine.some((f) => f.kind === 'signature' || f.kind === 'initials');
  const act = (run: () => Promise<void>) => {
    setProblem(null);
    start(run);
  };

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <PageHeader title={envelope.title} description={`From ${envelope.sender} at ${company}`} />
      {envelope.message === '' ? null : (
        <Alert tone="info" title={`${envelope.sender} says`}>
          {envelope.message}
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card variant="fill" padded>
          {fileUrl === null ? (
            <Alert tone="danger">The document could not be opened.</Alert>
          ) : (
            <DocumentToSign env={envelope} url={fileUrl} signing={signing} name={name} />
          )}
        </Card>
        <Card variant="assistant" className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader>
            <CardTitle level={2}>Your part</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">
              {signing.ready
                ? 'Every box of yours is filled.'
                : 'Start takes you to each box of yours; press it, or Apply, to fill it.'}
            </p>
            {signing.mark === null ? null : (
              <div className="h-16 rounded-md bg-surface-sunken">
                <Signature value={signing.mark} label={`${name}’s signature`} />
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
                {signing.mark === null ? 'Adopt your signature' : 'Change your signature'}
              </Button>
            ) : null}
            {problem === null ? null : <Alert tone="danger">{problem}</Alert>}
            <Button
              variant="primary"
              disabled={!signing.ready || (needsMark && signing.mark === null)}
              loading={pending}
              onClick={() => {
                act(async () => {
                  const r = await signLink(
                    token,
                    signing.mark ?? { kind: 'typed', text: name },
                    signing.values,
                    signing.day,
                  );
                  if (!r.ok) setProblem(r.message);
                  else
                    onDone(
                      r.data.completed
                        ? 'Signed. Everybody has signed; the sealed copy is with the sender.'
                        : 'Signed. The others sign next.',
                    );
                });
              }}
            >
              Finish
            </Button>
            <p className="text-xs text-fg-muted">
              Adopting a signature, you agree it is the legal equivalent of your handwritten one.
            </p>
            {declining ? (
              <>
                <Field required>
                  <FieldLabel>Why you decline</FieldLabel>
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
                      if (r.ok) onDone('Declined. The sender is told.');
                      else setProblem(r.message);
                    });
                  }}
                >
                  Decline to sign
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
                Decline
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
      <AdoptDialog
        open={signing.adopting}
        name={name}
        onOpenChange={signing.setAdopting}
        onAdopt={signing.adopt}
      />
    </main>
  );
}
