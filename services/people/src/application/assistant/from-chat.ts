import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { effectiveRoles } from '../../domain/access/roles.js';
import { run } from '../person/service.js';
import type { ScreenDeps, Tx } from '../screens/record.js';
import { ask, type AssistantAnswer } from './ask.js';

/**
 * A question from a chat tool (Slack), answered as the person who asked it.
 *
 * The chat tool knows a verified work email and nothing of Kithena; People
 * finds whose it is and answers as their account, with their roles, exactly
 * as it would answer them in the app. Somebody People cannot place — nobody
 * with that email, no account yet, or access ended — gets nothing, and is
 * told so in words that do not say which.
 */

export interface ChatDeps extends ScreenDeps {
  /** The account of the current employee with this work email, or null. */
  readonly accountByEmail: (tx: Tx, tenantId: string, email: string) => Promise<string | null>;
}

export async function askFromChat(
  deps: ChatDeps,
  input: {
    readonly tenantId: string;
    readonly email: string;
    readonly question: string;
    readonly correlationId: string;
  },
): Promise<Result<AssistantAnswer>> {
  const who = await run(deps.service, input.tenantId, async (tx) => {
    const accountId = await deps.accountByEmail(tx, input.tenantId, input.email.trim().toLowerCase());
    if (accountId === null) return ok(null);
    const holder = await deps.service.roles?.of(tx, input.tenantId, accountId);
    return ok({ accountId, roles: effectiveRoles(holder?.roles ?? []) });
  });
  if (!who.ok) return who;
  if (who.value === null) {
    return err(
      failure(
        'NOT_A_KITHENA_USER',
        'I could not find you in Kithena. Ask your HR team to check that your Slack email is your work email there.',
      ),
    );
  }
  return ask(
    deps,
    {
      tenantId: input.tenantId,
      viewer: { accountId: who.value.accountId, roles: who.value.roles },
      correlationId: input.correlationId,
    },
    input.question,
  );
}
