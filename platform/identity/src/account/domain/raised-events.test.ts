import { describe, expect, it } from 'vitest';
import { fixedClock } from '@kithena/domain-kit';
import { identityEvents, type DefinedEvent } from '@kithena/contracts';

import { Account, type AccountSnapshot, type EventContext } from './account.js';
import type { Session } from './session.js';

/**
 * Everything the aggregate raises, parsed against the registry.
 *
 * The domain builds envelopes as plain objects, so nothing in `account.ts`
 * checks them against the Zod schema they are supposed to satisfy. Without
 * this file a malformed payload travels all the way to the schema registry
 * before anybody finds out, and it arrives there at deploy time rather than at
 * `pnpm test` time.
 *
 * It has already earned its place: `reinstate` reused `account.enrolled` with
 * a null `credentialId`, which is a field the contract requires. That is a
 * modelling error — reinstatement is not enrolment — and it is exactly the
 * kind that survives review because both transitions end with an active
 * account and the code reads fine.
 */

const byName = new Map<string, DefinedEvent>(identityEvents.map((e) => [e.name, e]));

const TENANT = '00000000-0000-4000-8000-000000000001';

function context(iso: string): EventContext {
  let n = 0;
  return {
    clock: fixedClock(iso),
    newEventId: () => {
      n += 1;
      return `01890000-0000-7000-8000-${String(n).padStart(12, '0')}`;
    },
    actor: { kind: 'user', userId: '00000000-0000-4000-8000-0000000000e1' },
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    causationId: null,
  };
}

function snapshot(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    identityId: '00000000-0000-4000-8000-0000000000d1',
    tenantId: TENANT,
    status: 'active',
    employmentStart: '2026-03-01',
    timeZone: 'Europe/Madrid',
    sessions: [],
    sessionLimit: 4,
    ...over,
  };
}

const session = (id: string, slot: number, lastSeen: string): Session => ({
  id,
  slot,
  startedAt: '2026-03-01T00:00:00.000Z',
  lastSeenAt: `${lastSeen}T00:00:00.000Z`,
});

const device = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0', aaguid: null };

/**
 * Drive one transition and hand back what it raised, envelope complete.
 *
 * `recordedAt` is added here because the domain does not set it: a
 * `PendingEvent` is what the aggregate produces and the outbox stamps the
 * recording time as it writes. Parsing without it would fail for a reason that
 * has nothing to do with the payload.
 */
function raisedBy(
  drive: (account: Account, ctx: EventContext) => void,
  at = '2026-04-01T09:00:00.000Z',
  over: Partial<AccountSnapshot> = {},
) {
  const account = Account.rehydrate(snapshot(over));
  const ctx = context(at);
  drive(account, ctx);
  return account.drainEvents().map((e) => ({ ...e, recordedAt: ctx.clock.instant() }));
}

const transitions: readonly [string, () => readonly Record<string, unknown>[]][] = [
  [
    'enrol',
    () =>
      raisedBy(
        (a, c) => void a.enrol('00000000-0000-4000-8000-0000000000f1', c),
        '2026-04-01T09:00:00.000Z',
        { status: 'invited' },
      ),
  ],
  [
    'startSession',
    () =>
      raisedBy(
        (a, c) =>
          void a.startSession(
            { id: '00000000-0000-4000-8000-0000000000b1', device, amr: ['swk', 'user'] },
            c,
          ),
      ),
  ],
  [
    'startSession evicting',
    () =>
      raisedBy(
        (a, c) =>
          void a.startSession(
            { id: '00000000-0000-4000-8000-0000000000b9', device, amr: ['swk'] },
            c,
          ),
        '2026-04-01T09:00:00.000Z',
        {
          sessions: [1, 2, 3, 4].map((n) =>
            session(`00000000-0000-4000-8000-00000000000${String(n)}`, n, `2026-03-0${String(n)}`),
          ),
        },
      ),
  ],
  [
    'revokeSession',
    () =>
      raisedBy(
        (a, c) => void a.revokeSession('00000000-0000-4000-8000-000000000001', 'signed_out', c),
        '2026-04-01T09:00:00.000Z',
        { sessions: [session('00000000-0000-4000-8000-000000000001', 1, '2026-03-01')] },
      ),
  ],
  ['suspend', () => raisedBy((a, c) => void a.suspend('investigation', c))],
  [
    'reinstate',
    () =>
      raisedBy((a, c) => void a.reinstate(c), '2026-04-01T09:00:00.000Z', { status: 'suspended' }),
  ],
  [
    'terminate',
    () =>
      raisedBy((a, c) => void a.terminate('2026-05-31', c), '2026-06-01T09:00:00.000Z', {
        sessions: [session('00000000-0000-4000-8000-000000000001', 1, '2026-03-01')],
      }),
  ],
];

describe('every raised event satisfies its contract', () => {
  it.each(transitions)('%s', (_name, run) => {
    const events = run();
    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      const definition = byName.get(event['eventName'] as string);
      expect(definition, `${String(event['eventName'])} is not in the registry`).toBeDefined();
      if (!definition) continue;

      const parsed = definition.safeParse(event);
      expect(
        parsed.success,
        `${String(event['eventName'])}: ${JSON.stringify(parsed.error?.issues)}`,
      ).toBe(true);
    }
  });
});

describe('the harness itself works', () => {
  it('rejects an envelope whose payload is wrong', () => {
    // A negative control. Without it, a `safeParse` that silently accepted
    // anything would make every assertion above pass for no reason.
    const enrolled = byName.get('identity.account.enrolled');
    expect(enrolled).toBeDefined();

    const [good] = raisedBy(
      (a, c) => void a.enrol('00000000-0000-4000-8000-0000000000f1', c),
      '2026-04-01T09:00:00.000Z',
      { status: 'invited' },
    );
    expect(good).toBeDefined();
    expect(enrolled?.safeParse(good).success).toBe(true);
    expect(enrolled?.safeParse({ ...good, payload: { credentialId: null } }).success).toBe(false);
  });
});
