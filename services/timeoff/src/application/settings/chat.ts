import { ok, type Result } from '@kithena/domain-kit';

import {
  DEFAULT_CHAT_ANSWERS,
  switchChatNames,
  type ChatAnswers,
} from '../../domain/settings/chat.js';
import { contextFor, userActor, type Caller, type Deps, type Tx } from '../ports.js';
import { forbidden, isHrAdmin, transact } from '../shared.js';

/**
 * What a chat answer may say about private leave (assistant PRD §11.4,
 * AST-029a): the Integrations page shows it, HR switches it, and the
 * assistant reads it with Time Off's capability catalogue on every question,
 * so switching it off takes effect on the next one.
 */

/** The company's choice, or the default where it never made one. */
export const chatAnswersOf = async (tx: Tx): Promise<ChatAnswers> =>
  (await tx.settings.get('chat_answers')) ?? DEFAULT_CHAT_ANSWERS;

/** HR only. The switch and its event — who, when, which way — in one transaction. */
export const setChatAnswers =
  (deps: Pick<Deps, 'uow' | 'authz' | 'clock' | 'newId'>) =>
  (caller: Caller, input: ChatAnswers): Promise<Result<void>> =>
    transact(deps, caller.tenantId, async (tx) => {
      if (!(await isHrAdmin(deps, caller))) return forbidden();
      const ctx = contextFor(deps, userActor(caller), caller.correlationId, 'UTC');
      const switched = switchChatNames(
        ctx,
        caller.tenantId,
        await chatAnswersOf(tx),
        input.namesPrivateLeave,
      );
      if (switched === null) return ok(undefined);
      await tx.settings.set('chat_answers', switched.setting);
      await tx.outbox.publish([switched.event]);
      return ok(undefined);
    });
