import { callIdentity } from '../../../../lib/identity';
import { SESSION_COOKIE } from '../../../../lib/session';

/**
 * Finish a sign-in, and turn the result into a cookie.
 *
 * The session id crosses the wire once, server to server, and leaves here as an
 * `HttpOnly` cookie. Nothing in JavaScript ever holds it, so nothing an
 * injection reaches can steal it.
 *
 * This is what the auth origin cannot currently do — Modern.js's BFF is broken
 * on 3.8, so that app proxies and the id reaches the browser. Next has real
 * route handlers, so the back-office does it properly.
 */
export async function POST(request: Request): Promise<Response> {
  const input = (await request.json()) as Record<string, unknown>;

  const { status, body } = await callIdentity('/api/internal/operator/finish', {
    method: 'POST',
    body: {
      response: input['response'],
      challenge: input['challenge'],
      origin: new URL(request.url).origin,
    },
  });

  if (status !== 200 || body === null || typeof body !== 'object') {
    return Response.json({ ok: false }, { status: 401 });
  }

  const { sessionId, expiresAt } = body as Record<string, unknown>;
  if (typeof sessionId !== 'string' || typeof expiresAt !== 'string') {
    return Response.json({ ok: false }, { status: 401 });
  }

  const response = Response.json({ ok: true });
  response.headers.append(
    'set-cookie',
    [
      `${SESSION_COOKIE}=${sessionId}`,
      'Path=/',
      'HttpOnly',
      'Secure',
      // Lax rather than Strict: the back-office is arrived at by following a
      // link from a ticket as often as by typing the address, and Strict would
      // present a signed-in operator with a sign-in page.
      'SameSite=Lax',
      `Expires=${new Date(expiresAt).toUTCString()}`,
    ].join('; '),
  );
  return response;
}
