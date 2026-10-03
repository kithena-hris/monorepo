import { Instant, PersonId, TenantId, type PunchKind, type PunchSource } from '@kithena/contracts';

import type { Punch } from './clock.js';

/**
 * Adam's week of 28 September in T20, as the punches that produce it.
 *
 * The design draws the bars in decimal hours (8.97 is 08:58); these are the
 * minutes those decimals round to. Madrid is UTC+2 until 25 October.
 */

export const MADRID = 'Europe/Madrid';
export const tenantId = TenantId.parse('11111111-1111-7111-8111-111111111111');
export const personId = PersonId.parse('22222222-2222-7222-8222-222222222222');

let sequence = 0;
/** A UUIDv7-shaped id, distinct per call. Order is all a test needs from it. */
export const nextId = (): string =>
  `0192f000-0000-7000-8000-${String(++sequence).padStart(12, '0')}`;

export const at = (day: string, time: string): Instant => Instant.parse(`${day}T${time}:00+02:00`);

export function punch(
  day: string,
  time: string,
  kind: PunchKind,
  over: Partial<Punch> & { source?: PunchSource } = {},
): Punch {
  return {
    id: nextId(),
    at: at(day, time),
    recordedAt: at(day, time),
    kind,
    source: 'badge',
    workModel: 'office',
    deviceId: null,
    insideOfficeArea: null,
    supersedes: null,
    reason: null,
    ...over,
  };
}

export const monday = [
  punch('2026-09-28', '08:58', 'in'),
  punch('2026-09-28', '13:05', 'break_start', { source: 'web' }),
  punch('2026-09-28', '13:50', 'break_end', { source: 'web' }),
  punch('2026-09-28', '17:41', 'out', { source: 'web' }),
];
export const tuesday = [
  punch('2026-09-29', '09:02', 'in'),
  punch('2026-09-29', '13:30', 'break_start', { source: 'web' }),
  punch('2026-09-29', '14:10', 'break_end', { source: 'web' }),
  punch('2026-09-29', '18:47', 'out', { source: 'web' }),
];
/** No clock-out. */
export const wednesday = [
  punch('2026-09-30', '08:47', 'in'),
  punch('2026-09-30', '13:12', 'break_start', { source: 'web' }),
  punch('2026-09-30', '14:02', 'break_end', { source: 'web' }),
];
/** Clocked in, still working at 12:33. */
export const thursday = [punch('2026-10-01', '08:52', 'in')];

export const week = [...monday, ...tuesday, ...wednesday, ...thursday];
export const thursdayNoon = at('2026-10-01', '12:33');
