import { createBuilder } from '@hris/graphql-kit';
import { assertEntitled } from '@hris/auth-kit';

const builder = createBuilder();

interface PersonShape {
  id: string;
  givenName: string;
  familyName: string;
  workEmail: string;
}

/** People owns the Person key. Other modules extend it. */
const Person = builder.objectRef<PersonShape>('Person').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    givenName: t.exposeString('givenName'),
    familyName: t.exposeString('familyName'),
    workEmail: t.exposeString('workEmail'),
  }),
});

builder.asEntity(Person, {
  key: builder.selection<{ id: string }>('id'),
  resolveReference: () => null,
});

builder.queryType({
  fields: (t) => ({
    person: t.field({
      type: Person,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      resolve: async (_root, args, ctx) => {
        assertEntitled(ctx.auth, 'module.people');
        const allowed = await ctx.permissions.check(ctx.auth, 'can_view', {
          type: 'person',
          id: args.id,
        });
        return allowed ? null : null;
      },
    }),
  }),
});

export const schema = builder.toSubGraphSchema({
  linkUrl: 'https://specs.apollo.dev/federation/v2.6',
});
