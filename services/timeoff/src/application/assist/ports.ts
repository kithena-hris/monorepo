/**
 * The two kinds of model call Time Off makes (PRD §14.1), as ports.
 *
 * **The domain computes every number.** A model reads a sentence into choices
 * the code offered (`Judge`), ranks options the domain generated (`Judge`), or
 * writes a line about figures the domain computed (`Writer`). Neither ever
 * produces a balance, a count, a date or a validation result.
 *
 * Both are optional on `Deps`, and both answer nothing rather than throw:
 * every caller has a template or a rule of its own, so a screen without a key,
 * a timeout or a refusal at the AI gateway reads the same as one with them,
 * only plainer.
 *
 * **What may be asked.** No health data (sick leave, notes, a due or birth
 * date) and no other person's data: a prompt names nobody, and the person a
 * line is about is a placeholder (`{who}`) filled in after the model answers
 * (`written.ts`). Each feature's test asserts what its prompt carries.
 */

/** One choice among options the code offered; the key of the option, never free text. */
export interface Judgment {
  readonly choice: string;
  readonly confidence: number;
}

export interface JudgeAsk {
  /** What the questions are about: text the person wrote, or facts the domain computed. */
  readonly state: Readonly<Record<string, unknown>>;
  /** Independent questions over the same state, each with the options it may pick from. */
  readonly questions: Readonly<
    Record<
      string,
      {
        readonly instructions: string;
        /** Option key → what it means. */
        readonly options: Readonly<Record<string, string>>;
      }
    >
  >;
}

/** TypeSafe System One, in People's way: typed choices, no prose. */
export interface Judge {
  /** An answer per question it could judge; empty on any failure. */
  choose(tenantId: string, ask: JudgeAsk): Promise<ReadonlyMap<string, Judgment>>;
}

export interface WriteAsk {
  /** What the lines are for, in a sentence or two. */
  readonly instruction: string;
  /** The domain's figures, named. Never a name, a note or anything about health. */
  readonly facts: Readonly<Record<string, unknown>>;
  /** Line key → what that line should say. */
  readonly lines: Readonly<Record<string, string>>;
}

/** The assistant's model behind the AI gateway: short lines, one JSON object per call. */
export interface Writer {
  /** A line per key it wrote; null on any failure. */
  write(tenantId: string, ask: WriteAsk): Promise<Readonly<Record<string, unknown>> | null>;
}

/** One calendar event, as the person's own connected calendar has it. */
export interface CalendarEvent {
  readonly endsAt: string;
  /** Shown to the person beside the suggestion; never to a model. */
  readonly title: string;
  /** "Google Calendar". */
  readonly calendar: string;
}

/**
 * The person's own calendar, when they have connected one (TOF-110): the end
 * times of a day's events, as evidence for when they finished (§11.4). No
 * adapter yet, so no calendar evidence; Kithena's own activity still counts.
 */
export interface CalendarEvidence {
  events(tenantId: string, personId: string, date: string): Promise<readonly CalendarEvent[]>;
}
