import { describe, expect, it } from 'vitest';

import { allocateSlot, overLimitSessions, type Session } from './session.js';

/**
 * The four-device rule, as arithmetic.
 *
 * This is the half of the invariant that lives in code. The other half is
 * `UNIQUE (account_id, slot)`, and the two exist together on purpose: this one
 * decides *which* slot and reports what was evicted, the index makes a fifth
 * row impossible even if two logins race past this function simultaneously.
 * Neither is sufficient alone.
 */

const at = (iso: string): string => `${iso}T00:00:00.000Z`;

const session = (id: string, slot: number, lastSeen: string): Session => ({
  id,
  slot,
  startedAt: at('2026-01-01'),
  lastSeenAt: at(lastSeen),
  amr: ['swk'],
  device: { ip: '203.0.113.7', userAgent: 'test', aaguid: null },
});

describe('allocateSlot', () => {
  it('takes slot 1 when nothing is running', () => {
    const result = allocateSlot([], 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ slot: 1, evicted: null });
  });

  it('takes the lowest free slot, not the next number', () => {
    // A slot is a slot, not a counter. Sessions 1 and 3 running means the new
    // one is 2 — if this incremented instead, slots would climb past the limit
    // and the unique index would start rejecting valid logins.
    const result = allocateSlot([session('a', 1, '2026-03-01'), session('c', 3, '2026-03-01')], 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ slot: 2, evicted: null });
  });

  it('fills every slot before evicting anything', () => {
    const three = [
      session('a', 1, '2026-03-01'),
      session('b', 2, '2026-03-02'),
      session('c', 3, '2026-03-03'),
    ];
    const result = allocateSlot(three, 4);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slot).toBe(4);
    expect(result.value.evicted).toBeNull();
  });

  it('evicts the least recently used when full, and takes its slot', () => {
    // Least recently *seen*, not first started. The laptop someone logged into
    // in January and has used every day since must outlive the phone they
    // signed into in February and sold in March.
    const full = [
      session('laptop', 1, '2026-03-10'),
      session('sold-phone', 2, '2026-02-01'),
      session('tablet', 3, '2026-03-09'),
      session('desktop', 4, '2026-03-08'),
    ];

    const result = allocateSlot(full, 4);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.evicted?.id).toBe('sold-phone');
    expect(result.value.slot).toBe(2);
  });

  it('names the evicted session so the caller can revoke it', () => {
    // Not a convenience. The caller has to drop the cache entry, publish
    // `session.revoked` and tell the person which device lost its place. A
    // boolean "something was evicted" would leave all three guessing.
    const full = [1, 2, 3, 4].map((slot) =>
      session(`s${String(slot)}`, slot, '2026-03-0' + String(slot)),
    );
    const result = allocateSlot(full, 4);
    if (!result.ok) return;
    expect(result.value.evicted).toEqual(full[0]);
  });

  it('honours a tenant limit other than four', () => {
    // Regulated customers ask for two; a company issuing shared terminals asks
    // for more. The limit is policy, the uniqueness is the mechanism.
    const two = [session('a', 1, '2026-03-01'), session('b', 2, '2026-03-02')];
    const result = allocateSlot(two, 2);
    if (!result.ok) return;
    expect(result.value.slot).toBe(1);
    expect(result.value.evicted?.id).toBe('a');
  });

  it('refuses a limit below one', () => {
    // A limit of zero would evict a session and then hand back its slot, so
    // logging in would always succeed and always log you out. Fail instead.
    const result = allocateSlot([], 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_SESSION_LIMIT');
  });

  it('allocates inside the limit and ignores rows stranded above it', () => {
    // A tenant that lowered its limit from four to two still has rows in slots
    // 3 and 4. Allocation must stay inside 1..2 and must not hand out slot 3
    // because it "looks free" — the unique index would accept that row and the
    // account would quietly be over its limit again.
    //
    // Evicting a stranded row is not the answer either: freeing slot 3 does
    // not free a slot anyone may use. Cleanup is a separate concern, below.
    const legacy = [
      session('a', 1, '2026-03-05'),
      session('b', 2, '2026-03-06'),
      session('c', 3, '2026-03-01'),
      session('d', 4, '2026-03-02'),
    ];

    const result = allocateSlot(legacy, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slot).toBe(1);
    expect(result.value.evicted?.id).toBe('a');
  });
});

describe('overLimitSessions', () => {
  it('names the rows a lowered limit stranded', () => {
    // Lowering the limit does not revoke anything on its own. Something has to
    // go and find the sessions that are now over the line, and it is better
    // that it is a named function than a comment in a migration.
    const legacy = [
      session('a', 1, '2026-03-05'),
      session('c', 3, '2026-03-01'),
      session('d', 4, '2026-03-02'),
    ];

    expect(overLimitSessions(legacy, 2).map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('finds nothing when everything is inside the limit', () => {
    expect(overLimitSessions([session('a', 1, '2026-03-05')], 4)).toEqual([]);
  });
});
