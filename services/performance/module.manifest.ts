import { ModuleManifest } from '@kithena/contracts';

/**
 * Performance and Development declares no hard dependency (PRD §5): members
 * and their managers come from People's events or the member import, and
 * probation dates from People or Onboarding when either is there. Goals and
 * Learning live inside it. `just standalone performance` boots it with every
 * sibling absent.
 */
export default ModuleManifest.parse({
  key: 'performance',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: ['people', 'onboarding', 'timeoff', 'documents', 'compensation'],
  publishes: [
    'performance.activity.recorded',
    'performance.cycle.state_changed',
    'performance.review.status_changed',
    'performance.review.released',
    'performance.template.published',
    'performance.feedback.given',
    'performance.goal.checked_in',
    'performance.learning.completed',
    'performance.rating.finalized',
  ],
  consumes: [
    'people.person.hired',
    'people.person.identity_linked',
    'people.person.job_changed',
    'people.person.org_changed',
    'people.person.manager_changed',
    'people.person.terminated',
    'people.org_unit.created',
    'people.org_unit.updated',
    'onboarding.plan.started',
    'onboarding.probation.reviewed',
    'identity.tenant.administrator_named',
    'identity.tenant.administrator_removed',
    'identity.tenant.entitlements_changed',
  ],
  entitlement: 'module.performance',
  requiresPeopleSource: 'either',
});
