import { ok, type Result } from '@kithena/domain-kit';
import type { TenantId } from '@kithena/contracts';

import { resolveHolidays } from '../../domain/calendar/holiday-calendar.js';
import type { LeaveRequestId } from '../../domain/request/leave-request.js';
import type { CalendarEntry, CalendarPort, Deps, Integration, Tx } from '../ports.js';
import { transact } from '../shared.js';

/**
 * Time off on people's calendars (PRD §5.3, TOF-110): an approved request is
 * "Out of office" on the member's own calendar, and the holidays where they
 * work are on it too, through whichever calendar the company connected.
 *
 * The entry is titled "Out of office" and nothing else: a calendar is read by
 * colleagues and clients, and sick leave is nobody's business there. Each
 * entry is idempotent by its key — `request-<id>-<span>`, `holiday-<layer>-<date>` —
 * so an event delivered twice puts one entry, and the current state of the
 * request decides: approved puts its spans, anything else takes them away.
 *
 * The calls are made after the transaction that read the request, never
 * inside it, and a provider's failure is reported, not thrown: one mailbox
 * that refuses must not hold up everybody else's.
 */

type CalendarDeps = Pick<Deps, 'uow' | 'clock' | 'reach'>;

export interface Delivery {
  readonly sent: number;
  readonly failed: readonly { readonly provider: string; readonly message: string }[];
}

/** A request holds dates in a calendar while these are its status. */
const HOLDS = new Set(['approved', 'taken', 'change_pending']);
/** The most spans a request has (`CounterBody`, a swap): the keys a change may leave behind. */
const MAX_SPANS = 10;
const TITLE = 'Out of office';

/** Each connected calendar with its adapter, when that adapter has credentials. */
async function connected(
  tx: Tx,
  deps: Pick<Deps, 'reach'>,
): Promise<{ port: CalendarPort; integration: Integration }[]> {
  const out = [];
  for (const port of deps.reach?.calendars ?? []) {
    if (!port.configured) continue;
    const integration = await tx.integrations.get(port.provider);
    if (integration !== null) out.push({ port, integration });
  }
  return out;
}

async function deliver(
  targets: readonly { port: CalendarPort; integration: Integration }[],
  puts: readonly CalendarEntry[],
  removals: readonly Pick<CalendarEntry, 'key' | 'email'>[],
): Promise<Delivery> {
  let sent = 0;
  const failed: { provider: string; message: string }[] = [];
  for (const { port, integration } of targets) {
    for (const call of [
      ...puts.map((e) => () => port.put(integration, e)),
      ...removals.map((e) => () => port.remove(integration, e)),
    ]) {
      try {
        await call();
        sent++;
      } catch (error) {
        failed.push({
          provider: port.provider,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return { sent, failed };
}

/**
 * A request as it stands now, on its member's calendar: its spans while it
 * is approved, none otherwise. `changed` also takes away the spans a change
 * left behind; a first approval has none to take.
 */
export const calendarForRequest =
  (deps: CalendarDeps) =>
  async (
    tenantId: TenantId,
    requestId: LeaveRequestId,
    why: 'approved' | 'changed' | 'cancelled',
  ): Promise<Result<Delivery>> => {
    const read = await transact(deps, tenantId, async (tx) => {
      const targets = await connected(tx, deps);
      const record = targets.length === 0 ? null : await tx.requests.get(requestId);
      const member = record === null ? null : await tx.members.get(record.request.personId);
      return ok({ targets, record, member });
    });
    if (!read.ok) return read;
    const { targets, record, member } = read.value;
    if (record === null || member === null || member.workEmail === null) {
      return ok({ sent: 0, failed: [] });
    }
    const email = member.workEmail;
    const key = (i: number) => `request-${requestId}-${String(i)}`;
    const holds = HOLDS.has(record.request.status);
    const spans = holds ? record.request.spans : [];
    const puts = spans.map((s, i) => ({
      key: key(i),
      email,
      title: TITLE,
      from: s.from,
      to: s.to,
      kind: 'out_of_office' as const,
      timeZone: member.timeZone,
    }));
    const stale = why === 'approved' && holds ? MAX_SPANS : spans.length;
    const removals = Array.from({ length: MAX_SPANS - stale }, (_, i) => ({
      key: key(stale + i),
      email,
    }));
    return ok(await deliver(targets, puts, removals));
  };

/**
 * Every member's holidays, this year's and next, on their calendar, from the
 * layers their location observes (§10.2). Monthly: a calendar published
 * late, or a member who moved, is caught within the month.
 *
 * ponytail: every holiday is put again each month, a few dozen calls a
 * member; remember what was put when that matters to a provider's quota.
 */
export const calendarHolidays =
  (deps: CalendarDeps) =>
  async (tenantId: TenantId): Promise<Result<Delivery>> => {
    const read = await transact(deps, tenantId, async (tx) => {
      const targets = await connected(tx, deps);
      if (targets.length === 0) return ok({ targets, entries: [] as CalendarEntry[] });
      const layers = await tx.holidays.layers();
      const entries: CalendarEntry[] = [];
      for (const member of await tx.members.list()) {
        if (member.workEmail === null || member.locationKey === null || member.status === 'left')
          continue;
        const keys = await tx.holidays.assigned(member.locationKey);
        const theirs = layers.filter((l) => keys.includes(l.key));
        const year = Number(deps.clock.date(member.timeZone).slice(0, 4));
        for (const y of [year, year + 1]) {
          for (const h of resolveHolidays(theirs, y)) {
            entries.push({
              key: `holiday-${h.layer}-${h.date}`,
              email: member.workEmail,
              title: h.name,
              from: h.date,
              to: h.date,
              kind: 'holiday',
              timeZone: member.timeZone,
            });
          }
        }
      }
      return ok({ targets, entries });
    });
    if (!read.ok) return read;
    return ok(await deliver(read.value.targets, read.value.entries, []));
  };
