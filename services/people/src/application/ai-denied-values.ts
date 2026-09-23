import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { DeniedValueLookup } from '@kithena/telemetry';

import { visibleTo } from '../domain/access/field-access.js';
import { inTenantResult } from './person/person-access.js';
import type { PersonReader, RelationsResolver, SchemaVersions, Viewer } from './person/ports.js';

/**
 * People's answer to the AI gateway: the current values of the denied
 * attributes, for the people a prompt is about, so the gateway can refuse a
 * prompt whose free text carries one (PRD §12.2).
 *
 * **Authorization applies, per field.** A value the caller may not read is
 * not looked up. The alternative — check every value regardless — would turn
 * the gateway into an oracle: send "is she Catholic?" and read the answer off
 * whether it was refused. A caller cannot have got an unreadable value from
 * this module, so leaving it out costs the check nothing it could have seen.
 *
 * **A person who does not resolve fails the whole lookup**, and the gateway
 * then refuses. Not finding the values is not evidence the text is clean.
 *
 * A sealed value is revealed for the check, because comparing against its
 * last four would match every text containing those four digits and miss the
 * value typed any other way. The plaintext lives in the returned array only,
 * which the gateway holds for the length of one comparison; nothing here or
 * there logs it, and the secret store's own audit line names the key, never
 * the value.
 *
 * Booleans are not returned: `true` in a prompt discloses nothing without the
 * field's name, and matching it would refuse every prompt that says "true".
 */

type Tx = PostgresJsDatabase;

/** `drizzleSecretStore` satisfies this. The one method this needs, and no wider. */
export interface SecretReveal {
  reveal(
    tx: Tx,
    where: { tenantId: string; personId: string; attributeKey: string },
  ): Promise<string | null>;
}

export interface AiDeniedValuesDeps {
  readonly reader: PersonReader;
  readonly schemas: SchemaVersions;
  readonly relations: RelationsResolver;
  readonly secrets: SecretReveal;
}

/** Every string and number in a stored value, as text: a repeating group or money has several. */
function texts(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number' || typeof value === 'bigint') out.push(String(value));
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) texts(v, out);
}

export function aiDeniedValues(deps: AiDeniedValuesDeps) {
  return async function values(
    tx: Tx,
    asking: {
      readonly tenantId: string;
      readonly viewer: Viewer;
      readonly subjects: readonly string[];
      readonly keys: ReadonlySet<string>;
    },
  ): Promise<Result<readonly string[]>> {
    const version = await deps.schemas.current(tx, asking.tenantId);
    if (!version) {
      return err(failure('SCHEMA_NOT_PUBLISHED', 'This workspace has not published a People schema yet'));
    }
    const definitions = version.document.attributes.filter((d) => asking.keys.has(d.key));
    const found: string[] = [];

    for (const personId of asking.subjects) {
      // One person at a time, in the caller's transaction: a prompt names a
      // handful of people, and this is the authorization check per person.
      // eslint-disable-next-line no-await-in-loop -- see above
      const person = await deps.reader.record(tx, asking.tenantId, personId);
      if (!person) return err(failure('NOT_FOUND', 'No such person'));
      // eslint-disable-next-line no-await-in-loop -- see above
      const relations = await deps.relations.relations(tx, asking.tenantId, asking.viewer, personId);

      for (const definition of definitions) {
        if (!visibleTo(definition, relations)) continue;
        const value = definition.encrypted
          ? // eslint-disable-next-line no-await-in-loop -- see above
            await deps.secrets.reveal(tx, { tenantId: asking.tenantId, personId, attributeKey: definition.key })
          : person.values[definition.key];
        texts(value, found);
      }
    }
    return ok(found);
  };
}

/** The gateway's `deniedValues`, each lookup in its own tenant transaction. */
export function deniedValueLookup(
  inTenant: <R>(tenantId: string, fn: (scope: { tx: Tx }) => Promise<R>) => Promise<R>,
  deps: AiDeniedValuesDeps,
): DeniedValueLookup {
  const values = aiDeniedValues(deps);
  return (tenantId, subjects, keys) =>
    inTenantResult(inTenant, tenantId, (tx) =>
      values(tx, { tenantId, viewer: subjects.caller, subjects: subjects.ids, keys }),
    );
}
