import 'server-only';
import { cookies, headers } from 'next/headers';

/**
 * Who is signed in at this company, if anybody.
 *
 * `__Host-` prefixed, which forces `Secure` and `Path=/` and — the part that
 * matters — **forbids a `Domain` attribute**. The cookie belongs to
 * `acme.app.kithena.com` and the browser will not send it anywhere else, which
 * is what stops `evil.app.kithena.com` from receiving it.
 * `docs/authentication.md` states the rule; this is the half that reads it.
 *
 * **Fail closed.** If identity cannot be reached the answer is "not signed in",
 * never "let them through while we work it out".
 */
export const SESSION_COOKIE = '__Host-ksession';

export interface SignedIn {
  readonly accountId: string;
  readonly identityId: string;
  /** The address the account signs in under. There is no name yet — see below. */
  readonly workEmail: string | null;
  readonly amr: readonly string[];
}

export async function currentPerson(): Promise<SignedIn | null> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sessionId === undefined || sessionId === '') return null;

  // Written by `proxy.ts`, which deletes any inbound copy before it writes its
  // own. A client that could set this header could read another company's data.
  const tenantId = (await headers()).get('x-tenant-id');
  if (tenantId === null || tenantId === '') return null;

  try {
    const response = await fetch(`${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
      },
      // The tenant travels with the request. Identity refuses a session that
      // belongs to a different one rather than trusting what the cookie says.
      body: JSON.stringify({ sessionId, tenantId }),
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object') return null;

    const read = (key: string): string | null => {
      const value: unknown = Reflect.get(body, key);
      return typeof value === 'string' ? value : null;
    };
    const accountId = read('accountId');
    const identityId = read('identityId');
    if (accountId === null || identityId === null) return null;

    const amr: unknown = Reflect.get(body, 'amr');
    return {
      accountId,
      identityId,
      workEmail: read('workEmail'),
      amr: Array.isArray(amr) ? amr.filter((a): a is string => typeof a === 'string') : [],
    };
  } catch {
    return null;
  }
}

/**
 * What to call somebody, from the only thing identity holds about them.
 *
 * Identity stores a work email and deliberately nothing else — names, and
 * everything else about a person, live in the People module on the other side
 * of a boundary. So this derives a display name from the local part until there
 * is a People record to ask, and it is the one place that guess is made.
 *
 * `ada.lovelace@acme.example` becomes `Ada Lovelace`. A local part that is not
 * a name — `payroll+test`, `a.b.c.d` — comes back looking odd, which is the
 * correct outcome: the fix is a real name, not a cleverer guess.
 */
export function displayName(workEmail: string | null): string {
  const local = workEmail?.split('@')[0];
  if (local === undefined || local === '') return 'there';

  const words = local
    .split(/[._-]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  return words.length === 0 ? 'there' : words.join(' ');
}
