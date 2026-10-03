import * as z from 'zod';

import { asInternal, asPublic, policy } from '../classification.js';
import { Instant } from '../primitives.js';
import { AttendanceWorkModel, PunchKind, PunchSource } from './primitives.js';

/**
 * A punch (PRD §11.2).
 *
 * **Location is checked only at the moment of punching, to suggest "Office",
 * and is never stored as coordinates.** The input is `strict`, so a client that
 * sends a latitude is refused rather than having it quietly dropped: the
 * client is wrong, and saying so is how it gets fixed.
 */
export const PunchInput = z
  .object({
    kind: PunchKind,
    source: PunchSource,
    workModel: AttendanceWorkModel,
    /** Set by a kiosk replaying punches taken offline; otherwise the server's clock. */
    at: Instant.nullable().default(null),
    /** The kiosk, when the source is one. */
    deviceId: z.uuid().nullable().default(null).register(policy, asPublic()),
    /** Only when a geofence policy is on: inside the office area, as a boolean. */
    insideOfficeArea: z.boolean().nullable().default(null).register(policy, asInternal()),
  })
  .strict();
export type PunchInput = z.infer<typeof PunchInput>;

/** One clock, whichever source punched it (PRD §11.1). */
export const ClockState = z.enum(['out', 'in', 'on_break']).register(policy, asInternal());
export type ClockState = z.infer<typeof ClockState>;
