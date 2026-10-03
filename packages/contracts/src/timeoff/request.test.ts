import { describe, expect, expectTypeOf, it } from 'vitest';

import { PunchInput } from './attendance.js';
import { LedgerEntryKind } from './ledger.js';
import {
  ApproverRequestView,
  LeaveRequestInput,
  LeaveRequestView,
  TeammateRequestView,
} from './request.js';

/**
 * Who sees what of a request (PRD §8.5, MT14). Teammates see "Off" for sick
 * days; the type and the reason stay with the manager and HR, and the sick
 * note with the member and HR.
 */
type OffView = Extract<TeammateRequestView, { shows: 'off' }>;

const sickRequest = {
  requestId: '00000000-0000-4000-8000-000000000010',
  personId: '00000000-0000-4000-8000-000000000011',
  span: { from: '2026-10-19', to: '2026-10-20' },
  status: 'approved',
  leaveTypeKey: 'sick',
  category: 'sick_leave',
  workingDays: '2.000',
  daysAway: '2.000',
  note: 'Flu, back Wednesday',
  notePresent: true,
  requestedAt: '2026-10-19T07:30:00.000Z',
  sickNoteFileId: '00000000-0000-4000-8000-000000000012',
};

describe('the teammate view of a sick request', () => {
  it('has no type and no note, as a type', () => {
    expectTypeOf<OffView>().not.toHaveProperty('leaveTypeKey');
    expectTypeOf<OffView>().not.toHaveProperty('category');
    expectTypeOf<OffView>().not.toHaveProperty('note');
    expectTypeOf<OffView>().not.toHaveProperty('sickNoteFileId');
    expectTypeOf<TeammateRequestView>().not.toHaveProperty('note');
  });

  it('drops them at runtime too, when the full record is read through it', () => {
    const parsed = TeammateRequestView.parse({ ...sickRequest, shows: 'off' });
    expect(Object.keys(parsed).toSorted()).toEqual(
      ['personId', 'requestId', 'shows', 'span', 'status'].toSorted(),
    );
  });
});

describe('the sick note', () => {
  it('is in the member-and-HR view and not in the approver view', () => {
    expectTypeOf<LeaveRequestView>().toHaveProperty('sickNoteFileId');
    expectTypeOf<ApproverRequestView>().not.toHaveProperty('sickNoteFileId');
    expect(ApproverRequestView.parse(sickRequest)).not.toHaveProperty('sickNoteFileId');
    expect(LeaveRequestView.parse(sickRequest).sickNoteFileId).toBe(sickRequest.sickNoteFileId);
  });
});

describe('a request input', () => {
  it('refuses dates that end before they start', () => {
    expect(
      LeaveRequestInput.safeParse({
        leaveTypeKey: 'vacation',
        span: { from: '2026-10-16', to: '2026-10-13' },
      }).success,
    ).toBe(false);
  });
});

describe('the ledger', () => {
  it('has the kinds of PRD §7.1', () => {
    expect(LedgerEntryKind.options).toHaveLength(10);
  });
});

describe('a punch input', () => {
  it('refuses coordinates rather than storing them', () => {
    const punch = { kind: 'in', source: 'mobile', workModel: 'office' };
    expect(PunchInput.safeParse(punch).success).toBe(true);
    expect(PunchInput.safeParse({ ...punch, latitude: 40.4, longitude: -3.7 }).success).toBe(false);
  });
});
