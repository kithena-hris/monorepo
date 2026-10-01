import type { SummaryDraft, WhatChangedState } from './what-changed';

/**
 * A month's summary as People sends it, for the screen's tests: the shape of
 * `application/screens/what-changed.ts`, its words People's own.
 */
export const SEPTEMBER: WhatChangedState = {
  asOf: '2026-10-01',
  period: {
    kind: 'month',
    from: '2026-09-01',
    to: '2026-09-30',
    partial: false,
    name: 'September',
    inWords: 'in September',
    compared: 'September 2026 compared with August',
  },
  title: 'September in three points',
  writtenAt: '08:00',
  minimum: 10,
  segment: null,
  segments: [],
  points: [
    {
      key: 'headcount',
      figure: '+14',
      text: 'Headcount grew from 398 to 412. 9 of the 14 joiners are in Engineering.',
      parts: [
        { text: 'Headcount grew from ', strong: false },
        { text: '398', strong: true },
        { text: ' to ', strong: false },
        { text: '412', strong: true },
        { text: '. ', strong: false },
        { text: '9', strong: true },
        { text: ' of the ', strong: false },
        { text: '14', strong: true },
        { text: ' joiners are in ', strong: false },
        { text: 'Engineering', strong: true },
        { text: '.', strong: false },
      ],
      sources: [
        { kind: 'joiners', label: '14 joiners', from: '2026-09-01', to: '2026-09-30' },
        { kind: 'group', label: 'Engineering', value: 'eng' },
      ],
      audience: null,
    },
    {
      key: 'leavers',
      figure: '3',
      text: '3 people left, all in Support, up from 1 the month before.',
      parts: [
        { text: '3', strong: true },
        { text: ' people left, all in ', strong: false },
        { text: 'Support', strong: true },
        { text: ', up from ', strong: false },
        { text: '1', strong: true },
        { text: ' the month before.', strong: false },
      ],
      sources: [
        { kind: 'turnover', label: 'Turnover' },
        { kind: 'group', label: 'Support', value: 'support' },
      ],
      audience: null,
    },
    {
      key: 'pay',
      figure: '1',
      text: '1 grade has a median above its band.',
      parts: [
        { text: '1', strong: true },
        { text: ' grade has a median above its band.', strong: false },
      ],
      sources: [{ kind: 'pay', label: 'Pay' }],
      audience: 'Finance only',
    },
  ],
  phrasable: false,
  headcount: {
    value: 412,
    change: 14,
    trend: [
      { label: 'Jul', value: 391 },
      { label: 'Aug', value: 398 },
      { label: 'Sep', value: 412 },
    ],
  },
  leavers: {
    categories: ['Support', 'Other teams'],
    series: [
      { label: 'Jul', values: [1, 0] },
      { label: 'Aug', values: [1, 1] },
      { label: 'Sep', values: [3, 0] },
    ],
  },
  recipients: [{ accountId: 'nora', name: 'Nora Becker' }],
  canSend: true,
};

/** The September summary rewritten for Nora, who sees no pay. */
export const FOR_NORA: SummaryDraft = {
  recipient: { accountId: 'nora', name: 'Nora Becker' },
  notes: [
    'Pay is left out, because Nora Becker can’t see pay in aggregate.',
    'Team names are kept, because Nora Becker can see them.',
  ],
  document: {
    company: 'Acme',
    title: 'What changed in September',
    preparedBy: 'Ada Lovelace',
    preparedOn: '1 Oct 2026',
    points: [
      {
        key: 'headcount',
        figure: '+14',
        text: 'Headcount grew from 398 to 412. 9 of the 14 joiners are in Engineering.',
        audience: null,
      },
      {
        key: 'leavers',
        figure: '3',
        text: '3 people left, all in Support, up from 1 the month before.',
        audience: null,
      },
    ],
    chart: null,
    madeLine: 'Written by Kithena from 412 records. Checked by Ada Lovelace.',
  },
};
