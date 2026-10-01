import { err, failure, ok, type Result } from '@kithena/domain-kit';

import { REASON_MAX, stateAt, type Approval } from './approval.js';

/**
 * A question about a change, before deciding it (design AI7: "Ask Nora").
 *
 * The decider asks the requester instead of guessing; the requester answers
 * once, in words kept beside the change. Neither decides anything: the
 * change waits as before, and its seven days keep running.
 *
 * - **Asked by someone else**: a requester does not question their own change.
 *   Who may ask — whoever may decide it — is the caller's to establish.
 * - **Answered by the requester alone**, once.
 * - **Only while it waits**: a question about a closed change answers nothing.
 *
 * Pure; the caller brings the clock.
 */

export interface Question {
  readonly id: string;
  readonly changeId: string;
  readonly askedBy: string;
  readonly askedAt: string;
  readonly question: string;
  readonly answer: string | null;
  readonly answeredAt: string | null;
}

function words(text: string, path: string): Result<string> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return err(failure('REASON_REQUIRED', `Write the ${path} first`, [path]));
  }
  if (trimmed.length > REASON_MAX) {
    return err(
      failure('VALUE_INVALID', `A ${path} is at most ${String(REASON_MAX)} characters`, [path]),
    );
  }
  return ok(trimmed);
}

function waiting(change: Approval, at: string): Result<void> {
  const state = stateAt(change, at);
  if (state === 'expired') {
    return err(failure('APPROVAL_EXPIRED', 'This request expired before it was decided'));
  }
  return state === 'pending'
    ? ok(undefined)
    : err(failure('APPROVAL_DECIDED', `This request was already ${state}`));
}

export function askRequester(
  change: Approval,
  ask: { readonly id: string; readonly by: string; readonly question: string; readonly at: string },
): Result<Question> {
  if (ask.by === change.requestedBy) {
    return err(failure('FORBIDDEN', 'You asked for this change; there is nobody to ask'));
  }
  const open = waiting(change, ask.at);
  if (!open.ok) return open;
  const question = words(ask.question, 'question');
  if (!question.ok) return question;
  return ok({
    id: ask.id,
    changeId: change.id,
    askedBy: ask.by,
    askedAt: ask.at,
    question: question.value,
    answer: null,
    answeredAt: null,
  });
}

export function answerQuestion(
  question: Question,
  change: Approval,
  reply: { readonly by: string; readonly answer: string; readonly at: string },
): Result<Question> {
  if (reply.by !== change.requestedBy) {
    return err(failure('FORBIDDEN', 'Only whoever asked for the change answers'));
  }
  if (question.answer !== null) {
    return err(failure('ALREADY_ANSWERED', 'This question was already answered'));
  }
  const open = waiting(change, reply.at);
  if (!open.ok) return open;
  const answer = words(reply.answer, 'answer');
  if (!answer.ok) return answer;
  return ok({ ...question, answer: answer.value, answeredAt: reply.at });
}
