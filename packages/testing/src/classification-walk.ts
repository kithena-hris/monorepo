import * as z from 'zod';
import { policy, type DefinedEvent, type FieldPolicy } from '@hris/contracts';

/**
 * Walks an event payload and yields every field that carries a classification.
 *
 * This mirrors the traversal in `tools/codegen`, and deliberately so: codegen
 * decides what gets redacted, denied to a model and put in a DSAR package, and
 * a test that walked the schema differently would be checking a different set
 * of fields from the one the generated artifacts describe.
 *
 * The unwrapping is the part that matters. A policy registered on `PersonId`
 * has to survive `PersonId.nullable()` — every wrapper produces a new schema
 * instance and the registry is keyed by instance, so reading only the outermost
 * one reports a classified field as unclassified. Nullability is not a data
 * classification.
 */
export function* classifiedFields(
  schema: z.ZodType,
  path: readonly string[] = [],
): Generator<readonly [string, FieldPolicy]> {
  const found = effectivePolicy(schema);
  if (found && path.length > 0) yield [path.join('.'), found];

  const object = unwrapAll(schema);
  if (!(object instanceof z.ZodObject)) return;

  for (const [key, child] of Object.entries(object.shape)) {
    // A shape is typed `any` at ZodObject's default generic, so each child
    // arrives untyped. Checking is what makes it a schema here.
    if (child instanceof z.ZodType) yield* classifiedFields(child, [...path, key]);
  }
}

/** Every classified field of every event, keyed by `<event name>.<path>`. */
export function classifiedFieldsOf(
  events: readonly DefinedEvent[],
): ReadonlyMap<string, FieldPolicy> {
  const out = new Map<string, FieldPolicy>();
  for (const event of events) {
    for (const [path, field] of classifiedFields(event.payload)) {
      out.set(`${event.name}.${path}`, field);
    }
  }
  return out;
}

function effectivePolicy(schema: z.ZodType): FieldPolicy | undefined {
  let current: z.ZodType = schema;
  for (;;) {
    const found = policy.get(current);
    if (found) return found;
    const inner = unwrapOnce(current);
    if (!inner || inner === current) return undefined;
    current = inner;
  }
}

function unwrapAll(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (;;) {
    const inner = unwrapOnce(current);
    if (!inner || inner === current) return current;
    current = inner;
  }
}

/**
 * Listed explicitly rather than reached through `def.innerType`: asserting a
 * shape onto `def` would typecheck against the claim rather than against Zod,
 * so a wrapper naming its inner schema differently would silently return
 * `undefined` and report a classified field as unclassified — the exact failure
 * this walk exists to catch. `unwrap()` is Zod's own accessor.
 *
 * Brands are absent on purpose: in Zod 4 `.brand()` is a type-level operation
 * returning the same runtime schema, so there is no wrapper to unwrap.
 */
function unwrapOnce(schema: z.ZodType): z.ZodType | undefined {
  const inner =
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodCatch
      ? schema.unwrap()
      : undefined;
  return inner instanceof z.ZodType ? inner : undefined;
}
