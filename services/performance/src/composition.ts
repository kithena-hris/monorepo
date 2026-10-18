import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { Deps, UnitOfWork } from './application/ports.js';
import { yogaOptions } from './graphql/schema.js';
import { callerFromHeaders, withMember, type RecordedEntitlements } from './http/caller.js';
import { performanceListener, performanceServer } from './http/server.js';
import { uuidv7 } from './infrastructure/ids.js';
import { inProcessLive } from './infrastructure/live.js';
import { mailerFrom } from './infrastructure/messaging.js';
import { modelFrom } from './infrastructure/model.js';
import { drizzleUnitOfWork, performanceDatabase } from './infrastructure/unit-of-work.js';
import { webhooksFrom } from './infrastructure/webhooks.js';
import { chatFrom } from './infrastructure/chat.js';
import { toolsFrom } from './infrastructure/tools.js';

/**
 * Performance's composition root (PRF-004), Onboarding's shape. With
 * `PERFORMANCE_DATABASE_URL`: the unit of work, the router's caller resolved
 * to its member, the live stream, mail and the model. Without it,
 * `/healthz` and the schema only.
 */

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

export interface Composed {
  readonly listener: Listener;
  readonly storage: { readonly uow: UnitOfWork; readonly deps: Deps } | null;
}

export function composePerformance(env: NodeJS.ProcessEnv = process.env): Composed {
  const db = performanceDatabase(env);
  if (db === null) {
    logger.warn(
      { module: 'performance' },
      'PERFORMANCE_DATABASE_URL is not set; serving the schema only',
    );
    const yoga = createYoga(yogaOptions);
    return {
      listener: performanceListener((request, response) => {
        void yoga(request, response);
      }),
      storage: null,
    };
  }
  const uow = drizzleUnitOfWork(db);
  const internalToken = env['PERFORMANCE_API_TOKEN'] ?? env['INTERNAL_API_TOKEN'] ?? '';
  const recorded: RecordedEntitlements = async (tenantId) => {
    const kept = (await uow.run(TenantId.parse(tenantId), (tx) =>
      tx.settings.get('entitlements'),
    )) as { entitlements: string[] } | null;
    return kept?.entitlements ?? null;
  };
  const mailer = mailerFrom(env);
  const model = modelFrom(env);
  const webhooks = webhooksFrom(env);
  const chat = chatFrom(env);
  const tools = toolsFrom(env);
  if (webhooks === undefined)
    logger.info({ module: 'performance' }, 'PERFORMANCE_WEBHOOK_KEY unset; no webhooks');
  const { listener, deps } = performanceServer(
    {
      uow,
      live: inProcessLive(),
      callerFrom: withMember(callerFromHeaders(internalToken, recorded), uow),
      ...(mailer === undefined ? {} : { mailer }),
      ...(model === undefined ? {} : { model }),
      ...(webhooks === undefined ? {} : { webhooks }),
      ...(chat === undefined ? {} : { chat }),
      tools,
      chatToken: env['SLACK_PERFORMANCE_TOKEN'] ?? '',
      // The assistant's secret for its pair (assistant PRD §15.3); empty refuses it.
      assistantCallerFrom: withMember(
        callerFromHeaders(env['ASSISTANT_PERFORMANCE_TOKEN'] ?? '', recorded),
        uow,
      ),
    },
    uuidv7,
  );
  return { listener, storage: { uow, deps } };
}
