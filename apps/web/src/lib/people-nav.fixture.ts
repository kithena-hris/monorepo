import type { Place } from './remotes';

/**
 * People's places as its manifest lists them (`people/public/routes.json`),
 * for the host's tests: six sections, two of them umbrella pages with tabs,
 * and adding somebody as an action. A copy, so a test of the host's logic
 * does not move when the remote's copy changes its wording.
 */
export const PEOPLE_NAV: { readonly sections: Place[]; readonly actions: Place[] } = {
  sections: [
    {
      path: '/people',
      label: 'Overview',
      icon: 'overview',
      description: 'Summary, your tasks, and what needs HR',
      summary: 'Your tasks and what needs HR',
    },
    {
      path: '/people/directory/list',
      label: 'Directory',
      icon: 'people',
      description: 'Everyone as a list, as cards, or as an org chart',
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
      path: '/people/approvals',
      label: 'Approvals',
      icon: 'approve',
      description: 'Changes waiting for a decision',
      summary: 'Changes waiting for a decision',
    },
    {
      path: '/people/data-health/completeness',
      label: 'Data health',
      icon: 'health',
      for: ['hr', 'finance'],
      description: 'Gaps, ID checks, duplicates and access requests',
      summary: 'Gaps, ID checks, duplicates',
      tabs: [
        { path: '/people/data-health/completeness', label: 'Completeness', for: ['hr'] },
        { path: '/people/data-health/id-checks', label: 'ID checks', for: ['hr'] },
        { path: '/people/data-health/duplicates', label: 'Duplicates', for: ['hr'] },
        {
          path: '/people/data-health/access-requests',
          label: 'Access requests',
          for: ['finance', 'hr'],
        },
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
      path: '/people/insights/headcount',
      label: 'Insights',
      icon: 'analytics',
      for: ['hr'],
      description: 'Analytics, with scheduled reports built in',
      summary: 'Analytics and reports',
      owns: ['/people/reports', '/people/reports/:id'],
      tabs: [
        { path: '/people/insights/headcount', label: 'Headcount' },
        { path: '/people/insights/turnover', label: 'Turnover' },
        { path: '/people/insights/data-quality', label: 'Data quality' },
        { path: '/people/insights/pay', label: 'Pay & diversity' },
      ],
    },
  ],
  actions: [{ path: '/people/new', label: 'Add person', icon: 'hire', for: ['hr'] }],
};

export const HR = { hr: true, admin: false, finance: false } as const;
export const FINANCE = { hr: false, admin: false, finance: true } as const;
export const EMPLOYEE = { hr: false, admin: false, finance: false } as const;
