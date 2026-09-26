import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { matches, parseFilter, type Filter } from './filter.js';
import { isObject, keyOf, splitSchema, type Json } from './paths.js';

/**
 * SCIM PATCH (RFC 7644 §3.5.2), applied to a resource as JSON.
 *
 * The application reads the resource, applies the operations here, and then
 * decides what changed by reading the result through the mapping — so a
 * path nothing maps (Okta's `locale`, Entra's `addresses`) is carried and
 * dropped without a refusal, which is how both providers expect an app to
 * treat an attribute it does not keep.
 */

export const PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export interface PatchOperation {
  readonly op: 'add' | 'replace' | 'remove';
  readonly path: string | null;
  readonly value: unknown;
}

const Syntax = (message: string) => err(failure('SCIM_INVALID_SYNTAX', message));
const BadPath = (message: string) => err(failure('SCIM_INVALID_PATH', message));
const MAX_OPERATIONS = 1000;

export function parsePatch(body: unknown): Result<readonly PatchOperation[]> {
  if (!isObject(body)) return Syntax('A PATCH body is a PatchOp message');
  const schemas = body['schemas'];
  if (
    !Array.isArray(schemas) ||
    !schemas.some((s) => String(s).toLowerCase() === PATCH_OP.toLowerCase())
  ) {
    return Syntax(`A PATCH body names the schema ${PATCH_OP}`);
  }
  const operations = body['Operations'] ?? body['operations'];
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_OPERATIONS) {
    return Syntax('A PATCH body carries between 1 and 1000 Operations');
  }
  const out: PatchOperation[] = [];
  for (const raw of operations) {
    if (!isObject(raw)) return Syntax('Each operation is an object');
    const op = String(raw['op'] ?? '').toLowerCase();
    if (op !== 'add' && op !== 'replace' && op !== 'remove') {
      return Syntax(`${String(raw['op'])} is not a PATCH operation`);
    }
    const path = typeof raw['path'] === 'string' && raw['path'] !== '' ? raw['path'] : null;
    if (path === null && op === 'remove') return Syntax('A remove names a path');
    if (path === null && !isObject(raw['value'])) {
      return Syntax('An operation without a path carries an object of attributes');
    }
    out.push({ op, path, value: raw['value'] });
  }
  return ok(out);
}

export function applyPatch(resource: Json, operations: readonly PatchOperation[]): Result<Json> {
  const doc = structuredClone(resource);
  for (const operation of operations) {
    const pairs: [string, unknown][] =
      operation.path === null
        ? Object.entries(operation.value as Json)
        : [[operation.path, operation.value]];
    for (const [path, value] of pairs) {
      const applied = applyAt(doc, operation.op, path, value);
      if (!applied.ok) return applied;
    }
  }
  return ok(doc);
}

/** `attr`, `attr.sub`, `attr[filter]` or `attr[filter].sub`. */
interface Target {
  readonly attr: string;
  readonly filter: Filter | null;
  readonly sub: string | null;
}

function parseTarget(rest: string): Result<Target> {
  const open = rest.indexOf('[');
  if (open === -1) {
    const [attr = '', sub, ...more] = rest.split('.');
    if (attr === '' || more.length > 0) return BadPath(`${rest} is not a path this service reads`);
    return ok({ attr, filter: null, sub: sub ?? null });
  }
  const close = rest.lastIndexOf(']');
  if (close < open) return BadPath(`${rest} has an unclosed filter`);
  const after = rest.slice(close + 1);
  if (after !== '' && !/^\.[^.[\]]+$/u.test(after))
    return BadPath(`${rest} is not a path this service reads`);
  const filter = parseFilter(rest.slice(open + 1, close));
  if (!filter.ok) return BadPath(filter.error.message);
  return ok({
    attr: rest.slice(0, open),
    filter: filter.value,
    sub: after === '' ? null : after.slice(1),
  });
}

function set(object: Json, name: string, value: unknown): void {
  object[keyOf(object, name) ?? name] = value;
}

function remove(object: Json, name: string): void {
  const key = keyOf(object, name);
  if (key !== undefined) Reflect.deleteProperty(object, key);
}

/** A complex value merged into what is there: sub-attributes not named are kept. */
function merge(existing: unknown, value: Json): Json {
  const out: Json = isObject(existing) ? { ...existing } : {};
  for (const [k, v] of Object.entries(value)) set(out, k, v);
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function applyAt(doc: Json, op: PatchOperation['op'], path: string, value: unknown): Result<void> {
  const { extension, rest } = splitSchema(path);
  let holder = doc;
  if (extension !== null) {
    const existing = doc[keyOf(doc, extension) ?? extension];
    if (rest === '') {
      // The extension's object itself.
      if (op === 'remove') remove(doc, extension);
      else if (isObject(value)) set(doc, extension, merge(existing, value));
      return ok(undefined);
    }
    if (!isObject(existing)) {
      if (op === 'remove') return ok(undefined);
      set(doc, extension, {});
    }
    holder = doc[keyOf(doc, extension) ?? extension] as Json;
  }
  const target = parseTarget(rest);
  if (!target.ok) return target;
  const { attr, filter, sub } = target.value;
  const existing = holder[keyOf(holder, attr) ?? attr];

  if (filter === null && sub === null) {
    // Entra removes members by value rather than by filter:
    // `{"op":"Remove","path":"members","value":[{"value":"…"}]}`.
    if (op === 'remove' && Array.isArray(existing) && Array.isArray(value)) {
      const gone = (e: unknown) =>
        value.some((v) => same(v, e) || (isObject(v) && isObject(e) && v['value'] === e['value']));
      set(
        holder,
        attr,
        existing.filter((e) => !gone(e)),
      );
    } else if (op === 'remove') remove(holder, attr);
    else if (Array.isArray(existing) && op === 'add') {
      const added = Array.isArray(value) ? value : [value];
      set(holder, attr, [...existing, ...added.filter((v) => !existing.some((e) => same(e, v)))]);
    } else if (isObject(value) && isObject(existing)) set(holder, attr, merge(existing, value));
    else set(holder, attr, value);
    return ok(undefined);
  }

  if (filter === null && sub !== null) {
    if (op === 'remove') {
      if (isObject(existing)) remove(existing, sub);
      return ok(undefined);
    }
    set(holder, attr, merge(existing, { [sub]: value }));
    return ok(undefined);
  }

  // A filter over a multi-valued attribute.
  const items: unknown[] = Array.isArray(existing) ? [...(existing as unknown[])] : [];
  const picked = items.map((item) => filter !== null && matches(filter, item));
  if (op === 'remove') {
    set(
      holder,
      attr,
      sub === null
        ? items.filter((_, i) => !picked[i])
        : items.map((item, i) => {
            if (!picked[i] || !isObject(item)) return item;
            const kept = { ...item };
            remove(kept, sub);
            return kept;
          }),
    );
    return ok(undefined);
  }
  const written = (item: unknown) =>
    sub === null ? (isObject(value) ? merge(item, value) : value) : merge(item, { [sub]: value });
  if (picked.some(Boolean)) {
    set(
      holder,
      attr,
      items.map((item, i) => (picked[i] ? written(item) : item)),
    );
    return ok(undefined);
  }
  // Nothing matched: `emails[type eq "work"].value` on a user with no work
  // email adds one, which is what both providers mean by it.
  if (filter?.kind !== 'compare' || filter.op !== 'eq' || filter.path.includes('.')) {
    return err(failure('SCIM_NO_TARGET', `Nothing in ${attr} matches the filter`));
  }
  set(holder, attr, [...items, written({ [filter.path]: filter.value })]);
  return ok(undefined);
}
