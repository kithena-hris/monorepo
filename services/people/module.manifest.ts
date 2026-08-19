import { ModuleManifest } from '@hris/contracts';

export default ModuleManifest.parse({
  key: 'people',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: [],
  publishes: [
    'people.person.hired',
    'people.person.manager_changed',
    'people.person.terminated',
    'people.person.synced_from_external',
  ],
  consumes: [],
  entitlement: 'module.people',
  requiresPeopleSource: 'own',
});
