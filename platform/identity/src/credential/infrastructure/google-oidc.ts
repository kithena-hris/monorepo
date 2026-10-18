import { createRemoteJWKSet, jwtVerify } from 'jose';
import { logger } from '@kithena/telemetry';

/**
 * Google's half of the code exchange: the code and the PKCE verifier for an ID
 * token, and the token checked against Google's published keys.
 *
 * The token arrives over a back channel straight from Google, so the signature
 * is not what keeps it honest — TLS already did — but it is checked anyway,
 * with issuer, audience and expiry, because it costs one cached key fetch and
 * a token that has been looked at is easier to reason about than one taken on
 * trust. What the claims must say beyond that is `googleAccount`'s.
 */
const TOKEN = 'https://oauth2.googleapis.com/token';
const KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function googleExchange(config: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}) {
  return async (code: string, verifier: string): Promise<Record<string, unknown> | null> => {
    let idToken: unknown;
    try {
      const response = await fetch(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          code_verifier: verifier,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        // Google's error code, never the body: it can echo the code back.
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        logger.info({ status: response.status, error: body?.error }, 'google exchange refused');
        return null;
      }
      idToken = ((await response.json()) as { id_token?: unknown }).id_token;
    } catch (error) {
      logger.warn({ error }, 'google unreachable');
      return null;
    }
    if (typeof idToken !== 'string') return null;

    try {
      const { payload } = await jwtVerify(idToken, KEYS, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: config.clientId,
      });
      return payload;
    } catch (error) {
      logger.info({ error }, 'google id token refused');
      return null;
    }
  };
}
