import * as z from 'zod';

import { valueSchemaFor } from '../application/person/values.js';
import type { PublishedVersion } from '../domain/schema/publish.js';

/**
 * A published version as JSON Schema, so an integrator can pin to it and
 * generate types (§13.4).
 *
 * Generated with `z.toJSONSchema` from `valueSchemaFor` — the Zod the write
 * path validates with — so the artifact and the API cannot disagree about
 * what a value may be. Every input is the immutable version, so the same
 * version always renders the same bytes: nothing here reads a clock, a tenant
 * setting or the registry draft.
 *
 * It describes what may be *written*. An encrypted attribute is written as a
 * string and read back as `{ "last4": … }`; the description says so.
 */
export function schemaArtifact(version: PublishedVersion): Record<string, unknown> {
  // The range refinements that need a date do not survive into JSON Schema,
  // so the date passed here cannot change the output; it is the publish date
  // only so that nothing about this function depends on when it runs.
  const day = version.publishedAt.slice(0, 10);

  const shape: Record<string, z.ZodType> = {};
  for (const definition of version.document.attributes) {
    const value = valueSchemaFor(definition, day)
      .nullable()
      .describe(
        [
          definition.label.default,
          definition.encrypted
            ? 'Encrypted: written as shown, read back as { "last4": string }.'
            : null,
          definition.effectiveDated ? 'Effective-dated.' : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    shape[definition.key] = value.optional();
  }

  return {
    ...z.toJSONSchema(z.strictObject(shape), { io: 'input', unrepresentable: 'any' }),
    title: `People attributes, schema version ${String(version.version)}`,
    'x-schema-version': version.version,
    'x-checksum': version.checksum,
  };
}
