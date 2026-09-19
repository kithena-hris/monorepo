import 'server-only';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { callIdentity } from './identity';

/**
 * Who is using the back-office, if anybody.
 *
 * The cookie is `__Host-` prefixed, which forbids a `Domain` attribute and so
 * makes it host-only: it belongs to `admin.kithena.com` and cannot be sent
 * anywhere else, in either direction. It holds an opaque id and nothing else.
 *
 * **Fail closed, and loudly.** This surface is the only one that crosses
 * tenants, and it is served from a plan that offers no deployment protection —
 * so nothing between the internet and this function is stopping anybody. If the
 * identity service cannot be reached, the answer is "not signed in", never "let
 * them through while we work it out".
 */
export const SESSION_COOKIE = '__Host-kithena_operator';

export interface OperatorIdentity {
  readonly operatorId: string;
  readonly email: string;
}

/*
 * Memoised for the length of one render.
 *
 * Every page checks this, and a page that also renders a server action checks
 * it again inside the action — correctly, because an action is a POST endpoint
 * in its own right. Without `cache` that is two round trips to identity for one
 * screen, and identity is a separate deployment: each one is a function
 * invocation, a pooled connection and a query. `cache` dedupes within a single
 * render and does not persist across requests, so nothing is remembered between
 * one operator and the next.
 */
export const currentOperator = cache(async (): Promise<OperatorIdentity | null> => {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sessionId === undefined || sessionId === '') return null;

  try {
    const { status, body } = await callIdentity('/api/internal/operator/session', {
      method: 'POST',
      body: { sessionId },
    });
    if (status !== 200 || body === null || typeof body !== 'object') return null;

    const { operatorId, email } = body as Record<string, unknown>;
    return typeof operatorId === 'string' && typeof email === 'string'
      ? { operatorId, email }
      : null;
  } catch {
    return null;
  }
});
