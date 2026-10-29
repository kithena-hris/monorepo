import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentTenant } from './branding';
import { accessToken } from './people';
import { readPreference } from './preferences';
import { currentPerson, displayName } from './session';
import { shellData, type ShellData } from './shell';
import { prefsFrom } from './shortcut-prefs';
import type { ShortcutPrefs } from './shortcuts';
import { RETURN_COOKIE } from './session-cookie';

/**
 * Who is signed in, as the shell draws them, and the shell's People data: the
 * boilerplate every page inside the shell starts with. Sends anybody signed
 * out to their company's sign-in page.
 */
export async function signedIn(): Promise<{
  readonly person: {
    readonly name: string;
    readonly email: string | null;
    /** An administrator viewing the app as this person, read-only: who. Null otherwise. */
    readonly viewing: { readonly by: string | null } | null;
  };
  readonly entitlements: readonly string[];
  readonly company: string;
  readonly logoUrl: string | null;
  readonly shell: ShellData;
  /** Their keyboard shortcuts, as they last saved them; the defaults otherwise. */
  readonly shortcuts: ShortcutPrefs;
}> {
  // Started with the session check rather than after it: none of them waits
  // on who is signed in, and each is thrown away if nobody is.
  const tenant = currentTenant();
  const shortcuts = readPreference('shortcuts');
  const [person] = await Promise.all([currentPerson(), accessToken()]);
  // A view as somebody that is over — its thirty minutes, or ended elsewhere —
  // goes back to the administrator's own session, not to the employee's.
  if (person === null) {
    redirect((await cookies()).has(RETURN_COOKIE) ? '/auth/view-as/end' : '/login');
  }
  const [company, shell, saved] = await Promise.all([
    tenant,
    shellData(person.entitlements),
    shortcuts,
  ]);
  return {
    person: {
      name:
        person.name === null
          ? displayName(person.workEmail)
          : `${person.name.given} ${person.name.family}`,
      email: person.workEmail,
      viewing: person.viewing === null ? null : { by: person.viewing.adminName },
    },
    entitlements: person.entitlements,
    company: company?.branding.displayName ?? company?.slug ?? 'your company',
    logoUrl: company?.branding.logoUrl ?? null,
    shell,
    shortcuts: prefsFrom(saved),
  };
}
