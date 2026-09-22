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
      {/*
        The company's colour across the top edge, above both halves.

        The one piece of brand that shows even for a company that asked not to
        be named: `brandingFor` withholds the mark and the name from a public
        sign-in page but keeps `themeId`, because an accent identifies nobody —
        six presets across every customer — and withholding it would drop their
        own staff back to the default hue for no privacy gained.

        Fixed rather than in the flow, so it survives the panel stacking above
        the form on a narrow screen instead of ending up halfway down the page.
      */}
      <div aria-hidden className="bg-accent-solid fixed inset-x-0 top-0 z-10 h-[3px]" />

      <CompanyPanel branding={tenant.branding} />

      <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div>
          {/*
            Whose page this is, said in their colour, above the instruction.

            The panel beside this one carries the name and the mark — and
            renders nothing at all for a company that asked not to be named, at
            which point "Sign in" alone is the whole heading. This line is what
            keeps the form side branded in the common case without repeating
            the mark at a second size.
          */}
          {tenant.branding.displayName === null ? null : (
            <p className="text-accent-fg text-xs font-semibold tracking-[0.16em] uppercase">
              {tenant.branding.displayName}
            </p>
          )}
          <h1 className="mt-1 text-xl font-semibold">Sign in</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Use the passkey on this device. There is no password to remember.
          </p>
        </div>

        <PasskeySignIn />
      </main>
    </div>
  );
}
