import { ModuleManifest } from '@kithena/contracts';

/**
 * Onboarding declares no hard dependency (Recruiting PRD §O1). A hire arrives
 * from Recruiting's event, People's, or another ATS by webhook; members from
 * People's events or the import. `just standalone onboarding` boots it with
 * every sibling absent.
 */
export default ModuleManifest.parse({
  key: 'onboarding',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: ['people', 'recruiting', 'documents', 'timeoff'],
  publishes: [
    'onboarding.activity.recorded',
    'onboarding.plan.started',
    'onboarding.task.completed',
    'onboarding.plan.completed',
    'onboarding.plan.cancelled',
    'onboarding.probation.reviewed',
  ],
  consumes: [
    'people.person.hired',
    'people.person.snapshot',
    'people.person.terminated',
    'people.person.identity_linked',
    'recruiting.candidate.hired',
    'recruiting.prehire.cancelled',
    'identity.tenant.administrator_named',
    'identity.tenant.administrator_removed',
    'identity.tenant.entitlements_changed',
  ],
  entitlement: 'module.onboarding',
  requiresPeopleSource: 'either',
});
