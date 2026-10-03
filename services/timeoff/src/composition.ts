import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createYoga } from 'graphql-yoga';
import { systemClock } from '@kithena/domain-kit';
import { logger, onShutdown } from '@kithena/telemetry';

import type { UnitOfWork } from './application/ports.js';
import { yogaOptions } from './graphql/schema.js';
import { callerFromHeaders, withMember } from './http/caller.js';
import { timeoffListener, timeoffServer } from './http/server.js';
import { logNotifier } from './infrastructure/background.js';
import {
  nobodyRelates,
  syncingTuples,
  timeoffFgaFrom,
  type MemberTuples,
} from './infrastructure/openfga.js';
import { startEscalation } from './infrastructure/temporal/escalation.js';
import { drizzleUnitOfWork, timeoffDatabase, uuidv7 } from './infrastructure/unit-of-work.js';

/**
 * Time Off's composition root (TOF-050a), called once from `main.ts` and
 * booted whole by `composition.integration.test.ts`.
 *
 * With `TIMEOFF_DATABASE_URL`: the Drizzle unit of work behind REST and the
 * subgraph, the OpenFGA authorizer, the caller resolved to the member it
 * signs in as, the feed secret, and Temporal's escalation clock when
 * `TEMPORAL_ADDRESS` is set. Without it, People's rule: the subgraph serves
 * its schema, every field answers UNAVAILABLE, and nothing durable runs —
 * which is what `just supergraph` introspects.
 *
 * Notices stay `logNotifier`: messaging's notice endpoint wants an address
 * and a template, and Time Off has neither yet.
 */

type Listener = (request: IncomingMessage, response: ServerResponse) => void;

export interface Composed {
  readonly listener: Listener;
  /** What the consumers and the jobs run on; null without a database. */
  readonly storage: {
    readonly db: PostgresJsDatabase;
    readonly uow: UnitOfWork;
    readonly tuples?: MemberTuples;
  } | null;
}

/**
 * `TIMEOFF_FEED_SECRET` signs calendar feed links. Required in production,
 * where a secret that changed on every restart would revoke every link the
 * company had subscribed to; elsewhere a throwaway one, said so.
 */
export function feedSecretFrom(env: NodeJS.ProcessEnv): string {
  const secret = env['TIMEOFF_FEED_SECRET'];
  if (secret) return secret;
  if (env['NODE_ENV'] === 'production') {
    throw new Error('TIMEOFF_FEED_SECRET is required in production');
  }
  logger.warn(
    { module: 'timeoff' },
    'TIMEOFF_FEED_SECRET is not set; calendar feed links last until the next restart',
  );
  return randomBytes(32).toString('base64url');
}

export async function composeTimeOff(env: NodeJS.ProcessEnv = process.env): Promise<Composed> {
  const db = timeoffDatabase(env);
  if (db === null) {
    logger.warn({ module: 'timeoff' }, 'TIMEOFF_DATABASE_URL is not set; serving the schema only');
    const yoga = createYoga(yogaOptions);
    return {
      listener: timeoffListener((request, response) => {
        void yoga(request, response);
      }),
      storage: null,
    };
  }

  // ponytail: `covering` is checked against UTC's date, not the approver's;
  // a delegate's first and last day are a few hours off at the far zones.
  const fga = timeoffFgaFrom(env, () => systemClock.date('UTC'));
  if (fga === null) {
    logger.warn(
      { module: 'timeoff' },
      'OPENFGA_URL is not set; nobody approves or is HR, and members see only their own screens',
    );
  }
  const plain = drizzleUnitOfWork(db);
  const synced = fga === null ? null : syncingTuples(plain, fga);
  const uow = synced?.uow ?? plain;

  // The router's secret for this pair, as People's `PEOPLE_API_TOKEN`; empty refuses everybody.
  const internalToken = env['TIMEOFF_API_TOKEN'] ?? env['INTERNAL_API_TOKEN'] ?? '';
  const timers = await startEscalation(env, { uow, newId: uuidv7, notifier: logNotifier });
  onShutdown('escalation worker', () => timers.close());

  const { listener } = timeoffServer({
    uow,
    authz: fga?.authorizer ?? nobodyRelates,
    feedSecret: feedSecretFrom(env),
    callerFrom: withMember(callerFromHeaders(internalToken), uow),
    timers,
    notifier: logNotifier,
  });
  return {
    listener,
    storage: { db, uow, ...(synced === null ? {} : { tuples: synced.tuples }) },
  };
}
