import type { Metadata } from 'next';

import { serverWords } from '../../../lib/server-words';
import type { JSX } from 'react';

import { KioskShell } from '../../../components/kiosk-shell';

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverWords();
  return { title: t('app.kiosk.deviceid.page.kiosk', 'Kiosk') };
}

/**
 * A wall kiosk (T25, T26; TOF-108), outside the signed-in app: no sidebar,
 * no session, only the device's own token. `proxy.ts` lets `/kiosk/` through
 * without a session cookie, and still resolves the company from the host.
 */
export default async function Kiosk({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}): Promise<JSX.Element> {
  const { deviceId } = await params;
  return <KioskShell deviceId={deviceId} />;
}
