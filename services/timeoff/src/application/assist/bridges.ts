import type { CalendarDate, TenantId } from '@kithena/contracts';

import { findBridges } from '../../domain/calendar/bridges.js';
import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import { addDays } from '../../domain/days.js';
import type { Member, Tx } from '../ports.js';
import { LIVE } from '../request/assess.js';
import { calendarOf } from '../shared.js';
import type { BridgeView } from '../screens/views.js';
import type { Writer } from './ports.js';
import { written, type Line } from './written.js';
import { dayCount, listOf, shortDate, spanLabel } from './words.js';

/**
 * Bridge days for one member (TOF-085): the domain finds them in the member's
 * own week and their location's holidays (`domain/calendar/bridges.ts`), and
 * a line is written about each, by the model when there is one.
 *
 * In two halves so no model call holds a transaction open: `bridgesFor` reads
 * inside it, `writeBridges` writes after it.
 */

export type BridgeFacts = Omit<BridgeView, 'text'>;

export async function bridgesFor(
  tx: Tx,
  member: Member,
  window: { readonly from: CalendarDate; readonly to: CalendarDate },
): Promise<BridgeFacts[]> {
  const calendar = await calendarOf(tx, member, window.from, window.to);
  const booked = (
    await tx.requests.list({ personIds: [member.personId], statuses: LIVE, from: window.from })
  ).flatMap((r) => r.request.spans.map((s) => ({ from: s.from, to: s.to })));
  const keys = member.locationKey === null ? [] : await tx.holidays.assigned(member.locationKey);
  const layers = (await tx.holidays.layers()).filter((l) => keys.includes(l.key));
  const names = new Map<string, string>();
  for (let y = Number(window.from.slice(0, 4)); y <= Number(window.to.slice(0, 4)) + 1; y++) {
    for (const h of resolveHolidays(layers, y)) names.set(h.date, h.name);
  }
  return findBridges(calendar, window, booked).map((b) => ({
    ...b,
    holidays: b.holidays.map((date) => ({ date, name: names.get(date) ?? 'a holiday' })),
  }));
}

/** From tomorrow to a year on: what the overview looks ahead over. */
export const yearAhead = (today: CalendarDate): { from: CalendarDate; to: CalendarDate } => ({
  from: addDays(today, 1),
  to: addDays(today, 365),
});

const template = (b: BridgeFacts): string =>
  `${dayCount(b.away.days)} off, ${spanLabel(b.away.from, b.away.to)}, with ${listOf(
    b.holidays.map((h) => h.name),
  )}.`;

/** Each bridge with its line; the model's when `writer` is given and its line holds up. */
export async function writeBridges(
  writer: Writer | undefined,
  tenantId: TenantId,
  bridges: readonly BridgeFacts[],
): Promise<BridgeView[]> {
  const lines: Record<string, Line> = Object.fromEntries(
    bridges.map((b, i) => [
      `bridge${String(i)}`,
      {
        about: `Bridge ${String(i)}: what asking for these days gets the reader, in under 15 words.`,
        template: template(b),
      },
    ]),
  );
  const out = await written(
    writer,
    tenantId,
    {
      instruction:
        'You suggest days off to an employee. Each bridge is a few working days that join ' +
        'public holidays to a weekend, so a short request buys a long break. Speak to the reader as “you”.',
      facts: {
        bridges: bridges.map((b, i) => ({
          line: `bridge${String(i)}`,
          ask: b.used === 1 ? shortDate(b.from) : `${shortDate(b.from)} to ${shortDate(b.to)}`,
          daysAsked: b.used,
          breakFrom: shortDate(b.away.from),
          breakTo: shortDate(b.away.to),
          daysOff: b.away.days,
          holidays: b.holidays.map((h) => h.name),
        })),
      },
    },
    lines,
  );
  return bridges.map((b, i) => ({
    ...b,
    text: out[`bridge${String(i)}`] ?? { text: template(b), ai: false },
  }));
}
