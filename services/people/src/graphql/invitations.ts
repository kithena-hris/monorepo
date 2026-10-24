import type { InvitationView } from '../application/person/invitations.js';
import type { PeopleBuilder, ViaRest } from './builder.js';

/**
 * A hire's invitation to the company's Kithena, over GraphQL: where it stands
 * for a work email, and sending it now or on a day. Each one REST route through
 * `viaRest`, so who may invite stays the application layer's.
 */
export function defineInvitations(builder: PeopleBuilder, viaRest: ViaRest): void {
  const Invitation = builder.objectRef<InvitationView>('PeopleInvitation').implement({
    description: 'Where a hire stands with their account at the company.',
    fields: (t) => ({
      personId: t.exposeID('personId'),
      status: t.exposeString('status', {
        description: 'The person’s state: pre_hire, onboarding…',
      }),
      state: t.exposeString('state', {
        description: 'not_invited, scheduled (kept for sendOn), invited or signed_up.',
      }),
      sendOn: t.exposeString('sendOn', { nullable: true }),
      sentAt: t.exposeString('sentAt', { nullable: true }),
    }),
  });

  builder.queryFields((t) => ({
    personInvitation: t.field({
      type: Invitation,
      nullable: true,
      description:
        'The invitation of the person holding this work email; null for nobody. HR only.',
      args: { email: t.arg.string({ required: true }) },
      resolve: async (_root, args, ctx) =>
        (
          await viaRest<{ invitation: InvitationView | null }>(
            ctx,
            'GET',
            `/v1/invitations?email=${encodeURIComponent(args.email)}`,
          )
        ).invitation,
    }),
  }));

  builder.mutationFields((t) => ({
    invitePerson: t.field({
      type: Invitation,
      description:
        'Invite a hire to the company: now, or on sendOn (their calendar), with the sign-up page filled in from their record. HR only.',
      args: {
        personId: t.arg.id({ required: true }),
        sendOn: t.arg.string(),
        idempotencyKey: t.arg.string({ required: true }),
      },
      resolve: async (_root, args, ctx) =>
        (
          await viaRest<{ invitation: InvitationView }>(
            ctx,
            'POST',
            `/v1/people/${String(args.personId)}/invitation`,
            { body: { sendOn: args.sendOn ?? null }, key: args.idempotencyKey },
          )
        ).invitation,
    }),
  }));
}
