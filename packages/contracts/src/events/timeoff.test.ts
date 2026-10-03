import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import {
  AttendancePunched,
  LeaveCounterProposed,
  LeaveRequested,
  LeaveRequestedV1,
  readLeaveRequested,
  timeoffEvents,
} from './timeoff.js';

/**
 * Time Off's events (PRD §13).
 *
 * The property that matters most is a negative one: no Time Off payload has a
 * field that could carry a coordinate or the body of a sick note. A punch
 * stores the derived work model and never where the phone was (§11.2); a sick
 * note leaves the aggregate only as `notePresent` (§8.5).
 */

/** Every property name reachable inside a schema, through wrappers, arrays and unions. */
function keysOf(schema: z.ZodType, out = new Set<string>()): Set<string> {
  if (schema instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(schema.shape)) {
      out.add(key);
      if (child instanceof z.ZodType) keysOf(child, out);
    }
  } else if (schema instanceof z.ZodArray) {
    if (schema.element instanceof z.ZodType) keysOf(schema.element, out);
  } else if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) if (option instanceof z.ZodType) keysOf(option, out);
  } else if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodReadonly
  ) {
    const inner = schema.unwrap();
    if (inner instanceof z.ZodType) keysOf(inner, out);
  }
  return out;
}

/** A coordinate under any name a hurried developer might give it, or a note's text. */
const FORBIDDEN = /lat|lon|lng|coord|geo|gps|medical|diagnos|note(?!Present$)|body/iu;

describe('no Time Off payload can hold a coordinate or a sick note body', () => {
  it.each(timeoffEvents.map((event) => [event.name, event] as const))('%s', (_name, event) => {
    const keys = [...keysOf(event.payload)];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => FORBIDDEN.test(key))).toEqual([]);
  });

  it('the walk would have caught the field the v1 request carried', () => {
    // A negative control: without it a walk that matched nothing would pass.
    expect([...keysOf(LeaveRequestedV1.payload)].filter((key) => FORBIDDEN.test(key))).toEqual([
      'medicalNote',
    ]);
  });

  it('drops a coordinate a producer tries to smuggle into a punch', () => {
    const parsed = AttendancePunched.payload.parse({
      punchId: '00000000-0000-4000-8000-000000000020',
      personId: '00000000-0000-4000-8000-000000000011',
      at: '2026-10-19T08:58:00.000Z',
      kind: 'in',
      source: 'mobile',
      workModel: 'office',
      deviceId: null,
      insideOfficeArea: true,
      latitude: 40.4168,
      longitude: -3.7038,
    });
    expect(parsed).not.toHaveProperty('latitude');
    expect(parsed).not.toHaveProperty('longitude');
  });
});

describe('LeaveRequested v2', () => {
  it('carries the tenant leave type, half days and the working-day cost', () => {
    expect(LeaveRequested.version).toBe(2);
    const keys = keysOf(LeaveRequested.payload);
    for (const key of ['leaveTypeKey', 'category', 'startsHalfDay', 'endsHalfDay', 'workingDays']) {
      expect(keys).toContain(key);
    }
  });

  it('is in the published list once, without v1', () => {
    const requested = timeoffEvents.filter((event) => event.name === 'timeoff.request.requested');
    expect(requested.map((event) => event.version)).toEqual([2]);
  });
});

describe('the v1 upcaster', () => {
  const v1 = {
    eventId: '01890000-0000-7000-8000-000000000000',
    eventName: 'timeoff.request.requested',
    eventVersion: 1,
    tenantId: '00000000-0000-4000-8000-000000000001',
    occurredAt: '2026-03-02T08:00:00.000Z',
    recordedAt: '2026-03-02T08:00:01.000Z',
    effectiveFrom: '2026-03-02',
    aggregate: { type: 'LeaveRequest', id: '00000000-0000-4000-8000-000000000010', version: 1 },
    actor: { kind: 'system', process: 'contract-test' },
    correlationId: '00000000-0000-4000-8000-000000000002',
    causationId: null,
    payload: {
      requestId: '00000000-0000-4000-8000-000000000010',
      personId: '00000000-0000-4000-8000-000000000011',
      kind: 'sick_leave',
      from: '2026-03-02',
      to: '2026-03-04',
      medicalNote: 'Influenza, three days',
    },
  };

  it('reads a v1 message as v2, keeping only whether a note existed', () => {
    const read = readLeaveRequested(v1);
    expect(read.eventVersion).toBe(2);
    expect(read.payload).toEqual({
      requestId: v1.payload.requestId,
      personId: v1.payload.personId,
      leaveTypeKey: 'sick',
      category: 'sick_leave',
      from: '2026-03-02',
      to: '2026-03-04',
      startsHalfDay: false,
      endsHalfDay: false,
      // v1 never recorded a cost, and an upcaster that guessed one would be
      // inventing payroll data.
      workingDays: null,
      // v1 refused anything over the balance, so no v1 request went below zero.
      belowZero: false,
      notePresent: true,
    });
    expect(JSON.stringify(read)).not.toContain('Influenza');
    expect(LeaveRequested.safeParse(read).success).toBe(true);
  });

  it('maps a public holiday, which a leave type cannot be, to other', () => {
    const read = readLeaveRequested({
      ...v1,
      payload: { ...v1.payload, kind: 'public_holiday', medicalNote: null },
    });
    expect(read.payload.category).toBe('other');
    expect(read.payload.notePresent).toBe(false);
  });

  it('passes a v2 message through and refuses a version it does not know', () => {
    const v2 = readLeaveRequested(v1);
    expect(readLeaveRequested(v2)).toEqual(v2);
    expect(() => readLeaveRequested({ ...v2, eventVersion: 3 })).toThrow();
  });
});

describe('a counter-proposal', () => {
  const base = {
    requestId: '0189aaaa-0000-7000-8000-000000000001',
    personId: '0189aaaa-0000-7000-8000-000000000002',
    proposedBy: '0189aaaa-0000-7000-8000-000000000003',
  };
  const option = (spans: { from: string; to: string }[]) => ({
    ...base,
    proposals: [{ spans, workingDays: '5.000' }],
  });

  it('carries a swap, which is not one range: 19, 20, 22, 23 and 26 Oct (T15, T18)', () => {
    const swap = option([
      { from: '2026-10-19', to: '2026-10-20' },
      { from: '2026-10-22', to: '2026-10-23' },
      { from: '2026-10-26', to: '2026-10-26' },
    ]);
    expect(LeaveCounterProposed.payload.safeParse(swap).success).toBe(true);
  });

  it.each([
    [
      'out of order',
      [
        { from: '2026-10-22', to: '2026-10-23' },
        { from: '2026-10-19', to: '2026-10-20' },
      ],
    ],
    [
      'overlapping',
      [
        { from: '2026-10-19', to: '2026-10-22' },
        { from: '2026-10-22', to: '2026-10-23' },
      ],
    ],
    ['backwards', [{ from: '2026-10-23', to: '2026-10-19' }]],
    ['empty', []],
  ])('refuses runs that are %s', (_what, spans) => {
    expect(LeaveCounterProposed.payload.safeParse(option(spans)).success).toBe(false);
  });
});
