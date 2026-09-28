import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { AttributeDefinition } from '@kithena/contracts';

import { visibleTo, type ViewerRelations } from '../access/field-access.js';

/**
 * Asking somebody for a detail of theirs that is empty.
 *
 * HR or a manager presses the button beside an empty field; the person is
 * emailed and finds it on their profile. Only a field the employee fills in
 * may be asked for — asking somebody for their employee number, which only HR
 * can write, would be a task they cannot do — and only one the one asking may
 * read, or the request itself would say the field exists.
 */

/** One press per field and person a day sends an email; another is recorded and not sent. */
export const REQUEST_AGAIN_AFTER_MS = 24 * 60 * 60 * 1000;

const MAX_KEYS = 50;

/** HR or their managers, never the person themselves. */
function mayAsk(relations: ViewerRelations): boolean {
  return !relations.isSelf && (relations.isHr || relations.isManager || relations.isInManagerChain);
}

/** Whether this viewer may ask the person for this field. */
export function askable(definition: AttributeDefinition, relations: ViewerRelations): boolean {
  return (
    mayAsk(relations) &&
    definition.deprecatedAt === null &&
    definition.ownership.includes('employee') &&
    visibleTo(definition, relations)
  );
}

export function requestable(
  definitions: readonly AttributeDefinition[],
  keys: readonly string[],
  relations: ViewerRelations,
): Result<void> {
  if (!mayAsk(relations)) {
    return err(failure('FORBIDDEN', 'Only HR or their manager may ask somebody for a detail'));
  }
  if (keys.length === 0 || keys.length > MAX_KEYS) {
    return err(
      failure('FIELD_NOT_REQUESTABLE', `Ask for 1 to ${String(MAX_KEYS)} fields`, ['keys']),
    );
  }
  const byKey = new Map(definitions.map((d) => [d.key as string, d]));
  for (const key of keys) {
    const definition = byKey.get(key);
    if (definition === undefined || !askable(definition, relations)) {
      return err(
        failure('FIELD_NOT_REQUESTABLE', `${key} is not a detail you can ask them for`, ['keys']),
      );
    }
  }
  return ok(undefined);
}
