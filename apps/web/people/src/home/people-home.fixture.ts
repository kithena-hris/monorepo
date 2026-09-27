import type { PeopleHomeState } from './people-home';

/** An overview as People answers it, for the tests: Ada, her line, and what waits for her. */

export const ADA = '00000000-0000-4000-8000-0000000000a3';

export const nobody = (roles: Partial<PeopleHomeState['roles']> = {}): PeopleHomeState => ({
  roles: { hr: false, admin: false, finance: false, ...roles },
  now: '2026-09-27T09:30:00.000Z',
  me: null,
  reportingLine: null,
  approvals: null,
  missing: [],
  team: null,
});

export const overview = (over: Partial<PeopleHomeState> = {}): PeopleHomeState => ({
  ...nobody({ hr: true }),
  me: {
    id: ADA,
    name: 'Ada Lovelace',
    avatarUrl: null,
    title: 'Engineer',
    department: 'Research',
    email: 'ada@acme.example',
    phone: '+34 600 000 000',
    location: 'Madrid office',
    timeZone: 'Europe/Madrid',
    startedOn: '2024-03-04',
    today: '2026-09-27',
    status: 'active',
    missing: 2,
    required: 7,
  },
  reportingLine: {
    managers: [
      { id: '00000000-0000-4000-8000-0000000000a2', name: 'Alan Turing', title: 'VP Engineering', avatarUrl: null },
      { id: '00000000-0000-4000-8000-0000000000a1', name: 'Grace Hopper', title: 'Chief Executive', avatarUrl: null },
    ],
    moreAbove: false,
    peers: 3,
    reports: [
      { id: '00000000-0000-4000-8000-0000000000a5', name: 'Tim Berners-Lee', title: 'Engineer', avatarUrl: null },
      { id: '00000000-0000-4000-8000-0000000000a6', name: 'Edsger Dijkstra', title: null, avatarUrl: null },
    ],
    reportsTotal: 8,
    reportsFilter: `manager_id:${ADA}`,
  },
  approvals: {
    isHr: true,
    total: 7,
    items: [
      {
        id: 'c1',
        personId: '00000000-0000-4000-8000-0000000000a5',
        name: 'Tim Berners-Lee',
        avatarUrl: null,
        label: 'Bank account',
        requestedAt: '2026-09-24T08:00:00.000Z',
        requestedBy: 'Tim Berners-Lee',
      },
    ],
  },
  missing: [
    { key: 'emergency_contact', label: 'Emergency contact', sectionKey: 'personal', section: 'Personal information', ownedBy: null },
    { key: 'cost_centre', label: 'Cost centre', sectionKey: 'employment', section: 'Employment', ownedBy: 'HR' },
  ],
  team: { waiting: 4, toFill: 11 },
  ...over,
});
