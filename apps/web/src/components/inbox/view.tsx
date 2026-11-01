import 'server-only';
import type { JSX } from 'react';

import { InboxScreen } from './screen';
import { opensScreen, type View } from '../../lib/inbox/model';
import { inboxNow } from '../../lib/inbox/server';
import { taskScreen } from '../../lib/inbox/task-screen';
import { timeOff } from '../../lib/people';
import { signedIn } from '../../lib/signed-in';

/** The Inbox at one view, for this page and for `/inbox` itself (the whole feed). */
export async function InboxView({
  view,
  searchParams: query,
}: {
  readonly view: View;
  readonly searchParams: Record<string, string | string[] | undefined>;
}): Promise<JSX.Element> {
  const one = (k: string): string | null => {
    const v = query[k];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const { entitlements } = await signedIn();
  const [read, viewer] = await Promise.all([
    inboxNow(),
    entitlements.includes('module.timeoff')
      ? timeOff<{ approves: boolean }>('TimeOffViewer')
      : Promise.resolve(null),
  ]);
  // The open item's own screen, when the pane draws one: read now, not after the page arrives.
  const open = read.items.find((i) => i.id === one('item'));
  const screen = open !== undefined && opensScreen(open) ? await taskScreen(open.link) : undefined;
  return (
    <InboxScreen
      read={read}
      view={view}
      item={one('item')}
      source={one('source')}
      q={one('q')}
      outcome={one('outcome')}
      approves={viewer?.ok === true && viewer.data.approves}
      {...(screen === undefined ? {} : { screen })}
    />
  );
}
