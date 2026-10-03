import { describe, expect, it } from 'vitest';
import {
  DayAmount,
  LeaveCancelled,
  LeaveChanged,
  LeaveCounterProposed,
  LeaveRejected,
  LeaveRequested,
  LeaveApproved,
  LeaveTypeKey,
  type RequestStatus,
} from '@kithena/contracts';

import { balanceOn, type LedgerEntry } from '../balance/ledger.js';
import { ADAM, context, date, TENANT } from '../fixtures.js';
import {
  LeaveRequest,
  leaveRequestId,
  type Proposal,
  type RequestLeaveType,
  type Span,
} from './leave-request.js';

const MARCO_ACCOUNT = '77777777-7777-7777-8777-777777777777';
const ctx = context('2026-10-01T09:00:00.000Z');
const after = context('2026-10-26T09:00:00.000Z');

const vacation: RequestLeaveType = {
  key: LeaveTypeKey.parse('vacation'),
  category: 'annual_leave',
  tracked: true,
  paid: 'paid',
  unit: 'day',
};

const span = (from: string, to: string, workingDays: string, ends = false): Span => ({
  from: date(from),
  to: date(to),
  startsHalfDay: false,
  endsHalfDay: ends,
  workingDays: DayAmount.parse(workingDays),
});

/** A suggestion of runs of days, as `alternatives` returns one. */
const option = (workingDays: string, ...runs: [string, string][]): Proposal => ({
  spans: runs.map(([from, to]) => ({ from: date(from), to: date(to) })),
  workingDays: DayAmount.parse(workingDays),
});

/** Adam, 19–23 Oct, 5 days (T16, MT16). */
const october = span('2026-10-19', '2026-10-23', '5.000');

function requested(over: Partial<Parameters<typeof LeaveRequest.request>[0]> = {}) {
  const result = LeaveRequest.request(
    {
      id: leaveRequestId('a3f1c2d4-0000-7000-8000-000000000001'),
      tenantId: TENANT,
      personId: ADAM,
      leaveType: vacation,
      span: october,
      verdict: { kind: 'fits' },
      ...over,
    },
    ctx,
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const kinds = (entries: readonly LedgerEntry[]) =>
  entries.map((e) => [e.kind, e.amount, e.effectiveOn]);

/** A request in each state, by the shortest legal path. */
function inState(status: RequestStatus): LeaveRequest {
  const { request } = requested();
  const approve = () => must(request.approve({ by: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
  switch (status) {
    case 'pending':
      break;
    case 'approved':
      approve();
      break;
    case 'declined':
      must(request.decline({ by: MARCO_ACCOUNT, reason: null }, ctx));
      break;
    case 'withdrawn':
      must(request.withdraw(ctx));
      break;
    case 'counter_proposed':
      must(
        request.counterPropose(
          { by: MARCO_ACCOUNT, proposals: [option('5.000', ['2026-10-26', '2026-10-30'])] },
          ctx,
        ),
      );
      break;
    case 'change_pending':
      approve();
      must(request.requestChange({ span: span('2026-11-02', '2026-11-06', '5.000') }, ctx));
      break;
    case 'cancelled':
      approve();
      must(request.cancel(ctx));
      break;
    case 'taken':
      approve();
      must(request.markTaken(after));
      break;
    case 'draft':
      throw new Error('a request is never a draft in the domain');
  }
  request.drainEvents();
  return request;
}

describe('LeaveRequest.request', () => {
  it('goes to pending, raising requested v2 effective on its first day, and books the days', () => {
    const { request, entries } = requested();
    expect(request.status).toBe('pending');
    const [event] = request.drainEvents();
    expect([event?.eventName, event?.eventVersion, event?.effectiveFrom]).toEqual([
      LeaveRequested.name,
      2,
      '2026-10-19',
    ]);
    expect(event?.occurredAt).toBe('2026-10-01T09:00:00.000Z');
    expect(event?.payload).toMatchObject({
      leaveTypeKey: 'vacation',
      category: 'annual_leave',
      workingDays: '5.000',
      belowZero: false,
    });
    expect(kinds(entries)).toEqual([['booking', '-5.000', '2026-10-01']]);
  });

  it('borrows below zero instead of refusing: T5, 8 days against 6.5 left', () => {
    const { request, entries } = requested({
      span: span('2026-12-14', '2026-12-23', '8.000'),
      verdict: {
        kind: 'borrow',
        days: DayAmount.parse('1.500'),
        nextYearStartsAt: DayAmount.parse('23.500'),
        approvers: ['manager', 'hr'],
      },
    });
    expect(request.status).toBe('pending');
    expect(request.belowZero).toBe(true);
    expect(request.drainEvents()[0]?.payload).toMatchObject({
      belowZero: true,
      workingDays: '8.000',
    });
    expect(kinds(entries)).toEqual([
      ['booking', '-8.000', '2026-10-01'],
      ['borrow', '1.500', '2026-10-01'],
    ]);
  });

  it('refuses a request beyond the negative limit, with the limit in the message', () => {
    const result = LeaveRequest.request(
      {
        id: leaveRequestId('a3f1c2d4-0000-7000-8000-000000000002'),
        tenantId: TENANT,
        personId: ADAM,
        leaveType: vacation,
        span: span('2026-12-14', '2026-12-28', '10.000'),
        verdict: { kind: 'refused', limit: DayAmount.parse('3.000') },
      },
      ctx,
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('BEYOND_NEGATIVE_LIMIT');
    expect(result.error.message).toContain('3');
  });

  it('refuses a period that ends before it starts', () => {
    const result = LeaveRequest.request(
      {
        id: leaveRequestId('a3f1c2d4-0000-7000-8000-000000000003'),
        tenantId: TENANT,
        personId: ADAM,
        leaveType: vacation,
        span: span('2026-10-23', '2026-10-19', '5.000'),
        verdict: { kind: 'fits' },
      },
      ctx,
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('INVALID_PERIOD');
  });

  it('books nothing for a type that draws no balance', () => {
    const { entries } = requested({
      leaveType: {
        ...vacation,
        key: LeaveTypeKey.parse('unpaid'),
        category: 'unpaid_leave',
        tracked: false,
        paid: 'unpaid',
      },
    });
    expect(entries).toEqual([]);
  });

  it('keeps a sick note inside: the event says only that one exists', () => {
    const fileId = '0189ffff-0000-7000-8000-00000000f11e';
    const { request } = requested({ sickNoteFileId: fileId });
    expect(request.sickNoteFileId).toBe(fileId);
    const [event] = request.drainEvents();
    expect(event?.payload).toMatchObject({ notePresent: true });
    expect(JSON.stringify(event)).not.toContain(fileId);
  });
});

describe('transitions', () => {
  it('approve: pending → approved, raising approved with the payroll treatment; the booking stays', () => {
    const request = inState('pending');
    const entries = must(request.approve({ by: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    expect(request.status).toBe('approved');
    expect(entries).toEqual([]);
    const [event] = request.drainEvents();
    expect(event?.eventName).toBe(LeaveApproved.name);
    expect(event?.payload).toMatchObject({
      approvedBy: MARCO_ACCOUNT,
      workingDays: 5,
      payroll: { paid: true, statutory: false, jurisdiction: 'ES' },
    });
  });

  it('decline: pending → declined, raising rejected and releasing the booking', () => {
    const request = inState('pending');
    const entries = must(request.decline({ by: MARCO_ACCOUNT, reason: 'Release week' }, ctx));
    expect(request.status).toBe('declined');
    expect(kinds(entries)).toEqual([['release', '5.000', '2026-10-01']]);
    expect(request.drainEvents()[0]?.eventName).toBe(LeaveRejected.name);
  });

  it('withdraw: pending → withdrawn, releasing the booking', () => {
    const request = inState('pending');
    const entries = must(request.withdraw(ctx));
    expect(request.status).toBe('withdrawn');
    expect(kinds(entries)).toEqual([['release', '5.000', '2026-10-01']]);
    expect(request.drainEvents()[0]).toMatchObject({
      eventName: LeaveCancelled.name,
      payload: { releasedDays: '5.000', shortened: false },
    });
  });

  it('withdraw also answers a counter-proposal', () => {
    const request = inState('counter_proposed');
    must(request.withdraw(ctx));
    expect(request.status).toBe('withdrawn');
  });

  it('counterPropose: pending → counter_proposed; the booking stays', () => {
    const request = inState('pending');
    const proposals = [
      option(
        '5.000',
        ['2026-10-19', '2026-10-20'],
        ['2026-10-22', '2026-10-23'],
        ['2026-10-26', '2026-10-26'],
      ),
      option('5.000', ['2026-10-26', '2026-10-30']),
    ];
    const entries = must(request.counterPropose({ by: MARCO_ACCOUNT, proposals }, ctx));
    expect(request.status).toBe('counter_proposed');
    expect(entries).toEqual([]);
    expect(request.drainEvents()[0]).toMatchObject({
      eventName: LeaveCounterProposed.name,
      payload: { proposedBy: MARCO_ACCOUNT },
    });
  });

  it('counterPropose refuses none, or more than three', () => {
    const none = inState('pending').counterPropose({ by: MARCO_ACCOUNT, proposals: [] }, ctx);
    const four = inState('pending').counterPropose(
      {
        by: MARCO_ACCOUNT,
        proposals: Array.from({ length: 4 }, () => option('5.000', ['2026-10-19', '2026-10-23'])),
      },
      ctx,
    );
    expect([none.ok, four.ok]).toEqual([false, false]);
    if (!none.ok) expect(none.error.code).toBe('PROPOSALS');
  });

  it('acceptCounter: counter_proposed → approved on the proposed dates, moving the booking', () => {
    const request = inState('counter_proposed');
    const entries = must(
      request.acceptCounter({ index: 0, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx),
    );
    expect(request.status).toBe('approved');
    expect(request.span.from).toBe('2026-10-26');
    expect(kinds(entries)).toEqual([
      ['release', '5.000', '2026-10-01'],
      ['booking', '-5.000', '2026-10-01'],
    ]);
    const events = request.drainEvents();
    expect(events.map((e) => e.eventName)).toEqual([LeaveChanged.name, LeaveApproved.name]);
    expect(events[0]?.effectiveFrom).toBe('2026-10-26');
  });

  it('counterPropose refuses runs out of order or overlapping', () => {
    const result = inState('pending').counterPropose(
      {
        by: MARCO_ACCOUNT,
        proposals: [option('5.000', ['2026-10-22', '2026-10-23'], ['2026-10-19', '2026-10-20'])],
      },
      ctx,
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('INVALID_PERIOD');
  });

  it('acceptCounter takes a swap, which is not one range: 19, 20, 22, 23 and 26 Oct (T18)', () => {
    const request = inState('pending');
    const swap = option(
      '5.000',
      ['2026-10-19', '2026-10-20'],
      ['2026-10-22', '2026-10-23'],
      ['2026-10-26', '2026-10-26'],
    );
    must(request.counterPropose({ by: MARCO_ACCOUNT, proposals: [swap] }, ctx));
    expect(request.drainEvents()[0]?.payload).toMatchObject({
      proposals: [{ spans: swap.spans, workingDays: '5.000' }],
    });
    must(request.acceptCounter({ index: 0, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    expect([request.span.from, request.span.to]).toEqual(['2026-10-19', '2026-10-26']);
    expect(request.spans).toEqual(swap.spans);
    const [changed] = request.drainEvents();
    expect(changed?.payload).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-26',
      spans: swap.spans,
      workingDays: '5.000',
    });
  });

  it('shortening a swap drops the runs after the new end', () => {
    const request = inState('pending');
    const swap = option(
      '5.000',
      ['2026-10-19', '2026-10-20'],
      ['2026-10-22', '2026-10-23'],
      ['2026-10-26', '2026-10-26'],
    );
    must(request.counterPropose({ by: MARCO_ACCOUNT, proposals: [swap] }, ctx));
    must(request.acceptCounter({ index: 0, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    // Ending on Sat 24, in the gap: the request now ends on Fri 23, its last day off.
    must(
      request.shorten(
        { to: date('2026-10-24'), endsHalfDay: false, workingDays: DayAmount.parse('4.000') },
        ctx,
      ),
    );
    expect(request.spans).toEqual(swap.spans.slice(0, 2));
    expect(request.span.to).toBe('2026-10-23');
  });

  it('acceptCounter refuses a proposal that was not made', () => {
    const result = inState('counter_proposed').acceptCounter(
      { index: 1, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' },
      ctx,
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('UNKNOWN_PROPOSAL');
  });

  it('keepOwnDates: counter_proposed → pending on the dates asked for', () => {
    const request = inState('counter_proposed');
    expect(must(request.keepOwnDates(ctx))).toEqual([]);
    expect(request.status).toBe('pending');
    expect(request.span).toEqual(october);
  });

  it('requestChange: approved → change_pending, the old dates still booked', () => {
    const request = inState('approved');
    const entries = must(
      request.requestChange({ span: span('2026-11-02', '2026-11-06', '5.000') }, ctx),
    );
    expect(request.status).toBe('change_pending');
    expect(entries).toEqual([]);
    expect(request.span).toEqual(october);
    expect(request.pendingChange?.from).toBe('2026-11-02');
  });

  it('approveChange: change_pending → approved on the new dates, superseding the old', () => {
    const request = inState('change_pending');
    const entries = must(request.approveChange(ctx));
    expect(request.status).toBe('approved');
    expect(request.span.from).toBe('2026-11-02');
    expect(request.pendingChange).toBeNull();
    expect(kinds(entries)).toEqual([
      ['release', '5.000', '2026-10-01'],
      ['booking', '-5.000', '2026-10-01'],
    ]);
    const [event] = request.drainEvents();
    expect(event?.eventName).toBe(LeaveChanged.name);
    expect(event?.effectiveFrom).toBe('2026-11-02');
    expect(String((event?.payload as { supersedes?: string } | undefined)?.supersedes)).toMatch(
      /^01890000-/,
    );
  });

  it('a change names the event it replaces: the request, then the change before it', () => {
    const { request } = requested();
    const requestedId = request.drainEvents()[0]?.eventId;
    must(request.approve({ by: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    must(request.requestChange({ span: span('2026-11-02', '2026-11-06', '5.000') }, ctx));
    must(request.approveChange(ctx));
    const first = request.drainEvents().find((e) => e.eventName === LeaveChanged.name);
    expect(first?.payload).toMatchObject({ supersedes: requestedId });
    must(request.requestChange({ span: span('2026-11-09', '2026-11-13', '5.000') }, ctx));
    must(request.approveChange(ctx));
    const [second] = request.drainEvents();
    expect(second?.payload).toMatchObject({ supersedes: first?.eventId });
  });

  it('declineChange: change_pending → approved, the old dates kept', () => {
    const request = inState('change_pending');
    expect(must(request.declineChange(ctx))).toEqual([]);
    expect(request.status).toBe('approved');
    expect(request.span).toEqual(october);
    expect(request.pendingChange).toBeNull();
  });

  it('shorten: approved stays approved, needs nobody, and gives the tail back', () => {
    const request = inState('approved');
    const entries = must(
      request.shorten(
        { to: date('2026-10-21'), endsHalfDay: false, workingDays: DayAmount.parse('3.000') },
        ctx,
      ),
    );
    expect(request.status).toBe('approved');
    expect(request.span.to).toBe('2026-10-21');
    expect(kinds(entries)).toEqual([['release', '2.000', '2026-10-01']]);
    expect(request.drainEvents()[0]).toMatchObject({
      eventName: LeaveCancelled.name,
      effectiveFrom: '2026-10-22',
      payload: { from: '2026-10-22', to: '2026-10-23', releasedDays: '2.000', shortened: true },
    });
  });

  it('shorten refuses what is not shorter', () => {
    const result = inState('approved').shorten(
      { to: date('2026-10-23'), endsHalfDay: false, workingDays: DayAmount.parse('5.000') },
      ctx,
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('NOT_SHORTER');
  });

  it('shorten refuses to give back days already passed', () => {
    const request = inState('approved');
    const during = context('2026-10-22T09:00:00.000Z');
    const result = request.shorten(
      { to: date('2026-10-20'), endsHalfDay: false, workingDays: DayAmount.parse('2.000') },
      during,
    );
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('ALREADY_PASSED');
    expect(
      must(
        request.shorten(
          { to: date('2026-10-21'), endsHalfDay: false, workingDays: DayAmount.parse('3.000') },
          during,
        ),
      ),
    ).toHaveLength(1);
  });

  it('cancel: approved → cancelled, needing nobody, every day back at once', () => {
    const request = inState('approved');
    const entries = must(request.cancel(ctx));
    expect(request.status).toBe('cancelled');
    expect(kinds(entries)).toEqual([['release', '5.000', '2026-10-01']]);
    expect(request.drainEvents()[0]).toMatchObject({
      eventName: LeaveCancelled.name,
      payload: { releasedDays: '5.000', shortened: false },
    });
  });

  it('cancel refuses once the leave has started', () => {
    const result = inState('approved').cancel(context('2026-10-20T09:00:00.000Z'));
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('ALREADY_PASSED');
  });

  it('markTaken: approved → taken once the last day has passed, settling the booking', () => {
    const request = inState('approved');
    const entries = must(request.markTaken(after));
    expect(request.status).toBe('taken');
    expect(kinds(entries)).toEqual([
      ['release', '5.000', '2026-10-23'],
      ['taken', '-5.000', '2026-10-23'],
    ]);
  });

  it('markTaken refuses before the last day has passed', () => {
    const result = inState('approved').markTaken(context('2026-10-23T09:00:00.000Z'));
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('NOT_YET_TAKEN');
  });

  it('every request folds to a balance that adds up', () => {
    const { request, entries } = requested();
    const ledger = [...entries];
    ledger.push(...must(request.approve({ by: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx)));
    ledger.push(
      ...must(
        request.shorten(
          { to: date('2026-10-22'), endsHalfDay: true, workingDays: DayAmount.parse('3.500') },
          ctx,
        ),
      ),
    );
    ledger.push(...must(request.markTaken(after)));
    expect(balanceOn(ledger, date('2026-10-31'))).toMatchObject({
      left: '-3.500',
      used: '3.500',
      booked: '0.000',
    });
  });
});

describe('refused transitions', () => {
  const ALL: RequestStatus[] = [
    'pending',
    'approved',
    'declined',
    'withdrawn',
    'counter_proposed',
    'change_pending',
    'cancelled',
    'taken',
  ];
  const later = span('2026-11-02', '2026-11-06', '5.000');
  const attempts: Record<
    string,
    { from: RequestStatus[]; run: (r: LeaveRequest) => ReturnType<LeaveRequest['cancel']> }
  > = {
    approve: {
      from: ['pending'],
      run: (r) => r.approve({ by: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx),
    },
    decline: { from: ['pending'], run: (r) => r.decline({ by: MARCO_ACCOUNT, reason: null }, ctx) },
    withdraw: { from: ['pending', 'counter_proposed'], run: (r) => r.withdraw(ctx) },
    counterPropose: {
      from: ['pending'],
      run: (r) =>
        r.counterPropose(
          { by: MARCO_ACCOUNT, proposals: [option('5.000', ['2026-11-02', '2026-11-06'])] },
          ctx,
        ),
    },
    acceptCounter: {
      from: ['counter_proposed'],
      run: (r) => r.acceptCounter({ index: 0, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx),
    },
    keepOwnDates: { from: ['counter_proposed'], run: (r) => r.keepOwnDates(ctx) },
    requestChange: { from: ['approved'], run: (r) => r.requestChange({ span: later }, ctx) },
    approveChange: { from: ['change_pending'], run: (r) => r.approveChange(ctx) },
    declineChange: { from: ['change_pending'], run: (r) => r.declineChange(ctx) },
    shorten: {
      from: ['approved'],
      run: (r) =>
        r.shorten(
          { to: date('2026-10-21'), endsHalfDay: false, workingDays: DayAmount.parse('3.000') },
          ctx,
        ),
    },
    cancel: { from: ['approved', 'change_pending'], run: (r) => r.cancel(ctx) },
    markTaken: { from: ['approved'], run: (r) => r.markTaken(after) },
  };
  const cases = Object.entries(attempts).flatMap(([name, { from, run }]) =>
    ALL.filter((s) => !from.includes(s)).map((status) => [name, status, run] as const),
  );

  it.each(cases)('%s from %s is refused and changes nothing', (_name, status, run) => {
    const request = inState(status);
    const result = run(request);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.error.code).toBe('INVALID_TRANSITION');
    expect(request.status).toBe(status);
    expect(request.drainEvents()).toEqual([]);
  });
});

describe('LeaveRequest.rehydrate', () => {
  it('comes back from its snapshot as it was, and carries on from its version', () => {
    const { request } = requested();
    must(
      request.counterPropose(
        {
          by: MARCO_ACCOUNT,
          proposals: [option('4.000', ['2026-10-19', '2026-10-20'], ['2026-10-22', '2026-10-23'])],
        },
        ctx,
      ),
    );
    request.drainEvents();

    const back = LeaveRequest.rehydrate(request.snapshot);
    expect(back.snapshot).toEqual(request.snapshot);
    expect(back.version).toBe(2);
    expect(back.drainEvents()).toEqual([]);

    must(back.acceptCounter({ index: 0, approvedBy: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    expect(back.spans).toEqual([
      { from: date('2026-10-19'), to: date('2026-10-20') },
      { from: date('2026-10-22'), to: date('2026-10-23') },
    ]);
    const events = back.drainEvents();
    expect(events.map((e) => [e.eventName, e.aggregate.version])).toEqual([
      [LeaveChanged.name, 3],
      [LeaveApproved.name, 4],
    ]);
    // The change supersedes the event that set the dates before it.
    expect((events[0]?.payload as { supersedes: string }).supersedes).toBe(
      request.snapshot.datesEventId,
    );
  });

  it('keeps a pending change and the sick note reference', () => {
    const { request } = requested({ sickNoteFileId: 'f0000000-0000-4000-8000-000000000001' });
    must(request.approve({ by: MARCO_ACCOUNT, jurisdiction: 'ES' }, ctx));
    must(request.requestChange({ span: span('2026-11-02', '2026-11-06', '5.000') }, ctx));
    const back = LeaveRequest.rehydrate(request.snapshot);
    expect(back.status).toBe('change_pending');
    expect(back.pendingChange).toEqual(span('2026-11-02', '2026-11-06', '5.000'));
    expect(back.sickNoteFileId).toBe('f0000000-0000-4000-8000-000000000001');
    expect(must(back.declineChange(ctx))).toEqual([]);
    expect(back.status).toBe('approved');
  });
});
