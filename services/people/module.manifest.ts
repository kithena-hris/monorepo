import { ModuleManifest } from '@kithena/contracts';

export default ModuleManifest.parse({
  key: 'people',
  version: '0.1.0',
  dependsOn: [],
  enrichedBy: [],
  publishes: [
    'people.schema.section_created',
    'people.schema.section_updated',
    'people.schema.section_archived',
    'people.schema.attribute_created',
    'people.schema.attribute_updated',
    'people.schema.attribute_archived',
    'people.schema.published',
    'people.person.provisioned',
    'people.person.identity_linked',
    'people.person.hired',
    'people.person.profile_updated',
    'people.person.identity_facts_changed',
    'people.person.attribute_corrected',
    'people.person.job_changed',
    'people.person.org_changed',
    'people.person.manager_changed',
    'people.person.compensation_changed',
    'people.person.status_changed',
    'people.person.terminated',
    'people.person.profile_incomplete',
    'people.person.profile_completed',
    'people.person.merged',
    'people.person.anonymised',
    'people.person.synced_from_external',
    'people.unique_claim.conflict',
    'people.import.started',
    'people.import.completed',
    'people.export.completed',
    'people.webhook.endpoint_disabled',
  ],
  /*
   * Identity is a platform service rather than a module, so consuming its
   * events adds nothing to `dependsOn` — every tenant has identity, whether or
   * not they bought People. The one People event here is its own: the publish
   * transaction raises it, and the completeness recompute runs off it rather
   * than inside that transaction.
   */
  consumes: [
    'identity.account.provisioned',
    'identity.account.profile_captured',
    'people.schema.published',
  ],
  entitlement: 'module.people',
  requiresPeopleSource: 'own',
});
