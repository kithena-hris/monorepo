import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * New information in an import's file, over GraphQL (docs/ai-settings.md):
 * each field one REST route through `viaRest`, so every rule is REST's and
 * the application layer's.
 *
 * The proposals cross as JSON text. Their shape is the Zod schema in
 * `domain/import/new-fields.ts`, which REST checks on the way back in; a
 * GraphQL copy of it would be a second, hand-written source.
 */
export function defineImportFields(builder: PeopleBuilder, viaRest: ViaRest): void {
  const json = async (promise: Promise<unknown>): Promise<string> => JSON.stringify(await promise);
  builder.mutationFields((t) => ({
    proposeImportFields: t.string({
      description:
        'Fields proposed for the columns of an uploaded import that match none, and what happens for people already here (JSON). The model sees headers and value shapes only. Nothing is written.',
      args: {
        step: t.arg.string({
          required: true,
          description: 'JSON: uploadId and the mapping so far',
        }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/imports/new-fields', {
            body: JSON.parse(args.step) as unknown,
          }),
        ),
    }),
    reviewImportFields: t.string({
      description:
        'The proposals as HR left them, checked, with the review in words (JSON). Nothing is written.',
      args: { input: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/imports/new-fields/review', {
            body: JSON.parse(args.input) as unknown,
          }),
        ),
    }),
    addImportFields: t.string({
      description:
        'Add the reviewed fields, publish them and write the defaults, in one transaction. A People administrator’s.',
      args: {
        input: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/imports/new-fields/apply', {
            body: JSON.parse(args.input) as unknown,
            key: args.idempotencyKey,
          }),
        ),
    }),
  }));
}
