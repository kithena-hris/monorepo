import type { FieldChangeView } from './field-change';

/** Start day, a text field becoming a date: two values convert, two do not. */
export const START_DAY: FieldChangeView = {
  field: {
    key: 'start_day',
    label: 'Start day',
    from: 'text',
    to: 'date',
    options: [],
    currency: null,
    encrypted: false,
  },
  needsReview: true,
  withValue: 5,
  dateOrder: 'dmy',
  converted: {
    count: 2,
    samples: [
      { before: '12/03/2024', after: '12 Mar 2024' },
      { before: '25.12.2023', after: '25 Dec 2023' },
    ],
  },
  unchanged: 1,
  unfit: [
    {
      personId: '00000000-0000-4000-8000-0000000000a2',
      name: 'Marco Rossi',
      before: 'when he starts',
      reason: 'Not a date',
    },
    {
      personId: '00000000-0000-4000-8000-0000000000a3',
      name: 'Grace Hopper',
      before: '31/02/2024',
      reason: 'Not a calendar date',
    },
  ],
  actions: ['edit', 'clear', 'request', 'hr', 'leave'],
  defaultAction: 'request',
  hidden: false,
  alsoPublished: 0,
  blockedBy: null,
};
