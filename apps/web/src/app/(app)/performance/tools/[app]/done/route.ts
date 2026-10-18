import { performance } from '../../../../../../lib/people';

/**
 * Where a work tool sends a person back after they approved Kithena reading
 * what they can see there (Performance PRD §22.3), by way of the auth origin.
 *
 * Finished as whoever is signed in here: Performance checks the `state` was
 * issued to this person in this company and has not expired, then records the
 * grant. Then back to My connected tools, saying how it went.
 */

const NAMES: Readonly<Record<string, string>> = { slack: 'Slack', github: 'GitHub' };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ app: string }> },
): Promise<Response> {
  const { app } = await params;
  const url = new URL(request.url);
  const back = new URL('/settings/performance/connected-tools', url);
  const name = NAMES[app];
  if (name === undefined) return new Response(null, { status: 404 });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') !== null || code === null || state === null) {
    back.searchParams.set(
      'notLinked',
      `${name} was not linked. You can try again whenever you like.`,
    );
    return Response.redirect(back, 303);
  }
  const answer = await performance('SetPerformanceGrant', {
    source: app,
    input: { on: true, code, state },
  });
  if (answer.ok) back.searchParams.set('linked', name);
  else back.searchParams.set('notLinked', answer.message);
  return Response.redirect(back, 303);
}
