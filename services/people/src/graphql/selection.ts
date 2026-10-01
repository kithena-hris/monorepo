import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * Search and export in words, over GraphQL (docs/ai-settings.md): each a
 * REST route through `viaRest`, so every rule is REST's and the application
 * layer's. The plan crosses as JSON text, as the import's proposals do: its
 * shape is `application/assistant/selection.ts`, and a GraphQL copy of it
 * would be a second, hand-written source. Neither writes anything.
 */
export function defineSelectionPlans(builder: PeopleBuilder, viaRest: ViaRest): void {
  const json = async (promise: Promise<unknown>): Promise<string> => JSON.stringify(await promise);
  builder.queryFields((t) => ({
    peopleDirectoryPlan: t.string({
      description:
        'What somebody typed in the directory, as its own filters and order (JSON). A name alone is a name search. The model, where there is one, sees the sentence and field names only.',
      args: {
        sentence: t.arg.string({ required: true }),
        remembered: t.arg.string({
          description:
            'The readings this person chose before, as JSON: {"leaving":"Have given notice"}. Absent: none.',
        }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/views/directory/plan', {
            body: {
              sentence: args.sentence,
              ...(args.remembered == null ? {} : { remembered: rememberedOf(args.remembered) }),
            },
          }),
        ),
    }),
    peopleExportPlan: t.string({
      description:
        'An export described in words, as the builder’s own choices and a drafted reason (JSON). Nothing is exported.',
      args: { sentence: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        json(viaRest(ctx, 'POST', '/v1/views/export/plan', { body: { sentence: args.sentence } })),
    }),
  }));
  // Smart search's "Remind all" (docs/ai-settings.md): a write, through REST's rules.
  builder.mutationFields((t) => ({
    peopleRemindDirectory: t.string({
      description:
        'Ask everybody these conditions find for the details the conditions find empty, as the profile asks one person (JSON: asked, emailed, skipped, more).',
      args: {
        conditions: t.arg.string({
          required: true,
          description: 'The directory’s conditions, as JSON.',
        }),
        match: t.arg.string(),
        search: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/views/directory/remind', {
            body: {
              conditions: conditionsOf(args.conditions),
              ...(args.match == null ? {} : { match: args.match }),
              ...(args.search == null ? {} : { search: args.search }),
            },
            key: args.idempotencyKey,
          }),
        ),
    }),
  }));
}

/** The conditions as sent; REST checks every part of them again. */
function conditionsOf(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
}

/** The remembered readings as sent; anything that is not an object of strings is none. */
function rememberedOf(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(
          Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
        )
      : {};
  } catch {
    return {};
  }
}
