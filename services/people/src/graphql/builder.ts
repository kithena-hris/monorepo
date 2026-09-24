import { createBuilder } from '@kithena/graphql-kit';

/**
 * The People subgraph's one builder, shared by `schema.ts` and `screens.ts`
 * so neither imports the other.
 */

/** Yoga's default context carries the Fetch request; that is all this needs. */
export interface RequestContext {
  readonly request?: { readonly headers: Headers };
}

export const builder = createBuilder<{
  Context: RequestContext;
  Scalars: { Upload: { Input: File; Output: never } };
}>();
export type PeopleBuilder = typeof builder;

builder.scalarType('Upload', {
  description: 'A file, sent as the GraphQL multipart request spec describes.',
  serialize: () => {
    throw new Error('Upload is an input only');
  },
  // Yoga's File, which is not necessarily this realm's global one: a file is
  // what reads like one.
  parseValue: (value) => {
    const file = value as Partial<File> | null;
    if (typeof file?.arrayBuffer === 'function' && typeof file.name === 'string') {
      return file as File;
    }
    throw new Error('Upload expects a file part');
  },
});

export type ViaRest = <T = unknown>(
  ctx: RequestContext,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  options?: { readonly body?: unknown; readonly key?: string },
) => Promise<T>;
