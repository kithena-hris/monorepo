import { randomBytes, randomInt } from 'node:crypto';

/**
 * The last millisecond an id was minted in, and how many have been minted in
 * it.
 *
 * Module state, which is the part worth knowing about: monotonicity is a
 * property of one process, and two processes minting in the same millisecond
 * still sort against each other randomly. That is the correct scope. Ordering
 * *between* writers is what the transactional outbox and the WAL are for;
 * this only has to keep one transaction's own events in the order the domain
 * raised them.
 */
let lastMs = -1;
let counter = 0;

/**
 * UUIDv7, per RFC 9562.
 *
 * Every event envelope requires one — `z.uuidv7()` in the contract — and the
 * reason is in `packages/contracts/src/event.ts`: a v7 sorts by time, which
 * makes the transactional outbox trivially orderable without a sequence column.
 *
 * Written here rather than added as a dependency. `CLAUDE.md` asks for a reason
 * the existing stack cannot cover it, and it cannot be given: this is a
 * documented bit layout over `crypto.randomBytes`, and the whole of it is
 * visible below.
 *
 *   48 bits  unix timestamp in milliseconds
 *    4 bits  version, 0b0111
 *   12 bits  counter, so ids minted in one millisecond still sort in order
 *    2 bits  variant, 0b10
 *   62 bits  random
 *
 * ### The counter is not decoration
 *
 * A millisecond is a long time. Two events raised by one transition —
 * `session.revoked` and `session.started` when a device is evicted,
 * `account.enrolled` and `account.profile_captured` at enrolment — are minted
 * microseconds apart and land in the same millisecond every time. With random
 * bits in that field they sort against each other by coin flip, so an outbox
 * read `ORDER BY event_id` returned the evicted session after the one that
 * replaced it, roughly half the time.
 *
 * RFC 9562 §6.2 offers exactly this remedy: use the 12 `rand_a` bits as a
 * counter within the millisecond. Seeded randomly in the lower half so there
 * is room to count without being guessable, and on overflow the timestamp
 * borrows a millisecond from the future rather than wrapping — 4096 ids in one
 * millisecond is a throughput nobody here has, and a wrap would silently
 * reorder them.
 */
export function uuidv7(now?: number): string {
  const bytes = randomBytes(16);

  /*
   * An explicit timestamp opts out of the counter, and deliberately.
   *
   * The parameter exists so a test can say which moment an id belongs to, and
   * a caller asserting the moment has also asserted that successive ids are
   * simultaneous — there is no order between them to preserve. Threading the
   * module counter through that path would make a test calling with an older
   * timestamp receive a newer one, which is a confusing way to discover that
   * ordering is monotonic.
   */
  const at = now ?? nextMoment();

  // Big-endian milliseconds across the first six bytes. `now` exceeds 32 bits,
  // so the high half is written separately rather than through a single
  // 32-bit write that would silently truncate in 1970-relative terms.
  const ms = BigInt(at);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }

  // Version 7 in the high nibble of byte 6. The low nibble and byte 7 are
  // `rand_a`: the counter when this process is sequencing, random otherwise.
  if (now === undefined) {
    bytes[6] = 0x70 | ((counter >> 8) & 0x0f);
    bytes[7] = counter & 0xff;
  } else {
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  }
  // Variant 10 in the top two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The millisecond this id belongs to, advancing the counter within it.
 *
 * Also the answer to a clock that steps backwards — NTP does this, and a
 * virtual machine resuming from a snapshot does it by several seconds. Going
 * back would mint an id that sorts before ones already written, so the last
 * millisecond used is kept instead and the counter carries the ordering until
 * the wall clock catches up.
 */
function nextMoment(): number {
  const wall = Date.now();

  if (wall > lastMs) {
    lastMs = wall;
    // Seeded in the lower half, so 2048 ids can be minted in this millisecond
    // before the timestamp has to borrow from the next one.
    counter = randomInt(0, 0x800);
    return lastMs;
  }

  counter += 1;
  if (counter > 0xfff) {
    // 4096 in one millisecond. Borrow the next rather than wrap, which would
    // reorder everything minted after it.
    lastMs += 1;
    counter = 0;
  }
  return lastMs;
}
