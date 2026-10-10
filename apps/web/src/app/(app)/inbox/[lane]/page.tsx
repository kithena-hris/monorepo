import type { JSX } from 'react';
import { notFound } from 'next/navigation';

import { InboxScreen } from '../../../../components/inbox/screen';
import { LANES, type LaneName } from '../../../../lib/inbox/model';
import { inboxNow } from '../../../../lib/inbox/server';
import { timeOff } from '../../../../lib/people';
import { signedIn } from '../../../../lib/signed-in';

/**
 * One lane of the Inbox (INB-030), drawn on the server with the open item, so
 * the first paint is the list and the item, never a skeleton.
 */
export default async function InboxLane({
  params,
  searchParams,
}: {
  params: Promise<{ lane: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { lane } = await params;
  if (!LANES.includes(lane as LaneName)) notFound();
  const query = await searchParams;
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
  return (
    <InboxScreen
      read={read}
      lane={lane as LaneName}
      item={one('item')}
      source={one('source')}
      q={one('q')}
      outcome={one('outcome')}
      approves={viewer?.ok === true && viewer.data.approves}
    />
  );
}
