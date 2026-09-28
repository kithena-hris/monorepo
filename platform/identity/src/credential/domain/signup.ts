import type { SignupQuestion } from '@kithena/contracts';

/**
 * Which of the tenant's sign-up questions this link asks.
 *
 * Never one already answered: identity remembers the keys (never the values)
 * precisely so a returning person is not asked twice. A first enrolment asks
 * the rest. A recovery asks only the required ones — somebody who has lost a
 * device came back for a passkey, and a field that became required since they
 * joined is the one thing worth stopping them for; an optional one waits for
 * People's own missing-information prompts once they are signed in.
 *
 * `purpose` is a string for the reason `EnrolmentRow` gives, and anything but
 * a recovery asks everything unanswered.
 */
export function pendingQuestions(
  questions: readonly SignupQuestion[],
  answered: readonly string[],
  purpose: string,
): SignupQuestion[] {
  const done = new Set(answered);
  return questions.filter((q) => !done.has(q.key) && (purpose !== 'recovery' || q.required));
}
