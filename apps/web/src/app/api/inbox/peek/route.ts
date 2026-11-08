import { EMPTY_PEEK } from '../../../../lib/inbox/peek';
import { inboxPeek } from '../../../../lib/inbox/server';

/**
 * The bell's Inbox (INB-036), for the shell to ask once the page has arrived:
 * read in the layout, every module's inbox and People's faces were asked
 * beside the page's own reads, on the same small VM, and slowed them.
 * Nobody signed in reads as nobody: an empty peek.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json(await inboxPeek().catch(() => EMPTY_PEEK), {
    headers: { 'cache-control': 'no-store' },
  });
}
