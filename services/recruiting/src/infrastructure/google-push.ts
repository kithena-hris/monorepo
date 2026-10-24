import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { logger } from '@kithena/telemetry';

/**
 * Pub/Sub's push, proved: every push carries an OIDC token Google signed for
 * Kithena's push service account and this endpoint's address. Checked here
 * against Google's published keys: its signature, issuer, audience, account
 * and expiry. Anything else is somebody else's request.
 */
const CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

type Keys = { readonly keys: readonly (JsonWebKey & { kid?: string })[] };

export function googlePushVerifier(config: {
  readonly audience: string;
  readonly account: string;
  readonly now?: () => number;
  readonly certs?: () => Promise<Keys>;
}): (authorization: string | undefined) => Promise<boolean> {
  const now = config.now ?? Date.now;
  let held: { keys: Keys; until: number } | null = null;
  const certs =
    config.certs ??
    (async (): Promise<Keys> => {
      if (held !== null && held.until > now()) return held.keys;
      const response = await fetch(CERTS, { signal: AbortSignal.timeout(5000) });
      const keys = (await response.json()) as Keys;
      held = { keys, until: now() + 3_600_000 };
      return keys;
    });
  return async (authorization) => {
    const token = /^Bearer (.+)$/u.exec(authorization ?? '')?.[1];
    const [head, body, signature] = token?.split('.') ?? [];
    if (head === undefined || body === undefined || signature === undefined) return false;
    try {
      const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as {
        alg?: string;
        kid?: string;
      };
      if (header.alg !== 'RS256') return false;
      const jwk = (await certs()).keys.find((k) => k.kid === header.kid);
      if (jwk === undefined) return false;
      const signed = verify(
        'RSA-SHA256',
        Buffer.from(`${head}.${body}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      );
      if (!signed) return false;
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
        iss?: string;
        aud?: string;
        email?: string;
        email_verified?: boolean;
        exp?: number;
      };
      return (
        ISSUERS.has(claims.iss ?? '') &&
        claims.aud === config.audience &&
        claims.email === config.account &&
        claims.email_verified === true &&
        typeof claims.exp === 'number' &&
        claims.exp * 1000 > now()
      );
    } catch (error) {
      logger.warn({ module: 'recruiting', err: error }, 'push token unreadable');
      return false;
    }
  };
}

/** The Meet space a Workspace Events push is about, when it says a call ended. */
export function endedSpace(body: string): string | null {
  try {
    const push = JSON.parse(body) as { message?: { attributes?: Record<string, unknown> } };
    const attributes = push.message?.attributes ?? {};
    if (attributes['ce-type'] !== 'google.workspace.meet.conference.v2.ended') return null;
    const subject = attributes['ce-subject'];
    return typeof subject === 'string' && subject.startsWith('//meet.googleapis.com/spaces/')
      ? subject.slice('//meet.googleapis.com/'.length)
      : null;
  } catch {
    return null;
  }
}
