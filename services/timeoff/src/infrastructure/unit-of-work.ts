import { randomBytes } from 'node:crypto';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { publish, withTenant } from '@kithena/db-kit';
import type { TenantId } from '@kithena/contracts';
import { logger, onShutdown } from '@kithena/telemetry';

import type { Tx, UnitOfWork } from '../application/ports.js';
import { drizzleAttendance, drizzleKiosks } from './drizzle-attendance.js';
import {
  drizzleLeaveTypes,
  drizzleLedger,
  drizzlePolicies,
  drizzleRequests,
} from './drizzle-leave.js';
import { drizzleIdempotency } from './idempotency.js';
import { drizzleLocations, drizzleMembers, drizzleScim } from './drizzle-members.js';
import { drizzleParental } from './drizzle-parental.js';
import {
  drizzleApprovals,
  drizzleFeeds,
  drizzleHolidays,
  drizzleIntegrations,
  drizzleSettings,
} from './drizzle-settings.js';
import { outbox } from './tables.js';

/**
 * One tenant, one transaction, every store (TOF-034).
 *
 * People's `tenantTransaction` for the reason its comment gives at length:
 * `app.tenant_id` lives as long as the transaction that set it, so every
 * store is bound to that transaction rather than to the pool. A store that
 * opened its own connection would see no tenant, and row-level security
 * would answer it with nothing. Events go to `timeoff.outbox` on the same
 * transaction, so a write and what it published commit or roll back together.
 */
export function drizzleUnitOfWork(db: PostgresJsDatabase): UnitOfWork {
  return {
    run: (tenantId, fn) => withTenant(db, tenantId, (tx) => fn(storesIn(tx, tenantId))),
  };
}

/** Every store, bound to a transaction whose tenant is already set. */
function storesIn(tx: PostgresJsDatabase, tenantId: TenantId): Tx {
  return {
    tenantId,
    members: drizzleMembers(tx, tenantId),
    locations: drizzleLocations(tx, tenantId),
    leaveTypes: drizzleLeaveTypes(tx, tenantId),
    policies: drizzlePolicies(tx, tenantId),
    ledger: drizzleLedger(tx, tenantId),
    requests: drizzleRequests(tx, tenantId),
    approvals: drizzleApprovals(tx, tenantId),
    holidays: drizzleHolidays(tx, tenantId),
    attendance: drizzleAttendance(tx, tenantId),
    feeds: drizzleFeeds(tx, tenantId),
    parental: drizzleParental(tx, tenantId),
    kiosks: drizzleKiosks(tx, tenantId),
    integrations: drizzleIntegrations(tx, tenantId),
    scim: drizzleScim(tx, tenantId),
    settings: drizzleSettings(tx, tenantId),
    idempotency: drizzleIdempotency(tx, tenantId),
    outbox: { publish: (events) => publish(tx, outbox, events) },
  };
}

/**
 * Time Off's pool, as `svc_timeoff`, closed on SIGTERM. Null without
 * `TIMEOFF_DATABASE_URL`: the subgraph still serves its schema, and nothing
 * durable runs (People's rule for `PEOPLE_DATABASE_URL`).
 */
export function timeoffDatabase(env: NodeJS.ProcessEnv = process.env): PostgresJsDatabase | null {
  const url = env['TIMEOFF_DATABASE_URL'];
  if (!url) {
    logger.info({ module: 'timeoff' }, 'TIMEOFF_DATABASE_URL unset; no storage');
    return null;
  }
  const client = postgres(url, { max: 10 });
  onShutdown('timeoff database', () => client.end({ timeout: 5 }));
  return drizzle(client);
}

/**
 * UUIDv7 (RFC 9562): 48 bits of milliseconds, then random bits under the
 * version and variant, so the outbox and the ledger sort by time. People's.
 *
 * ponytail: no in-millisecond counter; two ids from one millisecond sort by
 * coin flip, which nothing here orders by yet.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Date.now(), 0, 6);
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
