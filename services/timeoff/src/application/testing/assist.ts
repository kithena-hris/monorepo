import type { Judge, JudgeAsk, Judgment, Writer, WriteAsk } from '../assist/ports.js';

/**
 * Model ports for tests: they answer what they are told and keep every ask,
 * so a test can say what a prompt carried, and what it did not.
 */

export interface RecordingWriter extends Writer {
  readonly asks: WriteAsk[];
}

/** Answers each line with `answer(key, ask)`; `null` from it leaves that line out. */
export function recordingWriter(
  answer: (key: string, ask: WriteAsk) => string | null = (key) => `Written: ${key}`,
): RecordingWriter {
  const asks: WriteAsk[] = [];
  return {
    asks,
    write(_tenantId, ask) {
      asks.push(ask);
      const out: Record<string, string> = {};
      for (const key of Object.keys(ask.lines)) {
        const line = answer(key, ask);
        if (line !== null) out[key] = line;
      }
      return Promise.resolve(out);
    },
  };
}

export interface RecordingJudge extends Judge {
  readonly asks: JudgeAsk[];
}

/** Answers each question with `answer(id, ask)`; `null` leaves it unanswered. */
export function recordingJudge(
  answer: (id: string, ask: JudgeAsk) => string | null,
): RecordingJudge {
  const asks: JudgeAsk[] = [];
  return {
    asks,
    choose(_tenantId, ask) {
      asks.push(ask);
      const out = new Map<string, Judgment>();
      for (const id of Object.keys(ask.questions)) {
        const choice = answer(id, ask);
        if (choice !== null) out.set(id, { choice, confidence: 0.9 });
      }
      return Promise.resolve(out);
    },
  };
}

/** Everything a model was shown, as one string, for "never carries" assertions. */
export const shown = (asks: readonly (WriteAsk | JudgeAsk)[]): string => JSON.stringify(asks);
