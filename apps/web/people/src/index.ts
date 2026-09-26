/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 */
import './styles.css';

export { PeopleHome } from './home/people-home';
export { FieldRegistry } from './settings/field-registry';
export { PeopleSetup } from './setup/people-setup';
export { Onboarding } from './onboarding/onboarding';
export { AddPerson } from './onboarding/add-person';
export { Profile } from './profile/profile';
export { PersonHistory } from './profile/history';
export { Directory } from './directory/directory';
export { CompletenessGrid } from './completeness/completeness-grid';
export { BulkEdit } from './bulk/bulk-edit';
export { Integrations } from './settings/integrations/integrations';
export { RoleSettings } from './settings/roles';
export { Organisation } from './settings/organisation';
export { WebhookLog } from './settings/integrations/webhook-log';
export { FullValues } from './export/full-values';
export { IdentifierReviews } from './review/identifier-reviews';
export { Approvals } from './approvals/approvals';
export { Duplicates } from './review/duplicates';
export { ImportFlow } from './import/import-flow';
export { ExportBuilder } from './export/export-builder';
export { Analytics } from './analytics/analytics';
export { ReportSchedules } from './reports/report-schedules';
export { ReportRuns } from './reports/report-runs';
