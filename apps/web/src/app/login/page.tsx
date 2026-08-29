import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { CompanyPanel } from '../../components/company-panel';
import { PasskeySignIn } from '../../components/passkey-sign-in';
import { currentTenant } from '../../lib/branding';
import { currentPerson } from '../../lib/session';

/**
 * The company's own sign-in page, on the company's own hostname.
 *
 * Server-rendered, and that is the difference from a central page: the tenant is
 * in the Host header, so the branding arrives with the HTML rather than after
 * it and there is no unbranded first paint to explain. Nobody has to know a URL
 * beyond their own company's, and nothing here is generic — there is no page at
 * this address that does not already belong to somebody.
 *
 * The theme is applied by the root layout, which puts the company's brand ramp
 * on `<html>` — the only element `brandRamp` works from.
 */
export default async function Login(): Promise<JSX.Element> {
  const tenant = await currentTenant();
  // `proxy.ts` 404s an unresolvable hostname before anything renders, so this
  // is only reachable when a tenant exists.
  if (tenant === null) redirect('/');

  // Somebody already signed in has no business here, and leaving them on it
  // invites a second prompt that replaces a working session.
  if ((await currentPerson()) !== null) redirect('/');

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CompanyPanel branding={tenant.branding} />

      <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Use the passkey on this device. There is no password to remember.
          </p>
        </div>

        <PasskeySignIn />
      </main>
    </div>
  );
}
