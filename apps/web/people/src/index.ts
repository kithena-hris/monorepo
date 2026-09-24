/**
 * The only file federation exposes. Everything else in this remote is
 * internal; the names exported here are what `public/routes.json` may point at.
 */
import './styles.css';

export { PeopleHome } from './home/people-home';
export { FieldRegistry } from './settings/field-registry';
export { PeopleSetup } from './setup/people-setup';
export { Onboarding } from './onboarding/onboarding';
export { Profile } from './profile/profile';
export { Directory } from './directory/directory';
export { CompletenessGrid } from './completeness/completeness-grid';
export { Integrations } from './settings/integrations/integrations';
export { RoleSettings } from './settings/roles';
export { Organisation } from './settings/organisation';
export { ImportFlow } from './import/import-flow';
export { ExportBuilder } from './export/export-builder';
export { Analytics } from './analytics/analytics';
