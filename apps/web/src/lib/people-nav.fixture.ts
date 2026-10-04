import type { Place } from './remotes';

/**
 * People's places as its manifest lists them (`people/public/routes.json`),
 * for the host's tests: four sections, two of them umbrella pages with tabs,
 * and adding somebody as an action. A copy, so a test of the host's logic
 * does not move when the remote's copy changes its wording.
 */
export const PEOPLE_NAV: { readonly sections: Place[]; readonly actions: Place[] } = {
  sections: [
    {
      path: '/people/directory/list',
      label: 'Directory',
      icon: 'people',
      description: 'Everyone, as a list, cards or an org chart',
      summary: 'List, cards or org chart',
      owns: [
        '/people/directory/cards',
        '/people/directory/org-chart',
        '/people/:id',
        '/people/:id/history',
        '/people/bulk-edit',
      ],
    },
    {
      path: '/people/review/waiting',
      label: 'Review',
      icon: 'approve',
      description: 'Every decision and missing detail, in one queue',
      summary: 'Every decision, in one queue',
      tabs: [
        {
          path: '/people/review/waiting',
          label: 'Waiting',
          labelFor: { hr: 'Waiting for me', finance: 'Your requests' },
        },
        { path: '/people/review/flagged', label: 'Flagged', for: ['hr'] },
        { path: '/people/review/asked', label: 'I asked', for: ['hr'] },
        { path: '/people/review/decided', label: 'Decided' },
      ],
    },
    {
      path: '/people/import-export',
      label: 'Import & export',
      icon: 'transfer',
      description: 'Move people data in and out, with one history',
      summary: 'Move data in and out',
      owns: ['/people/import', '/people/export'],
    },
    {
      path: '/people/insights/what-changed',
      label: 'Insights',
      icon: 'analytics',
      for: ['hr'],
      description: 'Analytics, with scheduled reports built in',
      summary: 'Analytics and reports',
      owns: ['/people/reports', '/people/reports/:id'],
      tabs: [
        { path: '/people/insights/what-changed', label: 'What changed' },
        { path: '/people/insights/headcount', label: 'Headcount' },
        { path: '/people/insights/turnover', label: 'Turnover' },
        { path: '/people/insights/data-quality', label: 'Data quality', short: 'Quality' },
        { path: '/people/insights/pay', label: 'Pay & diversity', short: 'Pay' },
      ],
    },
  ],
  actions: [{ path: '/people/new', label: 'Add person', icon: 'hire', for: ['hr'] }],
};

export const HR = { hr: true, admin: false, finance: false } as const;
export const FINANCE = { hr: false, admin: false, finance: true } as const;
export const EMPLOYEE = { hr: false, admin: false, finance: false } as const;
