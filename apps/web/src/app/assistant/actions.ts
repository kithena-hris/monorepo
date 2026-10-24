'use server';

import { askAcross, type AssistantReply } from '../../lib/assistant';
import { currentPerson } from '../../lib/session';
import { serverWords } from '../../lib/server-words';

/** One question to the assistant, with the conversation's earlier questions for a follow-up. */
export async function askAssistant(
  question: string,
  earlier: readonly string[],
): Promise<AssistantReply> {
  const t = await serverWords();
  const person = await currentPerson();
  if (person === null)
    return {
      text: t(
        'app.assistant.actions.your_session_ended_sign_in_again_to',
        'Your session ended. Sign in again to keep asking.',
      ),
      people: [],
      from: [],
    };
  const q = question.trim().slice(0, 500);
  if (q === '')
    return {
      text: t(
        'app.assistant.actions.ask_me_anything_about_your_people',
        'Ask me anything about your people.',
      ),
      people: [],
      from: [],
    };
  return askAcross(
    person.entitlements,
    q,
    earlier.slice(-5).map((e) => e.slice(0, 500)),
  );
}
