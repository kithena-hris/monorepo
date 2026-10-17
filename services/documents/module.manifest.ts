import { ModuleManifest } from '@kithena/contracts';

/**
 * Documents declares no hard dependency on any module (PRD §1). It learns who
 * works here from People's events when People is present, and from an import
 * when it is not; where the design joins it to People or Time Off, the shell
 * composes each module's own operations (PRD §5.4). `just standalone
 * documents` boots it with every sibling absent.
 */
export default ModuleManifest.parse({
  key: 'documents',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: ['people', 'timeoff'],
  publishes: [
    'documents.activity.recorded',
    'documents.document.filed',
    'documents.document.versioned',
    'documents.document.shared',
    'documents.document.access_changed',
    'documents.document.viewed_confidential',
    'documents.document.deleted',
    'documents.document.restored',
    'documents.document.destroyed',
    'documents.request.created',
    'documents.request.fulfilled',
    'documents.request.cancelled',
    'documents.access.requested',
    'documents.access.decided',
    'documents.type.changed',
    'documents.hold.placed',
    'documents.hold.lifted',
    'documents.envelope.sent',
    'documents.envelope.signed',
    'documents.envelope.declined',
    'documents.envelope.completed',
    'documents.envelope.voided',
    'documents.acknowledgement.sent',
    'documents.acknowledgement.acknowledged',
  ],
  consumes: [
    'people.person.hired',
    'people.person.terminated',
    'people.person.manager_changed',
    'people.person.org_changed',
    'people.person.profile_updated',
    'people.person.status_changed',
    'people.person.identity_linked',
    'identity.tenant.administrator_named',
    'identity.tenant.administrator_removed',
    'identity.tenant.entitlements_changed',
  ],
  entitlement: 'module.documents',
  requiresPeopleSource: 'either',
});
