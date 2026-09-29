import 'server-only';

import { redirect } from 'next/navigation';

import { currentTenant } from './branding';
import { currentPerson, displayName } from './session';
import { shellData, type ShellData } from './shell';

/**
 * Who is signed in, as the shell draws them, and the shell's People data: the
 * boilerplate every page inside the shell starts with. Sends anybody signed
 * out to their company's sign-in page.
 */
export async function signedIn(): Promise<{
  readonly person: { readonly name: string; readonly email: string | null };
  readonly entitlements: readonly string[];
  readonly company: string;
  readonly logoUrl: string | null;
  readonly shell: ShellData;
}> {
  const person = await currentPerson();
  if (person === null) redirect('/login');
  const [tenant, shell] = await Promise.all([currentTenant(), shellData(person.entitlements)]);
  return {
    person: {
      name:
        person.name === null
          ? displayName(person.workEmail)
          : `${person.name.given} ${person.name.family}`,
      email: person.workEmail,
    },
    entitlements: person.entitlements,
    company: tenant?.branding.displayName ?? tenant?.slug ?? 'your company',
    logoUrl: tenant?.branding.logoUrl ?? null,
    shell,
  };
}
