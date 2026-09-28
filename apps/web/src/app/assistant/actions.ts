'use server';

import { askAcross, type AssistantReply } from '../../lib/assistant';
import { currentPerson } from '../../lib/session';

/** One question to the assistant, with the conversation's earlier questions for a follow-up. */
export async function askAssistant(
  question: string,
  earlier: readonly string[],
): Promise<AssistantReply> {
  const person = await currentPerson();
  if (person === null) return { text: 'Your session ended. Sign in again to keep asking.', people: [], from: [] };
  const q = question.trim().slice(0, 500);
  if (q === '') return { text: 'Ask me anything about your people.', people: [], from: [] };
  return askAcross(
    person.entitlements,
    q,
    earlier.slice(-5).map((e) => e.slice(0, 500)),
  );
}
