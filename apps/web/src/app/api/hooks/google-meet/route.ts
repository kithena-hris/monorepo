import { after } from 'next/server';

import { wakingStatus } from '../../../../lib/waking';
import { wakeWorkspace, workspaceConfig } from '../../../../lib/workspace';

/**
 * Pub/Sub's push of Google Meet's events (a call ended), on the one address
 * that is always up: passed to Recruiting's public hook through the tunnel,
 * with Google's token, which Recruiting checks. While the VM sleeps the answer
 * is 503 and the VM is asked to start, so Pub/Sub sends it again shortly.
 */
const HOOK = '/v1/recruiting/public/hooks/google-meet';

export async function POST(request: Request): Promise<Response> {
  const base = (process.env['RECRUITING_PUBLIC_URL'] ?? process.env['ROUTER_URL'] ?? '').replace(
    /\/$/u,
    '',
  );
  if (base === '') return new Response(null, { status: 503 });
  const answer = await fetch(`${base}${HOOK}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: request.headers.get('authorization') ?? '',
    },
    body: await request.text(),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (answer === null || wakingStatus(answer.status)) {
    const config = workspaceConfig();
    if (config !== null)
      after(() =>
        wakeWorkspace(config).catch((cause: unknown) => {
          console.error('workspace: AWS call failed', cause);
        }),
      );
    return new Response(null, { status: 503 });
  }
  return new Response(null, { status: answer.status });
}
