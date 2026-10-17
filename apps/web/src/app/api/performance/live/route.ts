import { performanceLive } from '../../../../lib/people';

/**
 * Performance's cycle stream for the browser (PRD §8.7): the router's
 * server-sent events, relayed as they arrive, as the person signed in. The
 * page was drawn with the current state; a message only moves it on, and the
 * browser's `EventSource` reconnects by itself when a function's time runs out.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const quiet = (): Response =>
  new Response('retry: 30000\nevent: unavailable\ndata: {}\n\n', {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
  });

export async function GET(request: Request): Promise<Response> {
  const cycle = new URL(request.url).searchParams.get('cycle');
  const upstream = await performanceLive(
    cycle === null || !/^[0-9a-f-]{36}$/u.test(cycle) ? null : cycle,
    request.signal,
  );
  if (upstream === null || !upstream.ok || upstream.body === null) return quiet();
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
