import { people } from '../../../../../../lib/people';

/**
 * Where a chat app (Slack today) sends the administrator back after they
 * approved the connection there, by way of the auth origin.
 *
 * Finished as whoever is signed in here: People checks they administer People,
 * and the chat service checks the `state` was issued for this company and has
 * not expired. Then back to Integrations › Slack, saying how it went.
 */

const NAMES: Readonly<Record<string, string>> = { slack: 'Slack' };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ app: string }> },
): Promise<Response> {
  const { app } = await params;
  const url = new URL(request.url);
  const back = new URL('/settings/people/integrations/slack', url);
  const name = NAMES[app];
  if (name === undefined) return new Response(null, { status: 404 });

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (url.searchParams.get('error') !== null || code === null || state === null) {
    // Cancelled on the chat app's side: nothing to say but that.
    back.searchParams.set(
      'notConnected',
      `${name} was not connected. You can try again whenever you like.`,
    );
    return Response.redirect(back, 303);
  }
  const answer = await people('CompleteChatApp', { app, code, state });
  if (answer.ok) back.searchParams.set('connected', name);
  else back.searchParams.set('notConnected', answer.message);
  return Response.redirect(back, 303);
}
