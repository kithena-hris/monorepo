import { callIdentity } from '../../../../lib/identity';

/**
 * Both halves of enrolling an operator's passkey.
 *
 * Reachable without a session on purpose — an operator has none until this
 * succeeds. What guards it is that the identity service only accepts a
 * challenge it issued for an identity that already has an `invited` row, and
 * rows are written by hand. There is no path here that creates an operator.
 */
export async function POST(request: Request): Promise<Response> {
  const input = (await request.json()) as Record<string, unknown>;
  const step = input['step'] === 'begin' ? 'begin' : 'finish';

  const { status, body } = await callIdentity(`/api/internal/operator/enrol/${step}`, {
    method: 'POST',
    body:
      step === 'begin'
        ? { identityId: input['identityId'], email: input['email'] }
        : {
            response: input['response'],
            challenge: input['challenge'],
            origin: new URL(request.url).origin,
          },
  });

  return Response.json(body ?? {}, { status });
}
