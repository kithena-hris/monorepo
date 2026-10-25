import { ModuleManifest } from '@kithena/contracts';

/**
 * Recruiting declares no hard dependency on any module (PRD §5). It learns
 * who works here from People's events when People is present, and from an
 * import when it is not; a signed contract from Documents' events, or an
 * upload; a hire is handed on by `recruiting.candidate.hired`, which People
 * and Onboarding consume on their own terms. `just standalone recruiting`
 * boots it with every sibling absent.
 */
export default ModuleManifest.parse({
  key: 'recruiting',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: ['people', 'documents', 'timeoff'],
  publishes: [
    'recruiting.activity.recorded',
    'recruiting.requisition.submitted',
    'recruiting.requisition.decided',
    'recruiting.job.opened',
    'recruiting.job.closed',
    'recruiting.job.filled',
    'recruiting.job.published',
    'recruiting.job.unpublished',
    'recruiting.application.received',
    'recruiting.application.moved',
    'recruiting.application.rejected',
    'recruiting.application.withdrawn',
    'recruiting.interview.scheduled',
    'recruiting.interview.completed',
    'recruiting.interview.cancelled',
    'recruiting.scorecard.submitted',
    'recruiting.offer.approved',
    'recruiting.offer.sent',
    'recruiting.offer.accepted',
    'recruiting.offer.declined',
    'recruiting.offer.withdrawn',
    'recruiting.candidate.hired',
    'recruiting.prehire.conditions_met',
    'recruiting.prehire.cancelled',
    'recruiting.candidate.deleted',
  ],
  consumes: [
    'people.person.hired',
    'people.person.snapshot',
    'people.person.terminated',
    'people.person.manager_changed',
    'people.person.org_changed',
    'people.person.profile_updated',
    'people.person.status_changed',
    'people.person.identity_linked',
    'identity.tenant.provisioned',
    'identity.tenant.amended',
    'identity.tenant.administrator_named',
    'identity.tenant.administrator_removed',
    'identity.tenant.entitlements_changed',
  ],
  entitlement: 'module.recruiting',
  requiresPeopleSource: 'either',
});
