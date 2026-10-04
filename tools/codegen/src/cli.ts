/**
 * One Zod definition, four generated artifacts. Run via `just codegen`.
 *
 *   1. JSON Schema per event, registered with BACKWARD_TRANSITIVE
 *      compatibility in the Redpanda schema registry
 *   2. Pino redaction paths, from the classification registry
 *   3. The AI gateway deny list (any field with aiEligible: false)
 *   4. The DSAR export manifest (any field with exportable: true)
 *
 * It also fails when a contract field carries no policy. Unclassified data is
 * how a value reaches a log, an export and a model prompt on the same day.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as z from 'zod';
import {
  allCapabilities,
  identityEvents,
  policy,
  peopleEvents,
  timeoffEvents,
} from '@kithena/contracts';

const allEvents = [...identityEvents, ...peopleEvents, ...timeoffEvents];

function jsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    allEvents.map((e) => [`${e.name}.v${String(e.version)}`, z.toJSONSchema(e.schema)]),
  );
}

/**
 * A policy registered on `PersonId` has to survive `PersonId.nullable()`.
 *
 * Every wrapper — nullable, optional, default, readonly, branded — produces a
 * new schema instance, and the registry is keyed by instance. Looking only at
 * the outermost one would report a classified field as unclassified and, worse,
 * would drop it from the redaction paths if the check were ever relaxed.
 * Nullability is not a data classification.
 */
/**
 * The wrappers that hold another schema inside them.
 *
 * Listed explicitly rather than reached through `def.innerType`. The old code
 * asserted a shape onto `def` and asked for `innerType`, which typechecked
 * against a claim rather than against Zod, so a wrapper that named its inner
 * schema differently would have silently returned `undefined` and reported a
 * classified field as unclassified, exactly the failure this file exists to
 * prevent. `unwrap()` is Zod's own accessor and each of these classes declares
 * it.
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

  /*
   * `unwrap()` is declared as returning Zod's core `$ZodType`, which is the
   * structural base and lacks the surface the walk uses. One more `instanceof`
   * converts that into the classed type, and does it by checking rather than by
   * asserting, the distinction that matters if Zod ever returns something that
   * genuinely is not a `ZodType`.
   *
   * Brands are deliberately absent from the list above. In Zod 4 `.brand()` is
   * a type-level operation that returns the same runtime schema, so there is no
   * wrapper to unwrap and a classified branded field is already found by the
   * registry lookup one level up.
   */
  return inner instanceof z.ZodType ? inner : undefined;
}

function effectivePolicy(schema: z.ZodType): ReturnType<typeof policy.get> {
  let current: z.ZodType = schema;
  for (;;) {
    const meta = policy.get(current);
    if (meta) return meta;
    const inner = unwrapOnce(current);
    if (!inner || inner === current) return undefined;
    current = inner;
  }
}

/** What one pass over the contracts accumulates. */
interface PolicyManifest {
  redact: string[];
  denyAi: string[];
  export: string[];
  unclassified: string[];
}

/** An array's items, as a path segment. */
const ITEMS = '[*]';

/**
 * Pino writes an array's items as `rows[*].detail`; the AI gateway matches a
 * path with the indices left out (`rows.detail`), and so does the export.
 */
const pinoPath = (path: readonly string[]): string => path.join('.').replaceAll(`.${ITEMS}`, ITEMS);
const plainPath = (path: readonly string[]): string => path.filter((s) => s !== ITEMS).join('.');

function walk(schema: z.ZodType, path: string[], out: PolicyManifest): void {
  const meta = effectivePolicy(schema);
  if (meta) {
    if (meta.classification === 'confidential' || meta.classification === 'special-category') {
      out.redact.push(pinoPath(path));
    }
    if (!meta.aiEligible) out.denyAi.push(plainPath(path));
    if (meta.exportable) out.export.push(plainPath(path));
  }

  /*
   * `instanceof` rather than reading a `type` string off an asserted `def`.
   * Each guard narrows to Zod's own class, so `shape`, `options` and `element`
   * are typed properties, and a structure is recognised by being one rather
   * than by matching a literal that Zod is free to rename.
   */
  const held = innermost(schema);

  // A nested object carries no policy of its own; its leaves do. Reporting it
  // as unclassified would flag every branch.
  if (held instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(held.shape)) {
      // `ZodObject`'s shape is typed `any` at its default generic, so each child
      // arrives untyped. Checking is what makes it a `ZodType` here, and it also
      // skips anything Zod may one day put in a shape that is not a schema.
      if (child instanceof z.ZodType) walk(child, [...path, key], out);
    }
    return;
  }

  // A classified union or list is a leaf: a list of ids, a date or a reference.
  if (meta) return;

  // Otherwise each alternative, at the same path, and each item, are
  // classified on their own: a capability's results, a row in a result.
  if (held instanceof z.ZodUnion) {
    for (const option of held.options) if (option instanceof z.ZodType) walk(option, path, out);
    return;
  }
  if (held instanceof z.ZodArray && held.element instanceof z.ZodType) {
    walk(held.element, [...path, ITEMS], out);
    return;
  }

  out.unclassified.push(plainPath(path));
}

/**
 * The schema underneath, looking through any wrappers.
 *
 * A `z.object({...}).optional()` is still an object for the purposes of the
 * walk, and the previous `def.type === 'object'` test missed that: a wrapped
 * nested object was never descended into, so nothing inside it was ever
 * classified or reported.
 */
function innermost(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let inner = unwrapOnce(current); inner && inner !== current; inner = unwrapOnce(current)) {
    current = inner;
  }
  return current;
}

/** Repo root, from this file's own location rather than from `process.cwd()`. */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const GENERATED = join(repoRoot, 'packages/telemetry/src/generated');

/**
 * Writes one list of paths as a TypeScript module under telemetry's
 * `generated/`.
 *
 * Artifacts 2 and 3 of the four this file is documented as producing. The
 * redaction paths were once maintained by hand under a header telling the next
 * reader not to, and drifted in both directions; the AI deny list was printed
 * to stdout and read by nothing. Both are written now, from the same walk, and
 * `@kithena/telemetry`'s policy registry unions each with the per-tenant set.
 *
 * De-duplicated because the same path is reached through more than one event,
 * `payload.reason` appears on both a rejection and a correction.
 */
function writePaths(file: string, name: string, why: string, paths: readonly string[]): void {
  const unique = [...new Set(paths)];
  const body = unique.map((path) => `  '${path}',`).join('\n');
  const target = join(GENERATED, file);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    [
      '// GENERATED FILE. Run `just codegen` to refresh.',
      '// Source: Zod classification registry in @kithena/contracts.',
      '//',
      `// ${why} To change what is listed, change the`,
      '// field policy in the contract, never this file.',
      `export const ${name}: readonly string[] = [`,
      body,
      '];',
      '',
    ].join('\n'),
    'utf8',
  );
}

function main(): void {
  const out: PolicyManifest = { redact: [], denyAi: [], export: [], unclassified: [] };
  for (const event of allEvents) walk(event.payload, ['payload'], out);
  // Beside the events, every capability's call and result (assistant PRD §8.2).
  for (const c of allCapabilities) {
    walk(c.schemas.input, ['capability', c.name, 'input'], out);
    walk(c.schemas.output, ['capability', c.name, 'output'], out);
  }

  if (out.unclassified.length > 0) {
    console.error('Contract fields with no classification policy:');
    for (const f of out.unclassified) console.error(`  ${f}`);
    process.exitCode = 1;
    return;
  }

  // Only once the walk has passed. Writing a redaction list derived from a
  // registry with an unclassified field in it would ship a gap in the very
  // artifact that exists to prevent one.
  writePaths(
    'redaction.ts',
    'redactionPaths',
    'A path is here because its field is `confidential` or `special-category`.',
    out.redact,
  );
  writePaths(
    'ai-deny.ts',
    'aiDenyPaths',
    'A path is here because its field is `aiEligible: false`.',
    out.denyAi,
  );

  console.log(JSON.stringify({ schemas: Object.keys(jsonSchemas()), ...out }, null, 2));
}

main();
