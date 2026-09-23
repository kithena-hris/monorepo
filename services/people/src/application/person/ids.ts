import { randomBytes } from 'node:crypto';

/**
 * UUIDv7 (RFC 9562): 48 bits of milliseconds, a 12-bit counter, random rest.
 *
 * The contract requires a v7 on every envelope, because a v7 sorts by time and
 * that makes the outbox orderable without a sequence. The counter keeps two
 * ids minted in one millisecond in the order they were minted, which is the
 * order one transaction raised its events in.
 *
 * Its own copy rather than identity's: a module does not import another.
 */
let lastMs = -1;
let counter = 0;

export function uuidv7(): string {
  const ms = Date.now();
  if (ms === lastMs) counter = (counter + 1) & 0xfff;
  else {
    lastMs = ms;
    counter = 0;
  }

  const bytes = randomBytes(16);
  bytes.writeUIntBE(ms, 0, 6);
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
