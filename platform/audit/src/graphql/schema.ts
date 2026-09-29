import * as z from 'zod';
import { GraphQLError } from 'graphql';
import { maskError } from 'graphql-yoga';
import { createBuilder, toGraphQLError } from '@kithena/graphql-kit';
import { isTimeZone } from '@kithena/domain-kit';

import type { ActivityPage, readActivity } from '../application/read.js';
import type { StoredEntry } from '../application/ports.js';
import { ACTOR_KINDS, AREAS } from '../domain/entry.js';
import { dayBounds } from '../domain/reading.js';
import { readerFrom } from './caller.js';

/**
 * The audit subgraph: one query, the log, as the router's principal may read
 * it. Thin: the arguments are checked for shape here, and whether this person
 * may read the log at all is `readActivity`'s to say.
 */

interface RequestContext {
  readonly request?: { readonly headers: Headers };
}

export interface Wiring {
  readonly read: ReturnType<typeof readActivity>;
  readonly internalToken: string;
}

let wiring: Wiring | undefined;

/** What the resolvers answer with. Unset, every read is UNAVAILABLE (the SDL still prints). */
export function configureGraphQL(next: Wiring): void {
  wiring = next;
}

const builder = createBuilder<{ Context: RequestContext }>();

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Args = z.object({
  areas: z.array(z.enum(AREAS)).max(AREAS.length).default([]),
  by: z.enum(ACTOR_KINDS).nullable().default(null),
  actor: z.uuid().nullable().default(null),
  subject: z.string().min(1).max(64).nullable().default(null),
  from: Day.nullable().default(null),
  to: Day.nullable().default(null),
  zone: z.string().refine(isTimeZone).nullable().default(null),
  search: z.string().max(200).nullable().default(null),
  before: z.uuid().nullable().default(null),
});

const SupportSignIn = builder
  .objectRef<NonNullable<StoredEntry['supportSignIn']>>('AuditSupportSignIn')
  .implement({
    description: 'The Kithena support sign-in an action by support happened in.',
    fields: (t) => ({
      entryId: t.exposeID('entryId'),
      at: t.exposeString('at'),
      reason: t.exposeString('reason', { nullable: true }),
    }),
  });

const Entry = builder.objectRef<StoredEntry>('AuditEntry').implement({
  description: 'Who did what, when, in words. Never a value.',
  fields: (t) => ({
    id: t.exposeID('id'),
    occurredAt: t.exposeString('occurredAt'),
    recordedAt: t.exposeString('recordedAt'),
    module: t.exposeString('module'),
    area: t.exposeString('area'),
    action: t.exposeString('action'),
    detail: t.exposeString('detail', { nullable: true }),
    actorKind: t.string({ resolve: (e) => e.actor.kind }),
    actorAccountId: t.id({ nullable: true, resolve: (e) => e.actor.accountId }),
    onBehalfOf: t.id({
      nullable: true,
      description: 'The Kithena support operator, when support acted.',
      resolve: (e) => e.actor.onBehalfOf,
    }),
    subjectKind: t.string({ nullable: true, resolve: (e) => e.subject?.kind ?? null }),
    subjectId: t.id({ nullable: true, resolve: (e) => e.subject?.id ?? null }),
    subjectLabel: t.string({ nullable: true, resolve: (e) => e.subject?.label ?? null }),
    reason: t.exposeString('reason', { nullable: true }),
    supportSignIn: t.field({
      type: SupportSignIn,
      nullable: true,
      resolve: (e) => e.supportSignIn,
    }),
  }),
});

const Activity = builder.objectRef<ActivityPage>('AuditActivity').implement({
  description: 'The activity log, newest first, fifty at a time.',
  fields: (t) => ({
    entries: t.field({ type: [Entry], resolve: (p) => [...p.entries] }),
    next: t.id({ nullable: true, resolve: (p) => p.next }),
  }),
});

builder.queryType({
  fields: (t) => ({
    auditActivity: t.field({
      type: Activity,
      description:
        'Who did what, across every module this company has. People administrators, HR and Kithena support.',
      args: {
        areas: t.arg.stringList(),
        by: t.arg.string({ description: 'person, support, system or integration.' }),
        actor: t.arg.id({ description: 'One account’s acts.' }),
        subject: t.arg.id({ description: 'Whose record, or what it was done to.' }),
        from: t.arg.string({ description: 'The first day, YYYY-MM-DD, on the reader’s clock.' }),
        to: t.arg.string({ description: 'The last day, inclusive.' }),
        zone: t.arg.string({ description: 'The reader’s IANA time zone; UTC when absent.' }),
        search: t.arg.string(),
        before: t.arg.id({ description: 'The last entry of the page before.' }),
      },
      resolve: async (_root, raw, ctx) => {
        if (wiring === undefined) {
          throw new GraphQLError('The activity log is not configured here', {
            extensions: { code: 'UNAVAILABLE' },
          });
        }
        const headers = Object.fromEntries(ctx.request?.headers.entries() ?? []);
        const reader = readerFrom({ headers }, wiring.internalToken);
        if (!reader.ok) throw toGraphQLError(reader.error);
        const args = Args.safeParse(
          Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null && v !== undefined)),
        );
        if (!args.success) {
          throw new GraphQLError('That is not a filter the activity log has', {
            extensions: { code: 'BAD_REQUEST' },
          });
        }
        const a = args.data;
        const range = dayBounds(a.from, a.to, a.zone);
        const answer = await wiring.read(reader.value, {
          filter: {
            areas: a.areas,
            actorKind: a.by,
            actor: a.actor,
            subject: a.subject,
            from: range.from,
            until: range.until,
            search: a.search,
          },
          before: a.before,
        });
        if (!answer.ok) throw toGraphQLError(answer.error);
        return answer.value;
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
