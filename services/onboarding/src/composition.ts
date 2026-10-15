import type { IncomingMessage, ServerResponse } from 'node:http';
import { createYoga } from 'graphql-yoga';
import { TenantId } from '@kithena/contracts';
import { logger } from '@kithena/telemetry';

import type { Deps, UnitOfWork } from './application/ports.js';
import { yogaOptions } from './graphql/schema.js';
import { callerFromHeaders, withMember, type RecordedEntitlements } from './http/caller.js';
import { onboardingListener, onboardingServer } from './http/server.js';
import { uuidv7 } from './infrastructure/ids.js';
import { mailerFrom } from './infrastructure/messaging.js';
import { drizzleUnitOfWork, onboardingDatabase } from './infrastructure/unit-of-work.js';

/**
 * Onboarding's composition root (ONB-001), Recruiting's shape. With
 * `ONBOARDING_DATABASE_URL`: the unit of work and the router's caller resolved
 * to its member. Without it, `/healthz` and the schema only.
 */

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

export interface Composed {
  readonly listener: Listener;
  readonly storage: { readonly uow: UnitOfWork; readonly deps: Deps } | null;
}

export function composeOnboarding(env: NodeJS.ProcessEnv = process.env): Composed {
  const db = onboardingDatabase(env);
  if (db === null) {
    logger.warn(
      { module: 'onboarding' },
      'ONBOARDING_DATABASE_URL is not set; serving the schema only',
    );
    const yoga = createYoga(yogaOptions);
    return {
      listener: onboardingListener((request, response) => {
        void yoga(request, response);
      }),
      storage: null,
    };
  }
  const uow = drizzleUnitOfWork(db);
  const internalToken = env['ONBOARDING_API_TOKEN'] ?? env['INTERNAL_API_TOKEN'] ?? '';
  const recorded: RecordedEntitlements = async (tenantId) => {
    const kept = (await uow.run(TenantId.parse(tenantId), (tx) =>
      tx.settings.get('entitlements'),
    )) as {
      entitlements: string[];
    } | null;
    return kept?.entitlements ?? null;
  };
  const mailer = mailerFrom(env);
  const { listener, deps } = onboardingServer(
    {
      uow,
      jobsOrigin: env['JOBS_ORIGIN'] ?? 'https://jobs.kithena.com',
      callerFrom: withMember(callerFromHeaders(internalToken, recorded), uow),
      ...(mailer === undefined ? {} : { mailer }),
    },
    uuidv7,
  );
  return { listener, storage: { uow, deps } };
}
