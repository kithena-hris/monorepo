/**
 * Redact every property named in `keys`, at any depth and inside arrays.
 *
 * Pino's own redaction compiles fixed paths and has no recursive wildcard, so
 * a tenant-defined field logged one level deeper than the paths anticipated
 * went out in clear. This walks the log object once instead, and matches by
 * key wherever the key sits.
 *
 * **Copy on write.** Nothing is allocated for a line with nothing to redact,
 * which is almost every line; the caller's object is never mutated, because
 * the caller is usually still holding it. A copy keeps its prototype and every
 * own property, so an `Error` is still an `Error` when Pino's serializer
 * reaches it.
 *
 * **Bounded, and closed at the bound.** A subtree deeper than `MAX_DEPTH`, a
 * line with more than `MAX_NODES` objects in it, and a cycle are all replaced
 * with the censor rather than walked or passed through. What a walk did not
 * look at is not known to be clean.
 */

export const CENSOR = '[redacted]';
const MAX_DEPTH = 32;
const MAX_NODES = 10_000;

interface Walk {
  readonly keys: ReadonlySet<string>;
  /** The objects on the path from the root to here, for cycle detection. */
  readonly ancestors: object[];
  nodes: number;
}

export function redactKeys<T>(value: T, keys: ReadonlySet<string>): T {
  if (keys.size === 0 || value === null || typeof value !== 'object') return value;
  return walk(value, { keys, ancestors: [], nodes: 0 }) as T;
}

function walk(value: unknown, state: Walk): unknown {
  if (value === null || typeof value !== 'object') return value;
  state.nodes += 1;
  if (
    state.ancestors.length >= MAX_DEPTH ||
    state.nodes > MAX_NODES ||
    state.ancestors.includes(value)
  ) {
    return CENSOR;
  }

  state.ancestors.push(value);
  const copy = Array.isArray(value) ? walkArray(value, state) : walkObject(value, state);
  state.ancestors.pop();
  return copy ?? value;
}

function walkArray(value: readonly unknown[], state: Walk): unknown[] | undefined {
  let copy: unknown[] | undefined;
  for (let i = 0; i < value.length; i += 1) {
    const next = walk(value[i], state);
    if (next !== value[i]) {
      copy ??= [...value];
      copy[i] = next;
    }
  }
  return copy;
}

function walkObject(value: object, state: Walk): object | undefined {
  let copy: Record<string, unknown> | undefined;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    const child = record[key];
    const next = state.keys.has(key) ? CENSOR : walk(child, state);
    if (next !== child) {
      copy ??= clone(value);
      Object.defineProperty(copy, key, { value: next, enumerable: true, writable: true, configurable: true });
    }
  }
  return copy;
}

/** A spread for a plain object, which is nearly every log line; the full copy otherwise. */
function clone(value: object): Record<string, unknown> {
  const proto = Object.getPrototypeOf(value) as object | null;
  if (proto === Object.prototype) return { ...value };
  return Object.create(proto, Object.getOwnPropertyDescriptors(value)) as Record<string, unknown>;
}
