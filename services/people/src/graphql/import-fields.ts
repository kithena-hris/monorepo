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
    planImport: t.string({
      description:
        'Everything the import will do, from HR’s choices: its new fields, the people it creates and updates, who is asked and what HR fills in, over a dry run against the version those fields would make (JSON). Nothing is written.',
      args: {
        input: t.arg.string({
          required: true,
          description: 'JSON: uploadId, the mapping, and the proposals as HR left them',
        }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/imports/plan', {
            body: JSON.parse(args.input) as unknown,
          }),
        ),
    }),
    runImport: t.string({
      description:
        'Approve the plan and run it in the background: set the company up if nothing is published, add and publish the new fields, write the defaults, then import. Answers at once with the run (JSON: runId, status); `importRun` follows it. One run at a time per company. A People administrator’s when it adds fields.',
      args: {
        input: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/imports/run', {
            body: JSON.parse(args.input) as unknown,
            key: args.idempotencyKey,
          }),
        ),
    }),
  }));
  builder.queryFields((t) => ({
    importRun: t.string({
      description:
        'An approved import as it runs and once it is over (JSON): Importing with its step and “312 of 1,000 people”, then Imported with what it did, or Import failed with why. HR, People administrators and whoever approved it.',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        json(viaRest(ctx, 'GET', `/v1/imports/runs/${encodeURIComponent(String(args.id))}`)),
    }),
    activeImportRun: t.string({
      description:
        'The company’s import running now, as `importRun` says it (JSON), or JSON null: another import waits for it. HR and People administrators.',
      resolve: (_root, _args, ctx) =>
        json(
          viaRest<{ run: unknown }>(ctx, 'GET', '/v1/imports/runs/active').then((b) => b.run),
        ),
    }),
  }));
}
