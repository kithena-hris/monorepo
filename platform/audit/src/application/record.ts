import { identityEvents, peopleEvents, type DefinedEvent } from '@kithena/contracts';

import { entryFrom, kept } from '../domain/entry.js';
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
  [...identityEvents, ...peopleEvents].map((e) => [e.name, e]),
);

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
    const entry = entryFrom(parsed.data as Parameters<typeof entryFrom>[0]);
    if (entry === null) return 'ignored';
    return (await deps.store.append(entry)) ? 'recorded' : 'duplicate';
  };
}
