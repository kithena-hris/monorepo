import { Button } from '@reach/ui';
import type { JSX } from 'react';

import type { AppSignIn } from '../lib/app-sign-in';
import { t } from '../lib/t';

/**
 * Signing in with Google, for a company that has switched it on.
 *
 * A link, not a form: the trip starts on the auth origin, because Google
 * allows one registered callback and no wildcards (`docs/authentication.md`,
 * "Why Google forces a central callback"), and ends back here at
 * `/auth/callback`. The phone app's sign-in travels with it.
 *
 * The mark is Google's, drawn as its branding asks for a sign-in button, and
 * lives here rather than in Reach: it names a vendor, and Reach does not.
 */
export function GoogleSignIn({
  slug,
  app = null,
}: {
  slug: string;
  app?: AppSignIn | null;
}): JSX.Element | null {
  const origin = process.env['AUTH_ORIGIN'] ?? '';
  if (origin === '') return null;
  const start = new URL('/google/start', origin);
  start.searchParams.set('tenant', slug);
  if (app !== null) {
    start.searchParams.set('app', app.redirect);
    start.searchParams.set('challenge', app.challenge);
  }
  return (
    <Button asChild fullWidth startIcon={<GoogleMark />}>
      <a href={start.toString()}>
        {t('components.google-sign-in.sign_in_with_google', 'Sign in with Google')}
      </a>
    </Button>
  );
}

function GoogleMark(): JSX.Element {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-4">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
