import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { policy, type FieldPolicy } from '../classification.js';
import { JobSearch, PublicJob, PublicListing } from './public.js';

/**
 * `recruiting_public` is readable across companies (PRD §31.2), so nothing
 * that reaches it may be anything but `public` (REC-005). Every leaf of the
 * listing and the job page is walked, through arrays and nullables.
 */

interface Wrapped {
  readonly _zod: { readonly def: { readonly innerType?: z.ZodType; readonly in?: z.ZodType } };
}

function policyOf(schema: z.ZodType): FieldPolicy | undefined {
  let current: z.ZodType | undefined = schema;
  while (current !== undefined) {
    const found = policy.get(current);
    if (found !== undefined) return found;
    const wrapped: Wrapped = current as unknown as Wrapped;
    current = wrapped._zod.def.innerType ?? wrapped._zod.def.in;
  }
  return undefined;
}

function leaves(schema: z.ZodType, path: string, out: [string, FieldPolicy | undefined][]): void {
  const policyHere = policyOf(schema);
  let inner: z.ZodType = schema;
  while (
    inner instanceof z.ZodNullable ||
    inner instanceof z.ZodOptional ||
    inner instanceof z.ZodDefault
  )
    inner = inner.unwrap() as z.ZodType;
  if (inner instanceof z.ZodObject) {
    for (const [key, child] of Object.entries(inner.shape))
      leaves(child as z.ZodType, `${path}.${key}`, out);
  } else if (inner instanceof z.ZodArray) {
    leaves(inner.element as z.ZodType, `${path}[]`, out);
  } else {
    out.push([path, policyHere ?? policyOf(inner)]);
  }
}

describe('the public projection holds public fields only', () => {
  it.each([
    ['listing', PublicListing],
    ['job page', PublicJob],
    ['search', JobSearch],
  ] as const)('%s', (_name, schema) => {
    const out: [string, FieldPolicy | undefined][] = [];
    leaves(schema, '', out);
    expect(out.length).toBeGreaterThan(10);
    expect(
      out.filter(([, found]) => found?.classification !== 'public').map(([path]) => path),
    ).toEqual([]);
  });
});
