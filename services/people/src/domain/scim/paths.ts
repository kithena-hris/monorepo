/**
 * SCIM attribute paths (RFC 7644 §3.10), shared by filters, PATCH and the
 * User shape.
 *
 * Attribute names are case-insensitive; a schema URN may prefix a path, and
 * the core schema's URN means the resource itself.
 */

export const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const CORE_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const ENTERPRISE_USER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
/** Tenant-defined attributes, keyed by attribute key (PRD §13.5). */
export const KITHENA_USER = 'urn:kithena:scim:schemas:extension:people:2.0:User';

const CORE = [CORE_USER, CORE_GROUP].map((s) => s.toLowerCase());
const EXTENSIONS = [ENTERPRISE_USER, KITHENA_USER];

export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An array from a JSON body, whose items are not known to be anything yet. */
export const isList = (v: unknown): v is readonly unknown[] => Array.isArray(v);

/** An array as its items, anything else as the one item. */
export const listOf = (v: unknown): readonly unknown[] => (isList(v) ? v : [v]);

/** The key an object holds under this name, whatever its case. */
export function keyOf(object: Json, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(object).find((k) => k.toLowerCase() === lower);
}

export function getCI(object: unknown, name: string): unknown {
  if (!isObject(object)) return undefined;
  const key = keyOf(object, name);
  return key === undefined ? undefined : object[key];
}

/**
 * Where a path points: the object it is read from (the resource, or an
 * extension's object named by its URN) and the rest of the path inside it.
 * `extension` is the URN when the path is an extension's; `rest` is empty
 * when the path names the extension's object itself.
 */
export function splitSchema(path: string): {
  readonly extension: string | null;
  readonly rest: string;
} {
  if (!path.toLowerCase().startsWith('urn:')) return { extension: null, rest: path };
  const lower = path.toLowerCase();
  for (const urn of EXTENSIONS) {
    const u = urn.toLowerCase();
    if (lower === u) return { extension: urn, rest: '' };
    if (lower.startsWith(`${u}:`)) return { extension: urn, rest: path.slice(urn.length + 1) };
  }
  for (const u of CORE) {
    if (lower.startsWith(`${u}:`)) return { extension: null, rest: path.slice(u.length + 1) };
  }
  // An extension this service does not know: its URN is everything before
  // the last colon, which is what the RFC's grammar gives.
  const bracket = path.indexOf('[');
  const base = bracket === -1 ? path : path.slice(0, bracket);
  const at = base.lastIndexOf(':');
  return { extension: path.slice(0, at), rest: path.slice(at + 1) };
}
