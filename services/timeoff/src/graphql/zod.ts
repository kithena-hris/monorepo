import * as z from 'zod';

import type { TimeOffBuilder } from './builder.js';

/**
 * GraphQL types from the Zod schemas REST answers with, so the subgraph's
 * output types are generated rather than written a second time (CLAUDE.md:
 * "never hand-write a derived artifact").
 *
 * An object becomes an object type, named by its `title` or, failing one,
 * after the field that holds it; a string, an enum or a format becomes
 * `String`; an integer `Int`; a union, a record or `unknown` becomes `JSON`,
 * because a GraphQL union needs a type per member and the unions left in the
 * views are the policy language's, which a client hands back whole.
 */

type Scalar = 'String' | 'Int' | 'Float' | 'Boolean' | 'JSON';

/** What a field says about its type, ready for `t.field`. */
export interface Shape {
  /** A scalar's name, an object ref, or a one-element list of either. */
  readonly type: unknown;
  readonly nullable: boolean | { readonly list: boolean; readonly items: boolean };
}

interface Unwrapped {
  readonly schema: z.ZodType;
  readonly nullable: boolean;
}

/** Under the wrappers that change nothing about the type, noting whether any allowed null. */
export function unwrap(schema: z.ZodType): Unwrapped {
  let s = schema;
  let nullable = false;
  for (;;) {
    const def = s._zod.def as {
      type: string;
      innerType?: z.ZodType;
      out?: z.ZodType;
      getter?: () => z.ZodType;
    };
    if (def.type === 'optional' || def.type === 'nullable') nullable = true;
    if (def.innerType !== undefined) s = def.innerType;
    else if (def.type === 'pipe' && def.out !== undefined) s = def.out;
    else if (def.type === 'lazy' && def.getter !== undefined) s = def.getter();
    else return { schema: s, nullable };
  }
}

/** The scalar a leaf maps to, or `null` for an object or a list. */
export function scalarOf(schema: z.ZodType): Scalar | null {
  const def = schema._zod.def as { type: string; values?: readonly unknown[] };
  switch (def.type) {
    case 'string':
    case 'enum':
    case 'template_literal':
      return 'String';
    case 'number':
      return ((schema as z.ZodNumber).format ?? '').includes('int') ? 'Int' : 'Float';
    case 'boolean':
      return 'Boolean';
    case 'literal': {
      const value = def.values?.[0];
      return typeof value === 'boolean'
        ? 'Boolean'
        : typeof value === 'number'
          ? Number.isInteger(value)
            ? 'Int'
            : 'Float'
          : 'String';
    }
    case 'object':
    case 'array':
      return null;
    default:
      return 'JSON';
  }
}

const pascal = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);

const titleOf = (schema: z.ZodType): string | undefined => {
  const title = z.globalRegistry.get(schema)?.title;
  return typeof title === 'string' ? title : undefined;
};

/** Builds and remembers one object type per Zod object. */
export function outputTypes(builder: TimeOffBuilder): (schema: z.ZodType, hint: string) => Shape {
  const refs = new Map<z.ZodType, unknown>();
  const names = new Map<string, z.ZodType>();

  function objectRef(schema: z.ZodObject, hint: string): unknown {
    const known = refs.get(schema);
    if (known !== undefined) return known;
    const name = titleOf(schema) ?? hint;
    if (names.has(name)) throw new Error(`Two output types are called ${name}`);
    names.set(name, schema);
    const ref = builder.objectRef<Record<string, unknown>>(name);
    refs.set(schema, ref);
    // Eagerly, before `implement`: every type exists before the schema is built.
    const fields = Object.entries(schema.shape).map(
      ([key, field]) => [key, shapeOf(field as z.ZodType, `${name}${pascal(key)}`)] as const,
    );
    ref.implement({
      fields: (t) =>
        Object.fromEntries(
          fields.map(([key, shape]) => [
            key,
            t.field({
              type: shape.type as never,
              nullable: shape.nullable as never,
              resolve: (parent) => parent[key] as never,
            }),
          ]),
        ),
    });
    return ref;
  }

  function shapeOf(schema: z.ZodType, hint: string): Shape {
    const { schema: inner, nullable } = unwrap(schema);
    const def = inner._zod.def as { type: string; element?: z.ZodType };
    if (def.type === 'array' && def.element !== undefined) {
      const item = shapeOf(def.element, hint);
      return {
        type: [item.type],
        nullable: { list: nullable, items: item.nullable === true },
      };
    }
    if (def.type === 'object') return { type: objectRef(inner as z.ZodObject, hint), nullable };
    return { type: scalarOf(inner) ?? 'JSON', nullable };
  }

  return shapeOf;
}
