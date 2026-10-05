/**
 * What federation exposes to the browser: the same names as `index.ts`, each
 * screen in a chunk of its own (`./split.tsx`). `index.test.ts` holds the two
 * lists to each other; the server build and the tests use `index.ts`.
 */
import './styles.css';

import { split } from './split';

export const PeopleHome = split(() => import('./home/people-home'), 'PeopleHome');
export const FieldRegistry = split(() => import('./settings/field-registry'), 'FieldRegistry');
export const FieldChange = split(() => import('./settings/field-change'), 'FieldChange');
export const PeopleSetup = split(() => import('./setup/people-setup'), 'PeopleSetup');
export const Onboarding = split(() => import('./onboarding/onboarding'), 'Onboarding');
export const Profile = split(() => import('./profile/profile'), 'Profile');
export const PersonHistory = split(() => import('./profile/history'), 'PersonHistory');
export const Directory = split(() => import('./directory/directory'), 'Directory');
export const OrgChart = split(() => import('./org-chart/org-chart'), 'OrgChartScreen');
export const BulkEdit = split(() => import('./bulk/bulk-edit'), 'BulkEdit');
export const Integrations = split(
  () => import('./settings/integrations/integrations'),
  'Integrations',
);
export const RoleSettings = split(() => import('./settings/roles'), 'RoleSettings');
export const Organisation = split(() => import('./settings/organisation'), 'Organisation');
export const PeopleSettings = split(() => import('./settings/overview'), 'PeopleSettings');
export const WebhookLog = split(() => import('./settings/integrations/webhook-log'), 'WebhookLog');
export const Review = split(() => import('./review/review'), 'Review');
export const ImportFlow = split(() => import('./import/import-flow'), 'ImportFlow');
export const ExportBuilder = split(() => import('./export/export-builder'), 'ExportBuilder');
export const ImportExport = split(() => import('./import/import-export'), 'ImportExport');
export const Analytics = split(() => import('./analytics/analytics'), 'Analytics');
export const WhatChanged = split(() => import('./analytics/what-changed'), 'WhatChanged');
export const ReportSchedules = split(() => import('./reports/report-schedules'), 'ReportSchedules');
export const ReportRuns = split(() => import('./reports/report-runs'), 'ReportRuns');
