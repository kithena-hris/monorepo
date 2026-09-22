import { customType, timestamp, date, numeric } from 'drizzle-orm/pg-core';

/** Money as an exact decimal. A float here is a rounding bug with a salary attached. */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types --
   Drizzle's column builders are inference-only: their types encode every option
   passed and run to several hundred characters, with no exported alias to name
   them by. The exported constants below are annotated from these helpers, so
   the public signatures are still explicit. */
const moneyColumn = (name: string) => numeric(name, { precision: 19, scale: 4 });
// The annotation is derived from the implementation rather than written by
// hand: drizzle's builder types encode the column options, so `ReturnType<typeof numeric>`
// would name a different type than this call actually produces.
export const money: (name: string) => ReturnType<typeof moneyColumn> = moneyColumn;

/** Calendar dates stay calendar dates. */
const calendarDateColumn = (name: string) => date(name, { mode: 'string' });
export const calendarDate: (name: string) => ReturnType<typeof calendarDateColumn> =
  calendarDateColumn;

const instantColumn = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
export const instant: (name: string) => ReturnType<typeof instantColumn> = instantColumn;

/**
 * A ciphertext column: `bytea` in the database, base64 in application code.
 *
 * The conversion is the point and was missing. `customType` without
 * `toDriver`/`fromDriver` hands the value to the driver untouched, so a
 * JavaScript string went to a `bytea` column and came back as a `Buffer` that
 * nothing had asked for — the declaration described an intent the column did
 * not carry out.
 *
 * Base64 rather than raw bytes on the application side because a ciphertext
 * gets logged by accident, put in a test fixture, and pasted into a ticket; a
 * string does those things visibly, while a `Buffer` renders as
 * `<Buffer 8f 2a …>` and reads like a bug rather than like a secret.
 *
 * This holds a ciphertext and never a plaintext. Nothing here encrypts: the
 * envelope is the caller's, because the key it wraps with belongs to the
 * service that owns the data rather than to a column type.
 */
export const encrypted = customType<{ data: string; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value: string) => Buffer.from(value, 'base64'),
  fromDriver: (value: Buffer) => value.toString('base64'),
});
/* eslint-enable @typescript-eslint/explicit-module-boundary-types */
