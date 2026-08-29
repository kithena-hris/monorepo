import { Alert, Button, Card, PageHeader, Stack } from '@reach/ui';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { currentTenant } from '../../lib/branding';
import { currentPerson } from '../../lib/session';

/**
 * The landing place for a sign-in that did not complete.
 *
 * A handoff code expires after sixty seconds, so the ordinary way to arrive
 * here is leaving a tab open and coming back — which is not an error worth
 * explaining, only a reason to start again. The page therefore says the short
 * true thing and puts the button that fixes it in the middle.
 */
export default async function SignedOut(): Promise<JSX.Element> {
  // Somebody who is signed in has no reason to be told they are not.
  if ((await currentPerson()) !== null) redirect('/');

  const tenant = await currentTenant();
  const authOrigin = process.env['AUTH_ORIGIN'] ?? '';
  const signInUrl =
    authOrigin === '' || tenant === null
      ? null
      : `${authOrigin}/login?tenant=${encodeURIComponent(tenant.slug)}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <Card variant="outlined" padded>
        <Stack gap={4}>
          <PageHeader
            title="You are not signed in"
            description="That sign-in did not finish. Links expire after a minute, so this usually just means the tab was left open."
          />

          {signInUrl === null ? (
            // Configuration, not a user error, and named plainly — whoever
            // reads this needs the variable, not an apology.
            <Alert tone="warning" title="Nowhere to send you">
              <code>AUTH_ORIGIN</code> is not set on this deployment.
            </Alert>
          ) : (
            <Button asChild variant="primary">
              <a href={signInUrl}>Sign in</a>
            </Button>
          )}
        </Stack>
      </Card>
    </main>
  );
}
