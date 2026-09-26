import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { getCI, isObject, splitSchema } from './paths.js';

/**
 * SCIM filters (RFC 7644 §3.4.2.2): parsed once, matched against a
 * resource as JSON.
 *
 * `not` binds tighter than `and`, and `and` tighter than `or`. Strings
 * compare case-insensitively except `id` and `externalId`, which the core
 * schema marks caseExact; timestamps compare as instants.
 */

export type CompareOp = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'ge' | 'lt' | 'le';
type Literal = string | number | boolean | null;

export type Filter =
  | { readonly kind: 'and' | 'or'; readonly left: Filter; readonly right: Filter }
  | { readonly kind: 'not'; readonly filter: Filter }
  | { readonly kind: 'present'; readonly path: string }
  | { readonly kind: 'compare'; readonly path: string; readonly op: CompareOp; readonly value: Literal }
  | { readonly kind: 'within'; readonly path: string; readonly filter: Filter };

const OPS = new Set<string>(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le']);
const MAX_LENGTH = 1000;
const Invalid = (message: string) => err(failure('SCIM_INVALID_FILTER', message));

type Token =
  | { readonly t: '(' | ')' | '[' | ']' }
  | { readonly t: 'word'; readonly v: string }
  | { readonly t: 'string'; readonly v: string };

function tokenize(text: string): Result<Token[]> {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? '';
    if (/\s/u.test(c)) {
      i += 1;
    } else if (c === '(' || c === ')' || c === '[' || c === ']') {
      tokens.push({ t: c });
      i += 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      if (j >= text.length) return Invalid('A string in the filter is not closed');
      try {
        tokens.push({ t: 'string', v: JSON.parse(text.slice(i, j + 1)) as string });
      } catch {
        return Invalid('A string in the filter is not valid');
      }
      i = j + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s()[\]"]/u.test(text[j] ?? '')) j += 1;
      tokens.push({ t: 'word', v: text.slice(i, j) });
      i = j;
    }
  }
  return ok(tokens);
}

export function parseFilter(text: string): Result<Filter> {
  if (text.length > MAX_LENGTH) return Invalid('The filter is too long');
  const lexed = tokenize(text);
  if (!lexed.ok) return lexed;
  const tokens = lexed.value;
  let at = 0;
  const peek = () => tokens[at];
  const isWord = (w: string) => {
    const token = peek();
    return token?.t === 'word' && token.v.toLowerCase() === w;
  };
  const expect = (t: '(' | ')' | ']'): Result<void> => {
    if (peek()?.t !== t) return Invalid(`Expected ${t} in the filter`);
    at += 1;
    return ok(undefined);
  };

  const or = (): Result<Filter> => {
    let left = and();
    while (left.ok && isWord('or')) {
      at += 1;
      const right = and();
      left = right.ok ? ok({ kind: 'or', left: left.value, right: right.value }) : right;
    }
    return left;
  };
  const and = (): Result<Filter> => {
    let left = unary();
    while (left.ok && isWord('and')) {
      at += 1;
      const right = unary();
      left = right.ok ? ok({ kind: 'and', left: left.value, right: right.value }) : right;
    }
    return left;
  };
  const grouped = (then: (inner: Filter) => Filter, close: ')' | ']'): Result<Filter> => {
    at += 1;
    const inner = or();
    if (!inner.ok) return inner;
    const closed = expect(close);
    return closed.ok ? ok(then(inner.value)) : closed;
  };
  const unary = (): Result<Filter> => {
    const token = peek();
    if (token === undefined) return Invalid('The filter ends too early');
    if (isWord('not')) {
      at += 1;
      if (peek()?.t !== '(') return Invalid('not takes a filter in parentheses');
      return grouped((filter) => ({ kind: 'not', filter }), ')');
    }
    if (token.t === '(') return grouped((inner) => inner, ')');
    if (token.t !== 'word') return Invalid('Expected an attribute in the filter');
    const path = token.v;
    at += 1;
    if (peek()?.t === '[') return grouped((filter) => ({ kind: 'within', path, filter }), ']');
    const op = peek();
    if (op?.t !== 'word') return Invalid(`Expected an operator after ${path}`);
    const name = op.v.toLowerCase();
    at += 1;
    if (name === 'pr') return ok({ kind: 'present', path });
    if (!OPS.has(name)) return Invalid(`${op.v} is not a filter operator`);
    const value = literal(peek());
    if (!value.ok) return value;
    at += 1;
    return ok({ kind: 'compare', path, op: name as CompareOp, value: value.value });
  };

  const parsed = or();
  if (!parsed.ok) return parsed;
  return at === tokens.length ? parsed : Invalid('The filter has more after its end');
}

function literal(token: Token | undefined): Result<Literal> {
  if (token?.t === 'string') return ok(token.v);
  if (token?.t !== 'word') return Invalid('Expected a value in the filter');
  const word = token.v.toLowerCase();
  if (word === 'true') return ok(true);
  if (word === 'false') return ok(false);
  if (word === 'null') return ok(null);
  const n = Number(token.v);
  return Number.isFinite(n) && token.v.trim() !== '' ? ok(n) : Invalid(`${token.v} is not a value`);
}

/** What a path holds on a resource: every leaf, through arrays, as a flat list. */
export function valuesAt(resource: unknown, path: string): unknown[] {
  const { extension, rest } = splitSchema(path);
  let current: unknown[] = [extension === null ? resource : getCI(resource, extension)];
  for (const part of rest === '' ? [] : rest.split('.')) {
    current = current.flatMap((v) => (Array.isArray(v) ? v : [v])).map((v) => getCI(v, part));
  }
  return current
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .map((v) => (isObject(v) && 'value' in v ? v['value'] : v))
    .filter((v) => v !== undefined && v !== null);
}

const EXACT = new Set(['id', 'externalid']);
const INSTANT = /^\d{4}-\d{2}-\d{2}T/u;

function compare(actual: unknown, op: CompareOp, expected: Literal, exact: boolean): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    if (INSTANT.test(actual) && INSTANT.test(expected) && !['co', 'sw', 'ew'].includes(op)) {
      return ordered(Date.parse(actual), op, Date.parse(expected));
    }
    const a = exact ? actual : actual.toLowerCase();
    const e = exact ? expected : expected.toLowerCase();
    if (op === 'co') return a.includes(e);
    if (op === 'sw') return a.startsWith(e);
    if (op === 'ew') return a.endsWith(e);
    return ordered(a, op, e);
  }
  if (typeof actual === 'number' && typeof expected === 'number') return ordered(actual, op, expected);
  if (op === 'eq') return actual === expected;
  if (op === 'ne') return actual !== expected;
  return false;
}

function ordered<T extends string | number>(a: T, op: CompareOp, e: T): boolean {
  switch (op) {
    case 'eq':
      return a === e;
    case 'ne':
      return a !== e;
    case 'gt':
      return a > e;
    case 'ge':
      return a >= e;
    case 'lt':
      return a < e;
    case 'le':
      return a <= e;
    default:
      return false;
  }
}

export function matches(filter: Filter, resource: unknown): boolean {
  switch (filter.kind) {
    case 'and':
      return matches(filter.left, resource) && matches(filter.right, resource);
    case 'or':
      return matches(filter.left, resource) || matches(filter.right, resource);
    case 'not':
      return !matches(filter.filter, resource);
    case 'present':
      return valuesAt(resource, filter.path).some((v) => v !== '');
    case 'within': {
      const { extension, rest } = splitSchema(filter.path);
      const holder = extension === null ? resource : getCI(resource, extension);
      const items = getCI(holder, rest);
      return (Array.isArray(items) ? items : [items]).some(
        (item) => item !== undefined && matches(filter.filter, item),
      );
    }
    case 'compare': {
      const values = valuesAt(resource, filter.path);
      if (filter.value === null) {
        return filter.op === 'eq' ? values.length === 0 : filter.op === 'ne' && values.length > 0;
      }
      const last = filter.path.split(/[.:]/u).at(-1)?.toLowerCase() ?? '';
      const exact = EXACT.has(last);
      return filter.op === 'ne'
        ? !values.some((v) => compare(v, 'eq', filter.value, exact))
        : values.some((v) => compare(v, filter.op, filter.value, exact));
    }
  }
}
