/**
 * Shared chart fixtures.
 *
 * Deterministic on purpose: `Math.random()` in a story means the visual
 * regression run diffs against a different chart every time, and a docs page
 * that changes on every load teaches nobody what the component does.
 */

import type { ChartPoint } from '../components/chart/chart';
import type { TimelineRow } from '../components/chart/timeline-chart';
import type { OrgNode } from '../components/org-chart/org-chart';

export const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'] as const;

export const headcount: ChartPoint[] = [
  { label: 'Feb', value: 842 },
  { label: 'Mar', value: 858 },
  { label: 'Apr', value: 861 },
  { label: 'May', value: 874 },
  { label: 'Jun', value: 889 },
  { label: 'Jul', value: 902 },
  { label: 'Aug', value: 912 },
];

export const leavers: ChartPoint[] = [
  { label: 'Feb', value: 11 },
  { label: 'Mar', value: 9 },
  { label: 'Apr', value: 14 },
  { label: 'May', value: 8 },
  { label: 'Jun', value: 12 },
  { label: 'Jul', value: 7 },
  { label: 'Aug', value: 6 },
];

export const byDepartment: ChartPoint[] = [
  { label: 'Engineering', value: 312 },
  { label: 'Sales', value: 208 },
  { label: 'Customer Support', value: 141 },
  { label: 'People Operations', value: 46 },
  { label: 'Finance', value: 38 },
  { label: 'Legal & Compliance', value: 17 },
  { label: 'Facilities', value: 12 },
];

export const byStatus: ChartPoint[] = [
  { label: 'Active', value: 842 },
  { label: 'On leave', value: 46 },
  { label: 'Notice period', value: 17 },
  { label: 'Probation', value: 7 },
];

export const pipeline: ChartPoint[] = [
  { label: 'Applied', value: 1284 },
  { label: 'Screened', value: 412 },
  { label: 'Interviewed', value: 148 },
  { label: 'Onsite', value: 52 },
  { label: 'Offer', value: 24 },
  { label: 'Hired', value: 18 },
];

export const teams = ['Platform', 'Payroll', 'People Ops', 'Support'] as const;

export const leaveTypeByTeam = [
  { label: 'Annual', values: [186, 94, 62, 148] },
  { label: 'Sick', values: [42, 21, 18, 61] },
  { label: 'Parental', values: [28, 12, 9, 16] },
  { label: 'Unpaid', values: [9, 4, 3, 12] },
];

/** Absence by person by week, the classic heatmap shape. */
export const absence = (() => {
  const people = [
    'Grace Hopper',
    'Ada Lovelace',
    'Radia Perlman',
    'Barbara Liskov',
    'Katherine Johnson',
    'Margaret Hamilton',
  ];
  const weeks = Array.from({ length: 12 }, (_, index) => `W${String(index + 27)}`);
  const cells = people.flatMap((row, rowIndex) =>
    weeks.map((column, columnIndex) => ({
      row,
      column,
      // A fixed pattern rather than randomness, chosen to have a visible
      // August cluster, the shape a reader is meant to notice.
      value: (rowIndex * 3 + columnIndex * 5) % 7 === 0 ? ((rowIndex + columnIndex) % 5) + 1 : 0,
    })),
  );
  return { people, weeks, cells };
})();

/**
 * A fixed "today" for the timeline stories.
 *
 * A literal, not `new Date()`: a story that reads the clock renders a
 * different picture every day, which makes a visual diff meaningless and a
 * docs page impossible to describe in prose.
 */
export const today = '2026-03-16';

/** An onboarding plan, the shape a Gantt is actually used for here. */
export const onboarding: TimelineRow[] = [
  {
    label: 'Amara Osei',
    meta: 'Backend Engineer · starts 2 Mar',
    items: [
      { id: 'osei-offer', label: 'Offer accepted', start: '2026-02-16', tone: 'info' },
      {
        id: 'osei-pre',
        label: 'Pre-boarding',
        start: '2026-02-17',
        end: '2026-03-01',
        tone: 'info',
        progress: 1,
      },
      {
        id: 'osei-week1',
        label: 'Orientation',
        start: '2026-03-02',
        end: '2026-03-13',
        tone: 'accent',
        progress: 1,
      },
      {
        id: 'osei-ramp',
        label: 'Ramp-up',
        start: '2026-03-16',
        end: '2026-04-24',
        tone: 'accent',
        progress: 0.15,
      },
      { id: 'osei-probation', label: 'Probation review', start: '2026-05-29', tone: 'warning' },
    ],
  },
  {
    label: 'Ben Halvorsen',
    meta: 'Payroll Specialist · starts 16 Mar',
    items: [
      { id: 'halv-offer', label: 'Offer accepted', start: '2026-02-27', tone: 'info' },
      {
        id: 'halv-pre',
        label: 'Pre-boarding',
        start: '2026-03-02',
        end: '2026-03-13',
        tone: 'info',
        progress: 0.8,
      },
      {
        id: 'halv-week1',
        label: 'Orientation',
        start: '2026-03-16',
        end: '2026-03-27',
        tone: 'accent',
        progress: 0,
      },
      {
        id: 'halv-ramp',
        label: 'Ramp-up',
        start: '2026-03-30',
        end: '2026-05-08',
        tone: 'accent',
      },
    ],
  },
  {
    label: 'Chidi Nwosu',
    meta: 'Support Lead · starts 6 Apr',
    items: [
      { id: 'nwosu-offer', label: 'Offer sent', start: '2026-03-09', tone: 'warning' },
      {
        id: 'nwosu-pre',
        label: 'Pre-boarding',
        start: '2026-03-23',
        end: '2026-04-03',
        tone: 'info',
      },
      {
        id: 'nwosu-week1',
        label: 'Orientation',
        start: '2026-04-06',
        end: '2026-04-17',
        tone: 'accent',
      },
      {
        id: 'nwosu-ramp',
        label: 'Ramp-up',
        start: '2026-04-20',
        end: '2026-06-05',
        tone: 'accent',
      },
    ],
  },
  {
    label: 'Dana Whitfield',
    meta: 'Recruiter · notice period',
    items: [
      { id: 'whit-notice', label: 'Notice served', start: '2026-03-02', tone: 'danger' },
      {
        id: 'whit-handover',
        label: 'Handover',
        start: '2026-03-09',
        end: '2026-04-10',
        tone: 'danger',
        progress: 0.35,
      },
      { id: 'whit-last', label: 'Last day', start: '2026-04-10', tone: 'danger', locked: true },
    ],
  },
];

/** Leave cover across one quarter, the same component, a different question. */
export const leaveCover: TimelineRow[] = [
  {
    label: 'Platform',
    meta: '9 engineers',
    items: [
      { id: 'cover-p1', label: 'G. Hopper: annual', start: '2026-03-02', end: '2026-03-13' },
      {
        id: 'cover-p2',
        label: 'R. Perlman: parental',
        start: '2026-03-16',
        end: '2026-06-05',
        tone: 'info',
      },
    ],
  },
  {
    label: 'Payroll',
    meta: '4 specialists',
    items: [
      {
        id: 'cover-y1',
        label: 'A. Lovelace: annual',
        start: '2026-03-23',
        end: '2026-04-03',
        tone: 'warning',
      },
      {
        id: 'cover-y2',
        label: 'B. Liskov: annual',
        start: '2026-03-30',
        end: '2026-04-10',
        tone: 'warning',
      },
    ],
  },
  {
    label: 'Support',
    meta: '21 agents',
    items: [
      { id: 'cover-s1', label: 'K. Johnson: sick', start: '2026-03-09', end: '2026-03-20' },
      { id: 'cover-s2', label: 'M. Hamilton: annual', start: '2026-04-13', end: '2026-05-01' },
    ],
  },
];

/**
 * A profile picture, generated rather than fetched.
 *
 * A data URI keeps the stories offline and deterministic: a remote avatar
 * service makes the docs depend on someone else's uptime, and it makes an
 * accessibility run fail for a reason that has nothing to do with the code.
 * Real callers pass a real URL.
 */
function avatar(initials: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="hsl(${String(hue)} 62% 46%)"/>
    <circle cx="32" cy="25" r="11" fill="hsl(${String(hue)} 60% 88%)"/>
    <path d="M8 64c0-14 11-22 24-22s24 8 24 22z" fill="hsl(${String(hue)} 60% 88%)"/>
    <text x="32" y="58" font-family="sans-serif" font-size="11" font-weight="600"
      text-anchor="middle" fill="hsl(${String(hue)} 62% 30%)">${initials}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A reporting line, flat with `parentId`, the shape a query returns.
 *
 * Deliberately lumpy: a chief with three very different span-of-controls, one
 * branch four levels deep, a vacancy, someone on leave, someone serving
 * notice, and a locked row. A tidy symmetrical org proves nothing.
 */
export const reportingLine: OrgNode[] = [
  {
    id: 'ceo',
    name: 'Grace Hopper',
    title: 'Chief Executive',
    meta: 'Boston · Board',
    tone: 'accent',
    avatarUrl: avatar('GH', 244),
    locked: true,
  },

  // Technology, the deep branch.
  {
    id: 'cto',
    name: 'Radia Perlman',
    title: 'Chief Technology Officer',
    meta: 'Boston',
    parentId: 'ceo',
    tone: 'info',
    avatarUrl: avatar('RP', 204),
  },
  {
    id: 'vp-platform',
    name: 'Barbara Liskov',
    title: 'VP Platform',
    meta: '31 engineers',
    parentId: 'cto',
    tone: 'info',
    avatarUrl: avatar('BL', 200),
  },
  {
    id: 'em-core',
    name: 'Alan Kay',
    title: 'Engineering Manager, Core',
    meta: 'Boston',
    parentId: 'vp-platform',
    avatarUrl: avatar('AK', 190),
  },
  {
    id: 'eng-core-1',
    name: 'Jean Bartik',
    title: 'Staff Engineer',
    parentId: 'em-core',
    avatarUrl: avatar('JB', 186),
  },
  {
    id: 'eng-core-2',
    name: 'Adele Goldberg',
    title: 'Senior Engineer',
    parentId: 'em-core',
    avatarUrl: avatar('AG', 178),
  },
  {
    id: 'eng-core-3',
    name: 'Sophie Wilson',
    title: 'Engineer',
    parentId: 'em-core',
    status: 'On leave',
    statusTone: 'info',
    avatarUrl: avatar('SW', 170),
  },
  {
    id: 'em-data',
    name: 'Karen Spärck Jones',
    title: 'Engineering Manager, Data',
    meta: 'Remote · UK',
    parentId: 'vp-platform',
    avatarUrl: avatar('KJ', 162),
  },
  {
    id: 'eng-data-1',
    name: 'Erna Hoover',
    title: 'Senior Data Engineer',
    parentId: 'em-data',
    avatarUrl: avatar('EH', 154),
  },
  {
    id: 'eng-data-2',
    name: 'Vacant. Data Engineer',
    title: 'Open requisition',
    meta: 'Approved 14 Jul',
    parentId: 'em-data',
    tone: 'warning',
    status: 'Open req',
    statusTone: 'warning',
  },
  {
    id: 'vp-product-eng',
    name: 'Margaret Hamilton',
    title: 'VP Product Engineering',
    meta: '44 engineers',
    parentId: 'cto',
    tone: 'info',
    avatarUrl: avatar('MH', 214),
  },
  {
    id: 'em-web',
    name: 'Anita Borg',
    title: 'Engineering Manager, Web',
    parentId: 'vp-product-eng',
    avatarUrl: avatar('AB', 222),
  },
  {
    id: 'em-mobile',
    name: 'Frances Allen',
    title: 'Engineering Manager, Mobile',
    parentId: 'vp-product-eng',
    avatarUrl: avatar('FA', 230),
  },
  {
    id: 'eng-mobile-1',
    name: 'Carol Shaw',
    title: 'Senior Engineer',
    parentId: 'em-mobile',
    avatarUrl: avatar('CS', 238),
  },

  // People, the wide branch.
  {
    id: 'cpo',
    name: 'Katherine Johnson',
    title: 'Chief People Officer',
    meta: 'Remote · US',
    parentId: 'ceo',
    tone: 'success',
    avatarUrl: avatar('KJ', 146),
  },
  {
    id: 'head-people-ops',
    name: 'Mary Jackson',
    title: 'Head of People Operations',
    parentId: 'cpo',
    tone: 'success',
    avatarUrl: avatar('MJ', 138),
  },
  {
    id: 'people-ops-1',
    name: 'Evelyn Boyd Granville',
    title: 'People Operations Partner',
    parentId: 'head-people-ops',
    avatarUrl: avatar('EG', 130),
  },
  {
    id: 'people-ops-2',
    name: 'Melba Roy Mouton',
    title: 'People Operations Partner',
    meta: 'EMEA',
    parentId: 'head-people-ops',
    avatarUrl: avatar('MM', 122),
  },
  {
    id: 'head-talent',
    name: 'Dorothy Vaughan',
    title: 'Head of Talent',
    parentId: 'cpo',
    tone: 'success',
    avatarUrl: avatar('DV', 114),
  },
  {
    id: 'talent-1',
    name: 'Dana Whitfield',
    title: 'Recruiter',
    parentId: 'head-talent',
    status: 'Notice period',
    statusTone: 'danger',
    avatarUrl: avatar('DW', 8),
  },
  {
    id: 'talent-2',
    name: 'Chidi Nwosu',
    title: 'Recruiter',
    meta: 'Starts 6 Apr',
    parentId: 'head-talent',
    avatarUrl: avatar('CN', 26),
  },

  // Finance, the shallow branch.
  {
    id: 'cfo',
    name: 'Ada Lovelace',
    title: 'Chief Financial Officer',
    meta: 'London',
    parentId: 'ceo',
    tone: 'warning',
    avatarUrl: avatar('AL', 44),
  },
  {
    id: 'payroll',
    name: 'Annie Easley',
    title: 'Payroll Manager',
    meta: '4 specialists',
    parentId: 'cfo',
    tone: 'warning',
    avatarUrl: avatar('AE', 36),
  },
  {
    id: 'payroll-1',
    name: 'Ben Halvorsen',
    title: 'Payroll Specialist',
    parentId: 'payroll',
    avatarUrl: avatar('BH', 28),
  },
];
