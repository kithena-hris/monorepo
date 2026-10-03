import { describe, expect, it } from 'vitest';
import { LedgerEntry, PersonId } from '@kithena/contracts';

import { live } from '../shared.js';
import { MemberFields } from '../ports.js';
import { d, TENANT, world } from '../testing/world.js';
import { endMember, upsertMember } from './sync.js';

const NEW = PersonId.parse('00000000-0000-7000-8000-000000000099');
const fields = (over: Record<string, unknown> = {}) =>
  MemberFields.parse({
    personId: NEW,
    displayName: 'Ines Garcia',
    firstName: 'Ines',
    teamKey: 'platform',
    locationKey: 'madrid',
    country: 'ES',
    timeZone: 'Europe/Madrid',
    hireDate: '2026-07-01',
    ...over,
  });
const applied = (eventId: string | null, effectiveFrom: string | null = null) => ({
  eventId,
  effectiveFrom: effectiveFrom === null ? null : d(effectiveFrom),
  correlationId: '00000000-0000-4000-8000-0000000000c1',
});

describe('member sync (TOF-035)', () => {
  it('a hire produces a member and a grant entry, pro rata', async () => {
    const app = world();
    const result = await upsertMember(app.deps)(TENANT, fields(), applied('e1', '2026-07-01'));
    expect(result.ok && result.value.created).toBe(true);

    const s = app.state(TENANT);
    expect(s.members.get(NEW)?.displayName).toBe('Ines Garcia');
    const grants = s.ledger.filter((e) => e.personId === NEW);
    expect(grants.map((e) => [e.kind, e.amount, e.effectiveOn])).toEqual([
      ['grant', '12.500', '2026-07-01'],
    ]);
  });

  it('applies the same event once, and ignores an older one', async () => {
    const app = world();
    const upsert = upsertMember(app.deps);
    await upsert(TENANT, fields(), applied('e1', '2026-07-01'));
    const again = await upsert(TENANT, fields(), applied('e1', '2026-07-01'));
    expect(again.ok && again.value.applied).toBe(false);

    await upsert(TENANT, fields({ displayName: 'Ines G.' }), applied('e2', '2026-08-01'));
    const older = await upsert(TENANT, fields({ displayName: 'Old' }), applied('e3', '2026-07-15'));
    expect(older.ok && older.value.applied).toBe(false);

    const s = app.state(TENANT);
    expect(s.members.get(NEW)?.displayName).toBe('Ines G.');
    expect(s.ledger.filter((e) => e.personId === NEW)).toHaveLength(1);
  });

  it('termination re-folds pro rata and deducts a negative balance from final pay', async () => {
    const app = world('2026-07-01T08:00:00.000Z');
    await upsertMember(app.deps)(TENANT, fields({ hireDate: '2026-01-01' }), applied('e1'));
    const s = app.state(TENANT);
    s.ledger.push(
      LedgerEntry.parse({
        entryId: '0189eeee-0000-7000-8000-000000000001',
        personId: NEW,
        leaveTypeKey: 'vacation',
        kind: 'taken',
        amount: '-20.000',
        unit: 'day',
        effectiveOn: '2026-06-20',
        occurredAt: '2026-06-20T08:00:00.000Z',
        policyVersion: null,
        supersedes: null,
        requestId: null,
        reason: null,
      }),
    );

    const ended = await endMember(app.deps)(TENANT, NEW, d('2026-06-30'), applied('e2'));
    expect(ended.ok && ended.value.settled).toEqual([
      { leaveTypeKey: 'vacation', days: '7.500', outcome: 'final_pay' },
    ]);
    const mine = live(s.ledger.filter((e) => e.personId === NEW));
    expect(mine.map((e) => [e.kind, e.amount])).toEqual([
      ['taken', '-20.000'],
      ['grant', '12.500'],
      ['adjustment', '7.500'],
    ]);
    expect(s.members.get(NEW)?.status).toBe('left');
    expect(s.events.map((e) => e.eventName)).toContain('timeoff.balance.adjusted');
  });
});
