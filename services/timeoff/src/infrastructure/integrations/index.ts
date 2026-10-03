import { logger } from '@kithena/telemetry';

import type { Reach } from '../../application/ports.js';
import { googleCalendar } from './google.js';
import { microsoftCalendar } from './microsoft.js';

/**
 * Every calendar and chat adapter, from the environment (TOF-110, TOF-111).
 * An adapter whose credentials are unset is still listed — the integrations
 * page says what it needs — and calls nothing. The credentials a person must
 * create are in `docs/timeoff-build-plan.md` under TOF-110 and TOF-111.
 */
export function reachFrom(env: NodeJS.ProcessEnv): Reach {
  const reach: Reach = {
    calendars: [googleCalendar(env), microsoftCalendar(env)],
    chats: [],
    publicUrl: env['TIMEOFF_PUBLIC_URL'] ?? 'http://localhost:4002',
  };
  const ready = [...reach.calendars, ...reach.chats].filter((p) => p.configured);
  logger.info(
    { module: 'timeoff', integrations: ready.map((p) => p.provider) },
    ready.length === 0
      ? 'no integration credentials; calendars and chat apps stay off'
      : 'integrations',
  );
  return reach;
}
