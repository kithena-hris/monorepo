import type { CalendarDate, FormAnswers } from '@kithena/contracts';
import { err, failure, ok, type Result } from '@kithena/domain-kit';

/**
 * Feedback, requests and notes (PRD §12, §13.8, PRF-029, PRF-030). Two
 * company settings, three values each, decide what a writer may choose; the
 * writer sees the outcome in words before sending, and has ten minutes to
 * undo.
 */

export type Choice = 'never' | 'always' | 'writer';

export interface FeedbackSettings {
  /** Who may give feedback at all. */
  readonly who: 'anyone' | 'team' | 'nobody';
  /** Who sees it: the recipient; recipient and manager; recipient, manager and HR. */
  readonly sees: 'recipient' | 'recipient_manager' | 'recipient_manager_hr';
  /** Whether the writer's name is shown to the recipient. */
  readonly names: Choice;
  readonly praise: {
    readonly public: boolean;
    readonly chat: boolean;
    readonly values: readonly string[];
  };
  readonly toneCheck: boolean;
  readonly templates: boolean;
}

export const DEFAULT_FEEDBACK: FeedbackSettings = {
  who: 'anyone',
  sees: 'recipient_manager',
  names: 'writer',
  praise: { public: true, chat: true, values: ['Customer first', 'Own it', 'Ship it', 'Share it'] },
  toneCheck: true,
  templates: true,
};

/** recipient: only them; manager: them and their manager; manager_only: never them; everyone: praise. */
export type Audience = 'recipient' | 'recipient_manager' | 'manager_only' | 'everyone';

export interface Feedback {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: 'feedback' | 'praise' | 'answer';
  readonly body: string;
  readonly templateId: string | null;
  readonly version: number | null;
  readonly answers: FormAnswers | null;
  readonly value: string | null;
  readonly audience: Audience;
  readonly showName: boolean;
  readonly requestId: string | null;
  readonly at: string;
  readonly undone: boolean;
}

/** The audiences a writer may pick, from the company's setting (§12.2, design PF14c). */
export function audiences(settings: FeedbackSettings, praise: boolean): Audience[] {
  if (praise)
    return settings.praise.public
      ? ['everyone', 'recipient_manager', 'recipient']
      : ['recipient_manager', 'recipient'];
  return settings.sees === 'recipient' ? ['recipient'] : ['recipient', 'recipient_manager'];
}

export function checkGive(
  settings: FeedbackSettings,
  input: {
    readonly from: string;
    readonly to: string;
    readonly praise: boolean;
    readonly audience: Audience;
    readonly showName: boolean;
  },
): Result<{ readonly audience: Audience; readonly showName: boolean }> {
  if (settings.who === 'nobody') return err(failure('OFF', 'Feedback is off at this company'));
  if (input.from === input.to) return err(failure('SELF', 'Feedback goes to someone else'));
  if (!audiences(settings, input.praise).includes(input.audience))
    return err(failure('AUDIENCE', 'That audience is not allowed here'));
  // Praise is always named; otherwise the company's rule, or the writer's choice (§12.2, §12.6).
  const showName = input.praise
    ? true
    : settings.names === 'always'
      ? true
      : settings.names === 'never'
        ? false
        : input.showName;
  return ok({ audience: input.audience, showName });
}

export const UNDO_MS = 10 * 60_000;

export function undo(f: Feedback, by: string, now: number): Result<Feedback> {
  if (f.from !== by) return err(failure('FORBIDDEN', 'Only the writer can undo it'));
  if (now - Date.parse(f.at) > UNDO_MS)
    return err(failure('TOO_LATE', 'Ten minutes have passed; it can no longer be undone'));
  return ok({ ...f, undone: true });
}

/** Whether a reader sees a piece of feedback, and the writer's name with it. */
export function readerOf(
  f: Feedback,
  reader: {
    readonly personId: string | null;
    readonly hr: boolean;
    readonly managerOfRecipient: boolean;
  },
): { readonly sees: boolean; readonly name: boolean } {
  if (f.undone) return { sees: f.from === reader.personId, name: true };
  if (f.from === reader.personId) return { sees: true, name: true };
  if (f.audience === 'everyone') return { sees: true, name: true };
  if (f.to === reader.personId) return { sees: f.audience !== 'manager_only', name: f.showName };
  if (reader.managerOfRecipient) return { sees: f.audience !== 'recipient', name: true };
  if (reader.hr) return { sees: false, name: false };
  return { sees: false, name: false };
}

export interface FeedbackRequest {
  readonly id: string;
  readonly from: string;
  readonly about: string;
  readonly to: readonly string[];
  readonly question: string | null;
  readonly templateId: string | null;
  readonly topic: string | null;
  readonly due: CalendarDate | null;
  readonly answered: readonly {
    readonly personId: string;
    readonly feedbackId: string | null;
    readonly declined: boolean;
  }[];
  readonly at: string;
}

export interface Note {
  readonly id: string;
  readonly author: string;
  readonly about: string;
  readonly title: string;
  readonly body: string;
  readonly shared: boolean;
  readonly at: string;
}
