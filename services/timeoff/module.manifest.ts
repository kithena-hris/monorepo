import { ModuleManifest } from '@hris/contracts';

/**
 * Time Off declares no hard dependency on People. That is deliberate and it
 * is tested: `just standalone timeoff` boots this module with no siblings and
 * runs the acceptance suite. A customer running Workday can buy Time Off
 * alone and the People Graph is fed through the anti-corruption layer.
 */
export default ModuleManifest.parse({
  key: 'timeoff',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: ['people'],
  publishes: [
    'timeoff.request.requested',
    'timeoff.request.approved',
    'timeoff.request.rejected',
    'timeoff.request.corrected',
  ],
  consumes: [
    'people.person.hired',
    'people.person.terminated',
    'people.person.manager_changed',
    'people.person.synced_from_external',
  ],
  entitlement: 'module.timeoff',
  requiresPeopleSource: 'either',
});
