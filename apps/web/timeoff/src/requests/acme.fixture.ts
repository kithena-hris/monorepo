import type { RequestDetailData, RequestItem, RequestsData } from './requests';

/**
 * Adam's requests at Acme on Thursday 1 October 2026
 * (`services/timeoff/src/seed/acme.ts`): 19–23 October sent this morning
 * and waiting for Marco, 10–12 November approved, and his year behind him.
 */

const span = (from: string, to: string, endsHalfDay = false) => ({
  from,
  to,
  startsHalfDay: false,
  endsHalfDay,
});

const item = (
  n: number,
  type: 'vacation' | 'personal',
  from: string,
  to: string,
  workingDays: string,
  status: string,
  requestedAt: string,
): RequestItem => ({
  requestId: `0199a000-0000-7000-8000-0000000000${String(n).padStart(2, '0')}`,
  displayName: 'Adam Novak',
  leaveTypeKey: type,
  leaveTypeName: type === 'vacation' ? 'Vacation' : 'Personal day',
  category: type === 'vacation' ? 'annual_leave' : 'other',
  status,
  span: span(from, to, workingDays === '0.500'),
  workingDays,
  requestedAt,
  waitingOn: status === 'pending' ? 'manager' : null,
});

export const october = item(
  20,
  'vacation',
  '2026-10-19',
  '2026-10-23',
  '5.000',
  'pending',
  '2026-10-01T09:12:00.000Z',
);
export const november = item(
  11,
  'vacation',
  '2026-11-10',
  '2026-11-12',
  '3.000',
  'approved',
  '2026-09-21T08:00:00.000Z',
);

const detail = (request: RequestItem): RequestDetailData => ({
  request,
  note: null,
  pendingChange: null,
  proposals: [],
  chain: ['manager'],
  step: 0,
  escalated: false,
  mine: true,
  canChange: request.status === 'approved',
  canCancel: ['pending', 'approved', 'counter_proposed', 'change_pending'].includes(request.status),
  canAnswer: false,
});

/** T6, Upcoming: October waiting for Marco on show beside November. */
export const upcoming = (): RequestsData => ({
  tab: 'upcoming',
  items: [october, november],
  selected: { ...detail(october), note: 'Back for the release on the 26th' },
  single: false,
  today: '2026-10-01',
});

/** MT10: November, approved, at its own address. */
export const approved = (): RequestsData => ({
  ...upcoming(),
  selected: detail(november),
  single: true,
});

/** Marco suggested 26–30 October instead of 19–23 (T18), which Adam can take in one tap. */
export const suggested = (): RequestsData => {
  const request = { ...october, status: 'counter_proposed', waitingOn: null };
  return {
    ...upcoming(),
    items: [request, november],
    selected: {
      ...detail(request),
      canAnswer: true,
      proposals: [
        { index: 0, spans: [{ from: '2026-10-26', to: '2026-10-30' }], workingDays: '5.000' },
      ],
      proposalMessage:
        'Hi Adam, could you take 26–30 Oct instead? Omar and Yuki are out on the day you asked. Happy to approve straight away if that works.',
    },
  };
};

/** Past: what he took this year, latest first. */
export const past = (): RequestsData => {
  const items = [
    item(4, 'personal', '2026-09-04', '2026-09-04', '1.000', 'taken', '2026-08-28T08:00:00.000Z'),
    item(3, 'vacation', '2026-08-03', '2026-08-07', '5.000', 'taken', '2026-06-01T08:00:00.000Z'),
    item(2, 'vacation', '2026-07-10', '2026-07-10', '0.500', 'taken', '2026-06-15T08:00:00.000Z'),
    item(1, 'vacation', '2026-02-16', '2026-02-20', '5.000', 'taken', '2026-01-19T08:00:00.000Z'),
  ];
  return {
    tab: 'past',
    items,
    selected: items[0] === undefined ? null : detail(items[0]),
    single: false,
    today: '2026-10-01',
  };
};
