import { CalendarDate, DateSpan, PersonId } from '@kithena/contracts';

import { MONDAY_TO_FRIDAY, type WorkCalendar } from '../calendar/working-days.js';
import type { Absence, TeamMember } from './coverage.js';

/*
 * The design's October 2026 (to-web.js `TEAM`, `OFF`), shared by the coverage
 * and alternatives tests. Holidays are the design's: Fiesta Nacional only.
 */
export const d = (s: string): CalendarDate => CalendarDate.parse(s);
const person = (n: number): PersonId =>
  PersonId.parse(`00000000-0000-7000-8000-${String(n).padStart(12, '0')}`);
export const madrid: WorkCalendar = {
  pattern: MONDAY_TO_FRIDAY,
  holidays: new Set([d('2026-10-12')]),
};

/** Platform, as T13 draws it: seven people, October 2026, Adam's 19–23 still pending. */
export const platform = {
  marco: person(1),
  adam: person(2),
  omar: person(3),
  yuki: person(4),
  leo: person(5),
  hana: person(6),
  ravi: person(7),
};
export const members: TeamMember[] = Object.values(platform).map((personId) => ({
  personId,
  calendar: madrid,
}));
export const off = (
  personId: PersonId,
  from: number,
  to: number,
  status: Absence['status'] = 'approved',
): Absence => ({
  personId,
  span: DateSpan.parse({
    from: `2026-10-${String(from).padStart(2, '0')}`,
    to: `2026-10-${String(to).padStart(2, '0')}`,
  }),
  status,
});
export const october: Absence[] = [
  off(platform.marco, 13, 16),
  off(platform.adam, 19, 23, 'pending'),
  off(platform.omar, 19, 21),
  off(platform.yuki, 21, 21),
  off(platform.leo, 26, 30),
  off(platform.hana, 1, 2),
  off(platform.ravi, 9, 9),
];
