import { ok, type Result } from '@kithena/domain-kit';
import { LeaveApproved, LeaveCancelled, LeaveChanged, TenantId } from '@kithena/contracts';

import { LeaveRequestId } from '../../domain/request/leave-request.js';
import type { Deps } from '../ports.js';
import { calendarForRequest, type Delivery } from './calendar.js';

/**
 * Time Off's own events, read back to reach outside it (TOF-110): an
 * approval, a change or a cancellation puts the request on the member's
 * calendar or takes it off. From the outbox, so a calendar call that fails
 * after the commit is retried with the event, never lost with a crash.
 *
 * Anything else is ignored; a malformed message too, since Kafka would
 * redeliver it forever.
 */

type ReachEventDeps = Pick<Deps, 'uow' | 'clock' | 'reach'>;

const NOTHING: Delivery = { sent: 0, failed: [] };

const WHY = {
  [LeaveApproved.name]: 'approved',
  [LeaveChanged.name]: 'changed',
  [LeaveCancelled.name]: 'cancelled',
} as const;

export const reachOnEvent =
  (deps: ReachEventDeps) =>
  async (raw: unknown): Promise<Result<Delivery>> => {
    if (deps.reach === undefined || typeof raw !== 'object' || raw === null) return ok(NOTHING);
    const name = Reflect.get(raw, 'eventName') as unknown;
    const payload = Reflect.get(raw, 'payload') as unknown;
    const tenant = TenantId.safeParse(Reflect.get(raw, 'tenantId'));
    const request = LeaveRequestId.safeParse(
      typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'requestId') : null,
    );
    if (!tenant.success || !request.success) return ok(NOTHING);
    const why = typeof name === 'string' ? WHY[name as keyof typeof WHY] : undefined;
    if (why === undefined) return ok(NOTHING);
    return calendarForRequest(deps)(tenant.data, request.data, why);
  };
