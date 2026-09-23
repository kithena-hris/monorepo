/**
 * When a reminder email is due (§8.4, PEO-084).
 *
 * The product decision: day 1, then weekly until the profile is complete, and
 * never more than one reminder email per person per week regardless of how
 * many fields are missing. Day 1 is the first sweep after the gap opens — a
 * person never reminded is due at once — and every sweep after that finds them
 * due again only when their last email is at least 168 hours old.
 *
 * Hours, not `interval '7 days'`: a day in Postgres interval arithmetic follows
 * the session time zone across a DST change and is 23 or 25 hours long, which
 * would let two emails through 167 hours apart.
 *
 * The one place the window is computed. The claim is a single conditional
 * UPDATE, so this returns the cutoff that UPDATE compares against rather than
 * a per-row predicate. When a person's own time zone decides where "day 1" and
 * "weekly" fall, this is the function that learns it.
 */
const WEEK_MS = 168 * 3_600_000;

/** A person last reminded at or before this instant is due again. */
export function reminderDueBefore(now: Date): Date {
  return new Date(now.getTime() - WEEK_MS);
}
