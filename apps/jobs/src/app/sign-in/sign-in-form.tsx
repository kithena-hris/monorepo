'use client';

import {
  Alert,
  Button,
  Field,
  FieldControl,
  FieldDescription,
  FieldLabel,
  Input,
  PinInput,
  Separator,
  icons,
} from '@reach/ui';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type JSX } from 'react';

/**
 * Signing in (PRD §10.5, extended): an address and a six-digit code, or
 * Google. No password anywhere. The account is made by the first sign-in.
 */
export function SignInForm({
  next,
  google,
  error,
}: {
  readonly next: string;
  readonly google: boolean;
  readonly error: string | null;
}): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string | null>(
    error === 'google' ? 'Google did not sign you in. Try again, or use a code.' : null,
  );
  const [pending, start] = useTransition();
  const ask = (): void => {
    start(async () => {
      setFailed(null);
      const response = await fetch('/auth/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, name }),
      });
      if (response.ok) setSent(true);
      else {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setFailed(body?.error?.message ?? 'That did not go through.');
      }
    });
  };
  const signIn = (): void => {
    start(async () => {
      setFailed(null);
      const response = await fetch('/auth/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      if (response.ok) {
        router.push(next);
        router.refresh();
      } else {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setFailed(body?.error?.message ?? 'That code is not right.');
      }
    });
  };
  return (
    <div className="flex flex-col gap-5">
      {failed === null ? null : <Alert tone="danger" title={failed} />}
      {google ? (
        <>
          <Button
            asChild
            variant="secondary"
            size="lg"
            startIcon={<icons.identifier aria-hidden />}
          >
            <a href={`/auth/google?next=${encodeURIComponent(next)}`}>Continue with Google</a>
          </Button>
          <div className="flex items-center gap-3 text-sm text-fg-muted">
            <Separator className="flex-1" />
            or with a code
            <Separator className="flex-1" />
          </div>
        </>
      ) : null}
      {sent ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === 6) signIn();
          }}
        >
          <p className="text-fg-muted">{`We sent a six-digit code to ${email}.`}</p>
          <PinInput label="The code" length={6} value={code} onChange={setCode} type="numeric" />
          <div className="flex justify-between">
            <Button type="button" variant="ghost" loading={pending} onClick={ask}>
              Send a new code
            </Button>
            <Button type="submit" disabled={code.length !== 6} loading={pending}>
              Sign in
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.includes('@')) ask();
          }}
        >
          <Field required>
            <FieldLabel>Email</FieldLabel>
            <FieldControl>
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
            </FieldControl>
            <FieldDescription>The address you apply with. A code goes there.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <FieldControl>
              <Input
                autoComplete="name"
                value={name}
                placeholder="If this is your first time here"
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </FieldControl>
          </Field>
          <Button type="submit" size="lg" disabled={!email.includes('@')} loading={pending}>
            Email me a code
          </Button>
        </form>
      )}
    </div>
  );
}
