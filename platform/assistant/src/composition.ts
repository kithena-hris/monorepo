import type { AssistantChannel } from '@kithena/contracts';
import { systemClock, type Clock } from '@kithena/domain-kit';
import type { Logger } from '@kithena/telemetry';

import { asker } from './application/ask.js';
import { route, type Reply, type Request } from './http/server.js';
import { identityFrom } from './infrastructure/identity.js';
import { modulesFrom } from './infrastructure/modules.js';
import { plannerFrom } from './infrastructure/planner.js';

/**
 * The assistant, wired from its settings (assistant PRD §15.3).
 *
 * Nothing is required to start. A channel is let in by its own token
 * (`SLACK_ASSISTANT_TOKEN`, `TEAMS_ASSISTANT_TOKEN`); with none, every caller
 * is refused. With no model (`ASSISTANT_API_KEY`) every question is "The
 * assistant isn't available right now." — the same as People today without
 * a key — so deploying it before its settings exist is safe. Identity is
 * `IDENTITY_URL` and `ASSISTANT_IDENTITY_TOKEN`; each module is `<MODULE>_URL`
 * and `ASSISTANT_<MODULE>_TOKEN`; `TENANT_APP_BASE` (`https://{slug}.app.kithena.com`)
 * makes the links; `ASSISTANT_PLANS_PER_HOUR` is a company's hourly budget.
 */

/** The settings the service reads. All optional; absent means "not set up here". */
export type Settings = Readonly<Record<string, string | undefined>>;

export type { Reply, Request };

/** What a test swaps for a fake: the network, the log, the clock. */
export interface Wiring {
  readonly fetch?: typeof fetch;
  readonly logger?: Logger;
  readonly clock?: Clock;
}

const CHANNELS: readonly [string, AssistantChannel][] = [
  ['SLACK_ASSISTANT_TOKEN', 'slack'],
  ['TEAMS_ASSISTANT_TOKEN', 'teams'],
];

export function compose(
  settings: Settings,
  wiring: Wiring = {},
): (request: Request) => Promise<Reply> {
  const options = {
    ...(wiring.fetch === undefined ? {} : { fetch: wiring.fetch }),
    ...(wiring.logger === undefined ? {} : { logger: wiring.logger }),
  };
  const base = settings['TENANT_APP_BASE'];
  const perHour = Number(settings['ASSISTANT_PLANS_PER_HOUR']);
  const ask = asker({
    identity: identityFrom(settings, options),
    modules: modulesFrom(settings, options),
    planner: plannerFrom(settings, options),
    clock: wiring.clock ?? systemClock,
    ...(Number.isInteger(perHour) && perHour > 0 ? { plansPerHour: perHour } : {}),
    ...(base
      ? { originOf: (slug: string) => base.replace('{slug}', slug).replace(/\/$/u, '') }
      : {}),
  });
  return route({
    callers: CHANNELS.flatMap(([name, channel]) => {
      const token = settings[name];
      return token ? [{ token, channel }] : [];
    }),
    ask,
    ...(wiring.logger === undefined ? {} : { logger: wiring.logger }),
  });
}
