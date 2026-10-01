import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * Insights' "what changed" (design AI5, AI6, MA4, MA5) over GraphQL, as JSON
 * text: the shapes are the Zod schemas and views of
 * `application/screens/what-changed.ts`, and a GraphQL copy of them would be
 * a second, hand-written source. Inputs are checked by REST on the way in.
 * A PDF crosses as base64.
 */
const json = async (promise: Promise<unknown>): Promise<string> => JSON.stringify(await promise);
const period = (args: Readonly<Record<string, string | null | undefined>>): string => {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (typeof v === 'string' && v !== '') query.set(k, v);
  const qs = query.toString();
  return qs === '' ? '' : `?${qs}`;
};
const pdf = async (promise: Promise<unknown>): Promise<string> => {
  const body = await promise;
  return Buffer.from(body as Uint8Array).toString('base64');
};

export function defineWhatChanged(builder: PeopleBuilder, viaRest: ViaRest): void {
  builder.queryFields((t) => ({
    peopleWhatChanged: t.string({
      description:
        'A period’s changes as points, each with its figure and the records behind it, in People’s words (JSON). Nothing goes to a model.',
      args: {
        period: t.arg.string(),
        from: t.arg.string(),
        to: t.arg.string(),
        segment: t.arg.id(),
      },
      resolve: (_root, args, ctx) =>
        json(viaRest(ctx, 'GET', `/v1/views/analytics/what-changed${period(args)}`)),
    }),
    peopleWhatChangedWorded: t.string({
      description:
        'The same points worded by the assistant where there is one (JSON, `byModel`). It is shown placeholders, never a figure or a name.',
      args: {
        period: t.arg.string(),
        from: t.arg.string(),
        to: t.arg.string(),
        segment: t.arg.id(),
      },
      resolve: (_root, args, ctx) =>
        json(viaRest(ctx, 'GET', `/v1/views/analytics/what-changed/worded${period(args)}`)),
    }),
    peopleWhatChangedAsk: t.string({
      description:
        'A follow-up question answered from the points and nothing else (JSON). The model sees the question and placeholders.',
      args: {
        input: t.arg.string({ required: true, description: 'JSON: the period and the question' }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/views/analytics/what-changed/ask', {
            body: JSON.parse(args.input) as unknown,
          }),
        ),
    }),
    peopleSummaryDraft: t.string({
      description:
        'The summary as it would go to somebody, rewritten for what they may see, with why anything was left out (JSON). Writes nothing.',
      args: { input: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/views/analytics/what-changed/summary', {
            body: JSON.parse(args.input) as unknown,
          }),
        ),
    }),
    peopleSummaryPdf: t.string({
      description: 'The summary as edited, on paper: a PDF, base64. Writes nothing.',
      args: { input: t.arg.string({ required: true }) },
      resolve: (_root, args, ctx) =>
        pdf(
          viaRest(ctx, 'POST', '/v1/views/analytics/what-changed/summary/pdf', {
            body: JSON.parse(args.input) as unknown,
          }),
        ),
    }),
    peopleSharedSummary: t.string({
      description: 'A summary sent to you, or by you, while it lasts (JSON).',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        json(viaRest(ctx, 'GET', `/v1/insights/summaries/${encodeURIComponent(args.id)}`)),
    }),
    peopleSharedSummaryPdf: t.string({
      description: 'A summary sent to you, on paper: a PDF, base64.',
      args: { id: t.arg.id({ required: true }) },
      resolve: (_root, args, ctx) =>
        pdf(viaRest(ctx, 'GET', `/v1/insights/summaries/${encodeURIComponent(args.id)}/pdf`)),
    }),
  }));

  builder.mutationFields((t) => ({
    peopleShareSummary: t.string({
      description:
        'Send the summary, as previewed and edited, to one person: stored for them to open signed in, and an email with a link. HR’s.',
      args: {
        input: t.arg.string({ required: true }),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: (_root, args, ctx) =>
        json(
          viaRest(ctx, 'POST', '/v1/insights/summaries', {
            body: JSON.parse(args.input) as unknown,
            key: args.idempotencyKey,
          }),
        ),
    }),
  }));
}
