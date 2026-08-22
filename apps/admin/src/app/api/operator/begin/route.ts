import { callIdentity } from '../../../../lib/identity';

/** Start a sign-in ceremony. The challenge is the identity service's to issue. */
export async function POST(): Promise<Response> {
  const { status, body } = await callIdentity('/api/internal/operator/begin', { method: 'POST' });
  return Response.json(body ?? {}, { status });
}
