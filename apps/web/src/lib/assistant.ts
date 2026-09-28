import 'server-only';

import { people } from './people';

/**
 * The assistant in the app, across every module the company has.
 *
 * Each module answers questions about its own data, as the person asking and
 * with that module's own rules about what a model may see (People's is the
 * per-field Assistant setting). This asks every module the company bought, at
 * once, and keeps the answers that understood the question: a question about
 * two modules is answered by both, one after the other. A module is one entry
 * here; nothing else changes when the next one ships.
 */

export interface AssistantReply {
  readonly text: string;
  /** People the answer names, to link to. */
  readonly people: readonly { readonly id: string; readonly name: string; readonly title: string | null }[];
  /** Which modules answered: "People". */
  readonly from: readonly string[];
}

interface ModuleAnswer {
  readonly text: string;
  readonly understood: string;
  readonly answered: boolean;
  readonly people: AssistantReply['people'];
}

const MODULES: readonly {
  readonly entitlement: string;
  readonly name: string;
  readonly ask: (question: string, earlier: readonly string[]) => Promise<ModuleAnswer | null>;
}[] = [
  {
    entitlement: 'module.people',
    name: 'People',
    ask: async (question, earlier) => {
      const answer = await people<ModuleAnswer>('Ask', { question, earlier });
      return answer.ok ? answer.data : null;
    },
  },
];

const NOTHING =
  'I’m not sure I can help with that one. Try asking about your people: who is in a team, who reports to whom, how many people work where, or what is waiting for your approval.';

export async function askAcross(
  entitlements: readonly string[],
  question: string,
  earlier: readonly string[],
): Promise<AssistantReply> {
  const mine = MODULES.filter((m) => entitlements.includes(m.entitlement));
  const answers = await Promise.all(
    mine.map(async (m) => ({ module: m.name, answer: await m.ask(question, earlier).catch(() => null) })),
  );
  const answered = answers.filter((a) => a.answer?.answered === true);
  if (answered.length === 0) {
    // A module's own "not for me" is kinder than a generic one when there is only one.
    const only = answers.length === 1 ? answers[0]?.answer : null;
    return { text: only?.text ?? NOTHING, people: [], from: [] };
  }
  return {
    text:
      answered.length === 1
        ? (answered[0]?.answer?.text ?? '')
        : answered.map((a) => `${a.module}\n${a.answer?.text ?? ''}`).join('\n\n'),
    people: answered.flatMap((a) => a.answer?.people ?? []),
    from: answered.map((a) => a.module),
  };
}
