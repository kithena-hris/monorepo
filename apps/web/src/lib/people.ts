import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';

import { CLIENT_NAME, OPERATIONS, type OperationName } from './people-operations';
import { SESSION_COOKIE } from './session-cookie';

/**
 * People, through the Cosmo Router, as the person signed in (PEO-113).
 *
 * The shell holds no way into People but the one every client has: a token.
 * Identity issues this server a five-minute access token for the session the
 * cookie names (`POST /api/internal/session/token`, behind the internal token,
 * never to a browser); the router verifies it against identity's keys and
 * tells People who is asking. So the principal is the router's to build, from
 * a token identity signed — this app neither builds one nor holds People's
 * internal token or its address.
 *
 * Every operation is one of `people-operations.ts`, sent with its hash for the
 * router's persisted-operation safelist. Writes carry a fresh idempotency key
 * per call (PEO-116), so a retried request is answered, not repeated.
 *
 * Fails closed: no session, no tenant, no token or no answer is an
 * `ok: false` with a sentence, never an exception a screen has to catch.
 *
 * `UNREACHABLE` is the one failure the shell acts on: nothing answered at the
 * router's address — a network error, or Cloudflare's own page for a tunnel
 * with nobody behind it (530, error 1033) or an origin that refused (502-504).
 * That is what a VM asleep looks like (`deploy/vm/idle-stop.sh`), and the
 * People pages offer to wake it (`components/workspace-asleep.tsx`). A timeout
 * is not it: something answered, slowly.
 */

export type PeopleAnswer<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

const signedOut = { ok: false, code: 'UNAUTHENTICATED', message: 'Sign in again' } as const;
const unreachable = {
  ok: false,
  code: 'UNREACHABLE',
  message: 'People could not be reached',
} as const;
/** Statuses only a gateway in front of the router gives: the router never answers them. */
const GATEWAY_DOWN = new Set([502, 503, 504, 521, 522, 523, 530]);

/** One token per request: React's `cache` is scoped to the render or the action. */
const accessToken = cache(async (): Promise<string | null> => {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  // Written by `proxy.ts`, which deletes any inbound copy before it writes its own.
  const tenantId = (await headers()).get('x-tenant-id');
  if (sessionId === undefined || sessionId === '' || tenantId === null || tenantId === '') {
    return null;
  }
  try {
    const response = await fetch(
      `${process.env['INTERNAL_API_URL'] ?? ''}/api/internal/session/token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': process.env['INTERNAL_API_TOKEN'] ?? '',
        },
        body: JSON.stringify({ sessionId, tenantId }),
        cache: 'no-store',
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { accessToken?: unknown };
    return typeof body.accessToken === 'string' ? body.accessToken : null;
  } catch {
    return null;
  }
});

const hashes = new Map<OperationName, string>();
const hashOf = (name: OperationName): string => {
  let hash = hashes.get(name);
  if (hash === undefined) {
    hash = createHash('sha256').update(OPERATIONS[name]).digest('hex');
    hashes.set(name, hash);
  }
  return hash;
};

/**
 * Run one of the shell's operations. Always JSON: no file passes through
 * here — an import's goes from the browser straight to storage (PRD §14.2).
 */
export async function people<T>(
  name: OperationName,
  variables: Record<string, unknown> = {},
): Promise<PeopleAnswer<T>> {
  const token = await accessToken();
  if (token === null) return signedOut;
  const router = (process.env['ROUTER_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
  const writes = OPERATIONS[name].trimStart().startsWith('mutation');
  // Every keyed write declares `$key`; the two that only compute do not.
  const keyed = OPERATIONS[name].includes('$key: String!');
  const operation = {
    query: OPERATIONS[name],
    operationName: name,
    variables: keyed ? { ...variables, key: randomUUID() } : variables,
    extensions: { persistedQuery: { version: 1, sha256Hash: hashOf(name) } },
  };
  try {
    const response = await fetch(`${router}/graphql`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'graphql-client-name': CLIENT_NAME,
        'content-type': 'application/json',
      },
      body: JSON.stringify(operation),
      cache: 'no-store',
      signal: AbortSignal.timeout(writes ? 120_000 : 10_000),
    });
    if (response.status === 401) return signedOut;
    if (GATEWAY_DOWN.has(response.status)) return unreachable;
    const answer = (await response.json().catch(() => null)) as {
      data?: Record<string, unknown> | null;
      errors?: { message?: string; extensions?: { code?: unknown } }[];
    } | null;
    const error = answer?.errors?.[0];
    if (error !== undefined || answer?.data === undefined || answer.data === null) {
      const code = error?.extensions?.code;
      return {
        ok: false,
        code: typeof code === 'string' ? code : 'UNAVAILABLE',
        message: error?.message ?? 'People did not answer',
      };
    }
    // Every operation asks for one root field.
    return { ok: true, data: Object.values(answer.data)[0] as T };
  } catch (cause) {
    return cause instanceof Error && cause.name === 'TimeoutError'
      ? { ok: false, code: 'UNAVAILABLE', message: 'People could not be reached' }
      : unreachable;
  }
}
