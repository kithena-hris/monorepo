import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { CompanyPanel } from '../../components/company-panel';
import { RequestSetupLink } from '../../components/request-setup-link';
import { currentTenant } from '../../lib/branding';

/**
 * A fresh setup link, on the company's own hostname.
 *
 * Server-rendered from the Host header like the sign-in page beside it, so the
 * company's name and mark arrive with the HTML and nobody has to be told which
 * company they are recovering at — the address bar already said.
 */
export default async function Recover(): Promise<JSX.Element> {
  const tenant = await currentTenant();
  // `proxy.ts` 404s an unresolvable hostname before this renders.
  if (tenant === null) redirect('/');

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <CompanyPanel branding={tenant.branding} />

      <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-12">
        <div>
          <h1 className="text-xl font-semibold">Set up a new passkey</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Lost the device, or replaced it? Tell us your work address and we will email you a
            fresh setup link.
          </p>
        </div>

        <RequestSetupLink />
      </main>
    </div>
  );
}
