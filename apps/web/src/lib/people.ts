import 'server-only';
import { randomUUID } from 'node:crypto';
import { headers } from 'next/headers';

import { currentPerson } from './session';

/**
 * People's transports, called from this server as the person signed in (PEO-098).
 *
 * The shell is one of two things People trusts to say who is asking — the
 * Cosmo Router is the other (PEO-092). It proves it the same way the router
 * does: the internal token beside a principal it built itself, from the
 * session `currentPerson()` verified against identity on this request and the
 * tenant `proxy.ts` resolved from the host. Nothing a browser sends reaches
 * the principal. Roles are not claimed here: People reads them from OpenFGA.
 *
 * Why not through the router: the router verifies a token identity mints, and
 * nothing mints one for the tenant app yet. When something does, this file is
 * the one that changes — the screens and the actions above it do not.
 *
 * Fails closed: no session, no tenant or no answer is an `ok: false` with a
 * sentence, never an exception a screen has to catch.
 */

export type PeopleAnswer<T> =
  | { readonly ok: true; readonly status: number; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly message: string;
    };

export async function people<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<PeopleAnswer<T>> {
  const person = await currentPerson();
  const tenantId = (await headers()).get('x-tenant-id');
  if (person === null || tenantId === null || tenantId === '') {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: 'Sign in again' };
  }
  const base = (process.env['PEOPLE_API_URL'] ?? 'http://localhost:4001').replace(/\/$/, '');
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-internal-token':
          process.env['PEOPLE_API_TOKEN'] ?? process.env['INTERNAL_API_TOKEN'] ?? '',
        'x-kithena-principal': JSON.stringify({
          userId: person.accountId,
          tenantId,
          roles: [],
          // The company's modules as identity answered on this request
          // (PEO-114); People prefers its own recorded copy when it has one.
          entitlements: person.entitlements,
        }),
        'x-correlation-id': randomUUID(),
        // Every People write is keyed (PEO-116); one key per action, so a
        // retried request is answered rather than repeated.
        ...(method === 'GET' ? {} : { 'idempotency-key': randomUUID() }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store',
      signal: AbortSignal.timeout(method === 'GET' ? 10_000 : 120_000),
    });
    const parsed: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, data: parsed as T };
    const error =
      parsed !== null && typeof parsed === 'object' && 'error' in parsed
        ? (parsed.error as { code?: unknown; message?: unknown })
        : {};
    return {
      ok: false,
      status: response.status,
      code: typeof error.code === 'string' ? error.code : 'UNAVAILABLE',
      message: typeof error.message === 'string' ? error.message : 'People did not answer',
    };
  } catch {
    return { ok: false, status: 503, code: 'UNAVAILABLE', message: 'People could not be reached' };
  }
}
