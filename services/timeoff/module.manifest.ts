import { ModuleManifest } from '@kithena/contracts';

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
    'timeoff.request.counter_proposed',
    'timeoff.request.changed',
    'timeoff.request.cancelled',
    'timeoff.balance.adjusted',
    'timeoff.policy.published',
    'timeoff.attendance.punched',
    'timeoff.attendance.corrected',
    'timeoff.period.closed',
    'timeoff.parental.plan_submitted',
    'timeoff.parental.plan_approved',
  ],
  consumes: [
    'people.person.hired',
    'people.person.terminated',
    'people.person.manager_changed',
    'people.person.org_changed',
    'people.person.profile_updated',
    'people.person.status_changed',
    'people.person.synced_from_external',
    'people.person.identity_linked',
    'people.location.created',
    'people.location.updated',
    'people.location.zone_changed',
    'identity.tenant.administrator_named',
    'identity.tenant.administrator_removed',
  ],
  entitlement: 'module.timeoff',
  requiresPeopleSource: 'either',
});
