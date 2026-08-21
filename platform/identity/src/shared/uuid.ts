import { randomBytes } from 'node:crypto';

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
 *   12 bits  random
 *    2 bits  variant, 0b10
 *   62 bits  random
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // Big-endian milliseconds across the first six bytes. `now` exceeds 32 bits,
  // so the high half is written separately rather than through a single
  // 32-bit write that would silently truncate in 1970-relative terms.
  const ms = BigInt(now);
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  }

  // Version 7 in the high nibble of byte 6, keeping the low nibble random.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // Variant 10 in the top two bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
