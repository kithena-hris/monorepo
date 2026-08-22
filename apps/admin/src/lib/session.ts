import 'server-only';
import { cookies } from 'next/headers';

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

export async function currentOperator(): Promise<OperatorIdentity | null> {
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
}
