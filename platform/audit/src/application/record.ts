import {
  DocumentsActivityRecorded,
  identityEvents,
  OnboardingActivityRecorded,
  peopleEvents,
  PerformanceActivityRecorded,
  RecruitingActivityRecorded,
  TenantAdministratorNamed,
  TenantAdministratorRemoved,
  TimeOffActivityRecorded,
  type DefinedEvent,
} from '@kithena/contracts';

import { entryFrom, kept, moduleOf } from '../domain/entry.js';
import type { EntryStore } from './ports.js';

/**
 * One event off a topic, into the log.
 *
 * Parsed against its contract first: an envelope that does not parse is
 * refused and reported, never thrown, because Kafka would redeliver it forever
 * and stall the partition behind it, and it will be as malformed next time. A
 * database failure does throw, because that one may succeed on retry.
 *
 * Idempotent by the source event's id, so a redelivery, a replay from the
 * beginning or the relay's snapshot changes nothing twice.
 */

export type Recorded = 'recorded' | 'duplicate' | 'ignored' | 'rejected';

const CONTRACTS = new Map<string, DefinedEvent>(
  [
    ...identityEvents,
    ...peopleEvents,
    TimeOffActivityRecorded,
    DocumentsActivityRecorded,
    RecruitingActivityRecorded,
    OnboardingActivityRecorded,
    PerformanceActivityRecorded,
  ].map((e) => [e.name, e]),
);

const ADMINISTRATORS: ReadonlySet<string> = new Set([
  TenantAdministratorNamed.name,
  TenantAdministratorRemoved.name,
]);

export function recordEvent(deps: {
  readonly store: EntryStore;
  readonly onRejected?: (eventName: string, issues: string) => void;
}): (raw: unknown) => Promise<Recorded> {
  return async (raw) => {
    const name: unknown =
      typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'eventName') : undefined;
    if (typeof name !== 'string' || !kept(name)) return 'ignored';
    const contract = CONTRACTS.get(name);
    const parsed = contract?.safeParse(raw);
    if (parsed?.success !== true) {
      deps.onRejected?.(name, parsed?.error.message ?? 'no contract');
      return 'rejected';
    }
    const event = parsed.data as Parameters<typeof entryFrom>[0];
    // Who administers which module: whose module log they may read.
    if (ADMINISTRATORS.has(name)) {
      const p = event.payload as { entitlement: string; accountId: string };
      await deps.store.administrator(event.tenantId, {
        module: moduleOf(p.entitlement),
        accountId: p.accountId,
        named: name === TenantAdministratorNamed.name,
        at: event.occurredAt,
      });
    }
    const entry = entryFrom(event);
    if (entry === null) return 'ignored';
    return (await deps.store.append(entry)) ? 'recorded' : 'duplicate';
  };
}
