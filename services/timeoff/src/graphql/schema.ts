import { createBuilder } from '@kithena/graphql-kit';
import { assertEntitled } from '@kithena/auth-kit';

const builder = createBuilder();

/**
 * The Person type is *extended* here, not owned. People owns the key; Time Off
 * contributes leave fields to it through federation. This is what lets a
 * customer mount Time Off against an external people source: the key resolves
 * from whatever fills the People Graph, native or synced.
 */
builder.externalRef('Person', builder.selection<{ id: string }>('id')).implement({
  externalFields: (t) => ({ id: t.id() }),
  fields: (t) => ({
    leaveBalanceDays: t.float({
      resolve: async (person, _args, ctx) => {
        assertEntitled(ctx.auth, 'module.timeoff');
        // Field-level authorization: a colleague is not entitled to this.
        const allowed = await ctx.permissions.check(ctx.auth, 'can_view', {
          type: 'person',
          id: person.id,
        });
        if (!allowed) throw new Error('FORBIDDEN');
        return 0;
      },
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.6',
});
