import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * An export sent to somebody else, over GraphQL (design AI13, AI14, MA10):
 * each field one REST route through `viaRest`, so every rule is REST's and
 * the application layer's. Inputs and answers cross as JSON text, as the
 * export plan's do: their shape is `application/export/share.ts`, checked
 * there with Zod, and a GraphQL copy would be a second, hand-written source.
 */
export function defineExportShare(builder: PeopleBuilder, viaRest: ViaRest): void {
  const json = async (promise: Promise<unknown>): Promise<string> => JSON.stringify(await promise);
  const id = (raw: string | number) => encodeURIComponent(String(raw));
  builder.queryFields((t) => ({
    peopleExportSharePreview: t.string({
      description:
        'Whom an export would go to — picked, or read from the sentence by People, never by the model — what they could not read themselves, and who would approve it (JSON). Nothing is built.',
      args: {
        input: t.arg.string({ required: true, description: 'JSON: choice, recipient, sentence' }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/exports/share/preview', {
            body: JSON.parse(args.input) as unknown,
          }),
        ),
    }),
    peopleExportShare: t.string({
      description:
        'A request to send an export, for its requester, its recipient or a People administrator (JSON).',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) => json(viaRest(ctx, 'GET', `/v1/exports/share/${id(args.id)}`)),
    }),
    peopleExportSharesToDecide: t.string({
      description:
        'The requests to send an export this viewer may decide now, oldest first (JSON): a People administrator’s, never one they asked for or would receive.',
      resolve: (_root, _args, ctx) => json(viaRest(ctx, 'GET', '/v1/exports/share')),
    }),
    peopleExportRecord: t.string({
      description:
        'A finished export for its requester or recipient: where it went, what it holds, its About and its links (JSON).',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) => json(viaRest(ctx, 'GET', `/v1/exports/${id(args.id)}/record`)),
    }),
  }));
  builder.mutationFields((t) => ({
    shareExport: t.string({
      description:
        'Send an export: now, when the recipient could read all of it themselves; otherwise as a request a People administrator approves (JSON).',
      args: {
        input: t.arg.string({ required: true, description: 'JSON: choice and recipient' }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/exports/share', {
            body: JSON.parse(args.input) as unknown,
            key: args.idempotencyKey,
          }),
        ),
    }),
    decideExportShare: t.string({
      description:
        'Approve or reject sending an export; approved, it is built and sent (JSON). A People administrator who is neither asking nor receiving.',
      args: {
        id: t.arg.id({ required: true }),
        approve: t.arg.boolean({ required: true }),
        note: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', `/v1/exports/share/${id(args.id)}/decision`, {
            body: { approve: args.approve, ...(args.note ? { note: args.note } : {}) },
            key: args.idempotencyKey,
          }),
        ),
    }),
  }));
}
