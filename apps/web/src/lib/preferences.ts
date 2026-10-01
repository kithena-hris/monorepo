import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';

import { cookies } from 'next/headers';

import { currentPerson, SESSION_COOKIE } from './session';
import { timed } from './timing';

/**
 * The signed-in person's own preferences, kept by identity with their account
 * (`/api/internal/tenants/<t>/accounts/<a>/preferences/<name>`) so they follow
 * the person rather than the device.
 *
 * The account is the session's and the tenant the proxy's, never anything a
 * browser sent: a person can only ever read and write their own. Identity
 * stores the value without reading it, so whoever calls `writePreference`
 * validates it first.
 */

async function preferenceUrl(name: string): Promise<string | null> {
  const person = await currentPerson();
  const tenantId = (await headers()).get('x-tenant-id');
  if (person === null || tenantId === null || tenantId === '') return null;
  return `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/tenants/${tenantId}/accounts/${person.accountId}/preferences/${name}`;
}

const internal = (): Record<string, string> => ({
  'content-type': 'application/json',
  'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
});

/** The value, or `null` when never set or when identity cannot be asked: the defaults then apply. */
export const readPreference = cache(async (name: string): Promise<unknown> => {
  const url = await preferenceUrl(name);
  if (url === null) return null;
  try {
    const response = await timed(
      `identity.preference.${name}`,
      fetch(url, { headers: internal(), cache: 'no-store' }),
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? Reflect.get(body, 'value') : null;
  } catch {
    return null;
  }
});

/**
 * Replaces the value: `saved`, `view_only` when identity refused it because an
 * administrator is viewing as this person, or `failed`.
 */
export async function writePreference(
  name: string,
  value: Readonly<Record<string, unknown>>,
): Promise<'saved' | 'view_only' | 'failed'> {
  const url = await preferenceUrl(name);
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (url === null || sessionId === undefined) return 'failed';
  // The session writing, so identity can refuse an administrator viewing as
  // this person: viewing is read-only.
  const response = await fetch(url, {
    method: 'PUT',
    headers: internal(),
    body: JSON.stringify({ value, sessionId }),
    cache: 'no-store',
  }).catch(() => null);
  if (response?.ok === true) return 'saved';
  return response?.status === 403 ? 'view_only' : 'failed';
}
