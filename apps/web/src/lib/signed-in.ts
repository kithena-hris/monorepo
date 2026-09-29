import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { currentTenant } from './branding';
import { readPreference } from './preferences';
import { currentPerson, displayName } from './session';
import { shellData, type ShellData } from './shell';
import { prefsFrom, type ShortcutPrefs } from './shortcuts';
import { SIDEBAR_COOKIE, sidebarCollapsedFrom } from './sidebar';
import { RETURN_COOKIE } from './session-cookie';

/**
 * Whether this device keeps the sidebar collapsed, from its cookie, for the
 * shell's first render; `undefined` when it has never said.
 */
export async function sidebarCollapsed(): Promise<boolean | undefined> {
  return sidebarCollapsedFrom((await cookies()).get(SIDEBAR_COOKIE)?.value);
}

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
  readonly sidebarCollapsed: boolean | undefined;
  /** Their keyboard shortcuts, as they last saved them; the defaults otherwise. */
  readonly shortcuts: ShortcutPrefs;
}> {
  const person = await currentPerson();
  // A view as somebody that is over — its thirty minutes, or ended elsewhere —
  // goes back to the administrator's own session, not to the employee's.
  if (person === null) {
    redirect((await cookies()).has(RETURN_COOKIE) ? '/auth/view-as/end' : '/login');
  }
  const [tenant, shell, collapsed, shortcuts] = await Promise.all([
    currentTenant(),
    shellData(person.entitlements),
    sidebarCollapsed(),
    readPreference('shortcuts'),
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
    company: tenant?.branding.displayName ?? tenant?.slug ?? 'your company',
    logoUrl: tenant?.branding.logoUrl ?? null,
    shell,
    sidebarCollapsed: collapsed,
    shortcuts: prefsFrom(shortcuts),
  };
}
