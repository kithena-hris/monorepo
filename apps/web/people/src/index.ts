/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 *
 * Each is `framed`: the host's breadcrumb and actions join the screen's own
 * header (`./frame.tsx`).
 */
import './styles.css';

import { framed } from './frame';

import { PeopleHome as PeopleHomeScreen } from './home/people-home';
import { FieldRegistry as FieldRegistryScreen } from './settings/field-registry';
import { PeopleSetup as PeopleSetupScreen } from './setup/people-setup';
import { Onboarding as OnboardingScreen } from './onboarding/onboarding';
import { AddPerson as AddPersonScreen } from './onboarding/add-person';
import { Profile as ProfileScreen } from './profile/profile';
import { PersonHistory as PersonHistoryScreen } from './profile/history';
import { Directory as DirectoryScreen } from './directory/directory';
import { OrgChartScreen } from './org-chart/org-chart';
import { CompletenessGrid as CompletenessGridScreen } from './completeness/completeness-grid';
import { BulkEdit as BulkEditScreen } from './bulk/bulk-edit';
import { Integrations as IntegrationsScreen } from './settings/integrations/integrations';
import { SettingsActivity as SettingsActivityScreen } from './settings/activity';
import { RoleSettings as RoleSettingsScreen } from './settings/roles';
import { Organisation as OrganisationScreen } from './settings/organisation';
import { PeopleSettings as PeopleSettingsScreen } from './settings/overview';
import { WebhookLog as WebhookLogScreen } from './settings/integrations/webhook-log';
import { FullValues as FullValuesScreen } from './export/full-values';
import { IdentifierReviews as IdentifierReviewsScreen } from './review/identifier-reviews';
import { Approvals as ApprovalsScreen } from './approvals/approvals';
import { Duplicates as DuplicatesScreen } from './review/duplicates';
import { ImportFlow as ImportFlowScreen } from './import/import-flow';
import { ExportBuilder as ExportBuilderScreen } from './export/export-builder';
import { Analytics as AnalyticsScreen } from './analytics/analytics';
import { ReportSchedules as ReportSchedulesScreen } from './reports/report-schedules';
import { ReportRuns as ReportRunsScreen } from './reports/report-runs';

export const PeopleHome = framed(PeopleHomeScreen);
export const FieldRegistry = framed(FieldRegistryScreen);
export const PeopleSetup = framed(PeopleSetupScreen);
export const Onboarding = framed(OnboardingScreen);
export const AddPerson = framed(AddPersonScreen);
export const Profile = framed(ProfileScreen);
export const PersonHistory = framed(PersonHistoryScreen);
export const Directory = framed(DirectoryScreen);
export const OrgChart = framed(OrgChartScreen);
export const CompletenessGrid = framed(CompletenessGridScreen);
export const BulkEdit = framed(BulkEditScreen);
export const Integrations = framed(IntegrationsScreen);
export const SettingsActivity = framed(SettingsActivityScreen);
export const RoleSettings = framed(RoleSettingsScreen);
export const Organisation = framed(OrganisationScreen);
export const PeopleSettings = framed(PeopleSettingsScreen);
export const WebhookLog = framed(WebhookLogScreen);
export const FullValues = framed(FullValuesScreen);
export const IdentifierReviews = framed(IdentifierReviewsScreen);
export const Approvals = framed(ApprovalsScreen);
export const Duplicates = framed(DuplicatesScreen);
export const ImportFlow = framed(ImportFlowScreen);
export const ExportBuilder = framed(ExportBuilderScreen);
export const Analytics = framed(AnalyticsScreen);
export const ReportSchedules = framed(ReportSchedulesScreen);
export const ReportRuns = framed(ReportRunsScreen);
