import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * One signed-in device.
 *
 * A session is an entity *inside* the Account aggregate, not an aggregate of
 * its own, and that is not a stylistic choice: the "at most four devices" rule
 * spans every session an account has, and an invariant that spans entities is
 * the definition of where the aggregate boundary goes. You cannot enforce
 * "at most four" by looking at one session, so one session cannot be the unit
 * of consistency.
 */
export interface Session {
  readonly id: string;
  /** 1..limit. Reused, never incremented. */
  readonly slot: number;
  readonly startedAt: string;
  /** Drives eviction. The device used least recently loses its place. */
  readonly lastSeenAt: string;
}

export interface SlotAllocation {
  readonly slot: number;
  /** The session that lost its place, or null if a slot was free. */
  readonly evicted: Session | null;
}

/**
 * Which slot a new device gets, and what it costs.
 *
 * Half of the invariant. The other half is `UNIQUE (account_id, slot)`, and
 * they are deliberately redundant: this decides *which* slot and reports what
 * was displaced, the index makes a fifth row impossible even when two logins
 * race past this function in the same millisecond. Counting rows here and
 * inserting afterwards would be a check-then-act with a gap in the middle;
 * the index is what closes the gap.
 */
export function allocateSlot(sessions: readonly Session[], limit: number): Result<SlotAllocation> {
  if (!Number.isInteger(limit) || limit < 1) {
    return err(
      failure(
        'INVALID_SESSION_LIMIT',
        'A tenant session limit must be a whole number of at least one',
      ),
    );
  }

  // Only sessions inside the limit compete for a slot. A tenant that lowered
  // its limit still has rows above the line; they are stranded rather than
  // holding anything a new session could use, and `overLimitSessions` is what
  // goes and cleans them up.
  const inRange = sessions.filter((s) => s.slot >= 1 && s.slot <= limit);
  const taken = new Set(inRange.map((s) => s.slot));

  for (let slot = 1; slot <= limit; slot += 1) {
    if (!taken.has(slot)) return ok({ slot, evicted: null });
  }

  // Full. Evict the least recently seen and take its place, rather than
  // refusing: refusing strands whoever has four slots on a dead laptop, a sold
  // phone and two cleared browsers, and support cannot tell that from an
  // attack — so support raises the limit, and the control is gone.
  const evicted = leastRecentlySeen(inRange);
  if (!evicted) {
    // Unreachable while limit >= 1, because a full set of slots is a non-empty
    // set. Returned rather than asserted, so a future change to the loop above
    // cannot turn this into a thrown TypeError on the login path.
    return err(failure('NO_SLOT_AVAILABLE', 'No session slot could be allocated'));
  }

  return ok({ slot: evicted.slot, evicted });
}

/** Sessions holding a slot above the current limit, oldest slot first. */
export function overLimitSessions(sessions: readonly Session[], limit: number): readonly Session[] {
  return sessions.filter((s) => s.slot > limit).toSorted((a, b) => a.slot - b.slot);
}

function leastRecentlySeen(sessions: readonly Session[]): Session | undefined {
  return sessions.reduce<Session | undefined>(
    (oldest, s) => (oldest === undefined || s.lastSeenAt < oldest.lastSeenAt ? s : oldest),
    undefined,
  );
}
