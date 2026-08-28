import { Alert, Button, KithenaLogo } from '@reach/ui';
import type { JSX } from 'react';

/**
 * What a person sees with no valid session.
 *
 * Not a redirect. The handoff that puts a session cookie on this origin is
 * OAuth 2.1 authorization code with PKCE — `docs/authentication.md` specifies
 * it, and it is not built. Bouncing to the auth origin without it would send
 * somebody to a screen that signs them in and then has nowhere to put the
 * result, which looks like the sign-in failing.
 *
 * So this says what is true and stops. The `authorize` endpoint replaces the
 * button below, and this file is the only thing that changes.
 */
export function SignedOut(): JSX.Element {
  const authOrigin = process.env['AUTH_ORIGIN'] ?? '';

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <KithenaLogo showSubtitle className="text-fg" />
      <Alert tone="info" title="You are not signed in">
        Sign in on the auth origin with the passkey on this device.
      </Alert>
      <Button asChild disabled={authOrigin === ''}>
        <a href={authOrigin === '' ? '#' : `${authOrigin}/login`}>Go to sign in</a>
      </Button>
    </main>
  );
}
