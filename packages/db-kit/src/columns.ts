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
 * Column-level encryption via pgcrypto for the fields the classification
 * registry marks confidential or special-category.
 */
export const encrypted = customType<{ data: string; driverData: Buffer }>({
  dataType: () => 'bytea',
});
/* eslint-enable @typescript-eslint/explicit-module-boundary-types */
