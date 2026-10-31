import type * as z from 'zod';
import { maskError } from 'graphql-yoga';
import { toGraphQLError } from '@kithena/graphql-kit';
import { failure, type DomainFailure } from '@kithena/domain-kit';

import { BalanceView } from '../application/screens/views.js';
import { ROUTES, type RestRequest, type RestResponse, type Route } from '../http/rest.js';
import { builder, type RequestContext } from './builder.js';
import { outputTypes, scalarOf, unwrap } from './zod.js';

export type { RequestContext } from './builder.js';

/**
 * The Time Off subgraph (PRD §18, TOF-044). Thin: every field is one of
 * REST's routes (`http/rest.ts`), reached in-process as this request's
 * caller, and decides nothing.
 *
 * - A query per screen, named for it (`timeOffOverview`, `timeOffApprovals`,
 *   …), answering the screen's whole view model, so a screen renders from
 *   one query (§15.2).
 * - A mutation per command, whose `input` is the route's JSON body — parsed
 *   by the route's Zod schema, the one source — and whose `idempotencyKey`
 *   is the route's `Idempotency-Key`, so a retried mutation is answered, not
 *   repeated (People's PEO-113 rule).
 * - `Person.timeOffBalances`, contributed to the People Graph through
 *   federation; Time Off never owns `Person`.
 *
 * A refusal comes back as a GraphQL error carrying the domain's code and
 * field (`toGraphQLError`).
 */

/* ------------------------------------------------------------- wiring -- */

/** REST's dispatcher (`restHandler`), in-process. */
export type RestDispatch = (request: RestRequest) => Promise<RestResponse | null>;

let rest: RestDispatch | null = null;

/** Called once at boot by the composition root. Unconfigured, every field answers UNAVAILABLE. */
export function configureGraphQL(next: { readonly rest: RestDispatch }): void {
  rest = next.rest;
}

function fail(why: DomainFailure): never {
  throw toGraphQLError(why);
}

async function viaRest(
  ctx: RequestContext,
  method: string,
  url: string,
  options: { readonly body?: unknown; readonly key?: string } = {},
): Promise<unknown> {
  if (rest === null) return fail(failure('UNAVAILABLE', 'Time Off is not configured'));
  const headers: Record<string, string> = {};
  for (const [name, value] of ctx.request?.headers.entries() ?? []) {
    // A key comes only from the argument, never from the request that carried the operation.
    if (name !== 'idempotency-key') headers[name] = value;
  }
  if (options.key !== undefined) headers['idempotency-key'] = options.key;
  const answer = await rest({
    method,
    url,
    headers,
    body: options.body === undefined ? '' : JSON.stringify(options.body),
  });
  if (answer === null) return fail(failure('NOT_FOUND', 'No such route'));
  if (answer.status >= 400) {
    const refused = (
      answer.body as { error?: { code?: string; message?: string; path?: string[] } }
    ).error;
    return fail(
      failure(refused?.code ?? 'INTERNAL', refused?.message ?? 'Time Off refused', refused?.path),
    );
  }
  return answer.body;
}

/** The route's path with its parameters filled in, and the rest as a query string on a GET. */
type Args = Record<string, string | number | boolean | null | undefined>;

function urlOf(route: Route, args: Args): string {
  const used = new Set<string>();
  const path = route.path.replaceAll(/\{([a-zA-Z]+)\}/gu, (_m, name: string) => {
    used.add(name);
    return encodeURIComponent(String(args[name]));
  });
  if (route.method !== 'GET') return path;
  const query = new URLSearchParams();
  for (const key of Object.keys(route.params.shape)) {
    const value = args[key];
    if (!used.has(key) && value !== undefined && value !== null) query.set(key, String(value));
  }
  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

/* -------------------------------------------------------------- types -- */

builder.scalarType('JSON', {
  description: 'A JSON value, shaped as the matching REST schema in the OpenAPI document says.',
  serialize: (value) => value,
  parseValue: (value) => value,
});

builder.queryType({});
builder.mutationType({});

const output = outputTypes(builder);

type ArgBuilder = Parameters<Parameters<typeof builder.queryField>[1]>[0]['arg'];

/** A route's parameters as arguments: each a scalar, required unless it may be left out. */
function paramArgs(arg: ArgBuilder, params: z.ZodObject): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params.shape).map(([key, field]) => {
      const { schema, nullable } = unwrap(field as z.ZodType);
      const def = (field as z.ZodType)._zod.def as { type: string };
      const required = !nullable && def.type !== 'default';
      return [key, arg({ type: (scalarOf(schema) ?? 'JSON') as never, required })];
    }),
  );
}

for (const route of ROUTES.filter((r) => r.graphql)) {
  const out = output(route.answer, `TimeOff${route.name}`);
  const field = {
    type: out.type as never,
    nullable: out.nullable as never,
    description: route.summary,
  };
  if (route.method === 'GET') {
    builder.queryField(route.name, (t) =>
      t.field({
        ...field,
        args: paramArgs(t.arg, route.params) as never,
        resolve: (_root, args, ctx) => viaRest(ctx, 'GET', urlOf(route, args as Args)) as never,
      }),
    );
  } else {
    builder.mutationField(route.name, (t) =>
      t.field({
        ...field,
        args: {
          ...paramArgs(t.arg, route.params),
          ...(route.body === null
            ? {}
            : { input: t.arg({ type: 'JSON', required: true, description: 'The REST body' }) }),
          idempotencyKey: t.arg.string({ required: true }),
        } as never,
        resolve: (_root, raw, ctx) => {
          const args = raw as unknown as Args & { idempotencyKey: string; input?: unknown };
          return viaRest(ctx, route.method, urlOf(route, args), {
            ...(route.body === null ? {} : { body: args.input }),
            key: args.idempotencyKey,
          }) as never;
        },
      }),
    );
  }
}

/* ------------------------------------------------------------ federation -- */

/**
 * `Person` is extended, not owned. People owns the key; Time Off contributes
 * the balances, to the person themselves, their approvers and HR, and `null`
 * to anybody else. Against an external people source the key resolves the
 * same way, which is what lets a customer buy Time Off alone.
 */
const balances = output(BalanceView, 'TimeOffBalance');
builder.externalRef('Person', builder.selection<{ id: string }>('id')).implement({
  externalFields: (t) => ({ id: t.id() }),
  fields: (t) => ({
    timeOffBalances: t.field({
      type: [balances.type] as never,
      nullable: { list: true, items: false } as never,
      description: 'Balances per tracked leave type; null when the viewer may not see them.',
      resolve: async (person, _args, ctx) => {
        const answer = (await viaRest(
          ctx,
          'GET',
          `/v1/timeoff/people/${encodeURIComponent(person.id)}/balances`,
        )) as { balances: unknown };
        return answer.balances as never;
      },
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.6',
});

export const yogaOptions = {
  schema,
  graphqlEndpoint: '/graphql',
  multipart: false,
  maskedErrors: {
    // Yoga loads graphql's CommonJS build and `toGraphQLError` its ESM one, so
    // Yoga's `instanceof` takes a domain refusal for an unexpected error and
    // masks its code (People's finding). One raised by `toGraphQLError`
    // carries only a code, a message and a field, so it passes; anything else
    // is masked as before.
    maskError: (error: unknown, message: string, isDev?: boolean) => {
      const original = (error as { originalError?: unknown } | null)?.originalError;
      if (original instanceof Error && original.name === 'GraphQLError') return error as Error;
      return maskError(error, message, isDev);
    },
  },
} as const;
