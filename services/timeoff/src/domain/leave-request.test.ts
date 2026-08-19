import { describe, it, expect } from 'vitest';
import { fixedClock, isOk } from '@hris/domain-kit';
import { CalendarDate, PersonId, TenantId } from '@hris/contracts';
import { LeaveRequest, leaveRequestId } from './leave-request.js';

/*
 * Fixtures go through the real parsers rather than being asserted into place.
 *
 * A branded type is a claim that a value was checked. A test that asserts its
 * way past the check is testing the domain against inputs the domain can never
 * actually receive, so a malformed date here would pass the suite and fail in
 * production. Parsing costs nothing and makes the fixture prove itself, it
 * also means a typo in one of these UUIDs fails loudly at the line that wrote
 * it instead of somewhere downstream.
 */
const base = {
  id: leaveRequestId('a3f1c2d4-0000-7000-8000-000000000001'),
  tenantId: TenantId.parse('11111111-1111-7111-8111-111111111111'),
  personId: PersonId.parse('22222222-2222-7222-8222-222222222222'),
  from: CalendarDate.parse('2026-09-01'),
  to: CalendarDate.parse('2026-09-05'),
  workingDays: 5,
  actorUserId: '33333333-3333-7333-8333-333333333333',
  correlationId: '44444444-4444-7444-8444-444444444444',
  clock: fixedClock('2026-08-03T09:00:00Z'),
};

describe('LeaveRequest', () => {
  it('rejects a period that ends before it starts', () => {
    const result = LeaveRequest.request({
      ...base,
      kind: 'annual_leave',
      from: CalendarDate.parse('2026-09-05'),
      to: CalendarDate.parse('2026-09-01'),
      balanceRemainingDays: 20,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects annual leave beyond the remaining balance', () => {
    const result = LeaveRequest.request({ ...base, kind: 'annual_leave', balanceRemainingDays: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('allows unpaid leave regardless of balance, because it draws down nothing', () => {
    const result = LeaveRequest.request({ ...base, kind: 'unpaid_leave', balanceRemainingDays: 0 });
    expect(result.ok).toBe(true);
  });

  it('stamps effectiveFrom with the first day of leave, not the entry date', () => {
    const result = LeaveRequest.request({
      ...base,
      kind: 'annual_leave',
      balanceRemainingDays: 20,
    });
    if (!isOk(result)) throw new Error('expected success');
    const [event] = result.value.drainEvents();
    expect(event?.effectiveFrom).toBe('2026-09-01');
  });
});
