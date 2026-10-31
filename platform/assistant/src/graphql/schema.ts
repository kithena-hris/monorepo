import { GraphQLError } from 'graphql';
import { maskError } from 'graphql-yoga';
import { AssistantQuestion, type AssistantAnswer } from '@kithena/contracts';
import { createBuilder, toGraphQLError } from '@kithena/graphql-kit';

import { correlationOf, type Observed } from '../http/server.js';
import { askingFrom } from './caller.js';

/**
 * The assistant subgraph (AST-035, assistant PRD §17 Phase 3): one query,
 * `ask(question)`, for the web, answering what `/internal/ask` answers Slack.
 *
 * Thin: the router's principal is read here and the question checked for
 * shape; who is asking, which modules the company has and what each lets
 * this session see are the use case's, identity's and each module's to say.
 * A view-as or support session is forwarded unchanged, so People answers a
 * view-as read-only and Time Off refuses it in its own words, as on their
 * own screens.
 */

interface RequestContext {
  readonly request?: { readonly headers: Headers };
}

export interface Wiring {
  /** The ask use case, observed. */
  readonly ask: Observed;
  /** What the router presents (`ASSISTANT_API_TOKEN`). Empty: every question is refused. */
  readonly internalToken: string;
}

let wiring: Wiring | undefined;

/** What the resolver answers with. Unset, every question is UNAVAILABLE (the SDL still prints). */
export function configureGraphQL(next: Wiring): void {
  wiring = next;
}

const builder = createBuilder<{ Context: RequestContext }>();

const Question = AssistantQuestion.shape.question;

const Person = builder
  .objectRef<AssistantAnswer['people'][number]>('AssistantAnswerPerson')
  .implement({
    description: 'Somebody the answer names, to link to.',
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      title: t.exposeString('title', { nullable: true }),
    }),
  });

const Answer = builder.objectRef<AssistantAnswer>('AssistantAnswer').implement({
  description:
    'A question in words, answered across every module the company has, as the asker may see it. Every number is a module’s; the model only plans.',
  fields: (t) => ({
    text: t.exposeString('text'),
    understood: t.exposeString('understood', { description: 'How the question was read.' }),
    people: t.field({ type: [Person], resolve: (a) => [...a.people] }),
    answered: t.exposeBoolean('answered', {
      description: 'The question was understood and answered, even with "nobody".',
    }),
  }),
});

builder.queryType({
  fields: (t) => ({
    ask: t.field({
      type: Answer,
      description:
        'One question in words, answered across People, Time Off and every module the company has, as the signed-in person — or the session they are in — may see it.',
      args: { question: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) => {
        if (wiring === undefined) {
          throw new GraphQLError('The assistant is not configured here', {
            extensions: { code: 'UNAVAILABLE' },
          });
        }
        const headers = Object.fromEntries(ctx.request?.headers.entries() ?? []);
        const asking = askingFrom({ headers }, wiring.internalToken);
        if (!asking.ok) throw toGraphQLError(asking.error);
        const question = Question.safeParse(args.question);
        if (!question.success) {
          throw new GraphQLError('Ask a question of up to 500 characters', {
            extensions: { code: 'BAD_REQUEST', field: 'question' },
          });
        }
        return wiring.ask(
          { ...asking.value, question: question.data, channel: 'web' },
          correlationOf(headers),
        );
      },
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.6',
});

/**
 * Yoga's options for this schema. Yoga loads graphql's CommonJS build and
 * `toGraphQLError` its ESM one, so Yoga's `instanceof` takes every refusal for
 * an unexpected error and masks its code — People's finding, People's fix: an
 * error that is a GraphQLError by name passes, anything else is masked.
 */
export const yogaOptions = {
  schema,
  graphqlEndpoint: '/graphql',
  multipart: false,
  maskedErrors: {
    maskError: (error: unknown, message: string, isDev?: boolean) => {
      const original = (error as { originalError?: unknown } | null)?.originalError;
      return original instanceof Error && original.name === 'GraphQLError'
        ? (error as Error)
        : maskError(error, message, isDev);
    },
  },
} as const;
