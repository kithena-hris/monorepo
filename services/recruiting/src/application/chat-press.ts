import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { SEALED_FOR, type Press } from './chat.js';
import { contextOf, type Ctx } from './context.js';
import { decideOffer } from './offers.js';
import { decideRequisition } from './requisitions.js';

/* An Approve pressed in the chat app (REC-137). Apart from `chat.ts`, which the use cases it runs call. */

/** An Approve pressed in the chat app, relayed by `platform/slack`: decided as the approver it was sent to. */
export async function chatPress(ctx: Ctx, value: string): Promise<Result<{ text: string }>> {
  const sealer = ctx.deps.sealer;
  const opened =
    sealer === undefined
      ? null
      : sealer.open(
          new Uint8Array(Buffer.from(value.slice(value.indexOf('.') + 1), 'base64url')),
          SEALED_FOR(ctx.caller.tenantId),
        );
  if (opened === null) return err(failure('FORBIDDEN', 'Not a button Recruiting sent'));
  const press = JSON.parse(new TextDecoder().decode(opened)) as Press;
  if (press.until < ctx.today)
    return ok({ text: 'This button has expired. Open the approval in Kithena.' });
  const member = await ctx.tx.members.get(press.personId as never);
  const as = await contextOf(
    ctx.deps,
    ctx.tx,
    {
      ...ctx.caller,
      accountId: member?.accountId ?? 'chat',
      personId: press.personId as never,
    },
    ctx.mail,
  );
  const decided =
    press.kind === 'offer'
      ? await decideOffer(as, press.id, 'approved', null)
      : await decideRequisition(as, press.id, 'approved', null);
  if (!decided.ok) return ok({ text: `Not approved: ${decided.error.message}.` });
  return ok({ text: `Approved, ${ctx.at.slice(0, 10)}.` });
}
