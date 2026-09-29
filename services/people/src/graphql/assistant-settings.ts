import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * Settings set up in words, over GraphQL (docs/ai-settings.md): each field
 * one REST route through `viaRest`, so every rule is REST's and the
 * application layer's.
 *
 * A plan crosses as JSON text. It is a list of changes of eighteen shapes,
 * each already a Zod schema in `domain/assistant/settings-plan.ts` that REST
 * checks on the way back in; a GraphQL union of the same eighteen would be a
 * second, hand-written copy of that one source.
 */
export function defineSettingsAssistant(builder: PeopleBuilder, viaRest: ViaRest): void {
  builder.mutationFields((t) => ({
    proposeSettingsPlan: t.string({
      description:
        'A request in words, as a plan of settings changes for review (JSON). Nothing is changed. People administrators and support only; limited per company.',
      args: { request: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) =>
        JSON.stringify(
          await viaRest(ctx, 'POST', '/v1/assistant/settings/plan', {
            body: { request: args.request },
          }),
        ),
    }),
    applySettingsPlan: t.string({
      description:
        'Apply the changes kept from a plan (JSON: summary, changes, confirmed), each through its own settings command. Answers what was applied (JSON).',
      args: {
        plan: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) =>
        JSON.stringify(
          await viaRest(ctx, 'POST', '/v1/assistant/settings/apply', {
            body: JSON.parse(args.plan) as unknown,
            key: args.idempotencyKey,
          }),
        ),
    }),
    proposeImportFields: t.string({
      description:
        'Fields for the columns of an uploaded import that match none (JSON). The model sees headers and value shapes only. Nothing is changed.',
      args: { uploadId: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) =>
        JSON.stringify(
          await viaRest(ctx, 'POST', '/v1/imports/field-proposals', {
            body: { uploadId: args.uploadId },
          }),
        ),
    }),
  }));
  builder.queryFields((t) => ({
    settingsPrompt: t.string({
      description:
        'A setting, an area or everything, written out as a request "Set up with AI" rebuilds it from. Settings only, never anybody’s data.',
      args: { scope: t.arg.string({ required: true }), key: t.arg.string() },
      resolve: async (_root, args, ctx) => {
        const query = new URLSearchParams({
          scope: args.scope,
          ...(args.key ? { key: args.key } : {}),
        });
        const answer = await viaRest<{ text: string }>(
          ctx,
          'GET',
          `/v1/views/settings-prompt?${query.toString()}`,
        );
        return answer.text;
      },
    }),
  }));
}
