import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';

import { currentPerson } from './session';

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
    const response = await fetch(url, { headers: internal(), cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? Reflect.get(body, 'value') : null;
  } catch {
    return null;
  }
});

/** Replaces the value; false when it did not reach identity. */
export async function writePreference(
  name: string,
  value: Readonly<Record<string, unknown>>,
): Promise<boolean> {
  const url = await preferenceUrl(name);
  if (url === null) return false;
  const response = await fetch(url, {
    method: 'PUT',
    headers: internal(),
    body: JSON.stringify({ value }),
    cache: 'no-store',
  }).catch(() => null);
  return response?.ok === true;
}
