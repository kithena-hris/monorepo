import type { AttributeDefinition, ChangedAttribute } from '@kithena/contracts';

/**
 * One attribute that changed, as §10.3 lets it travel.
 *
 * The value rides only when the definition opted in, and never for an
 * encrypted or special-category field whatever the flag says. The contract
 * refuses those two at parse time as well; deciding here means the domain
 * never builds a payload the contract would have to reject.
 */
export function changedAttribute(
  definition: AttributeDefinition,
  value: unknown,
): ChangedAttribute {
  const base = {
    key: definition.key,
    sectionKey: definition.sectionKey,
    classification: definition.classification.classification,
    encrypted: definition.encrypted,
  };

  const travels =
    definition.includeInEvents &&
    !definition.encrypted &&
    definition.classification.classification !== 'special-category';

  return travels ? { ...base, value } : base;
}
