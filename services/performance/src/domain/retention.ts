import type { CalendarDate } from '@kithena/contracts';

/**
 * Retention (PRD §30, PRF-046): how long after a person leaves each kind of
 * their record is kept, and so what is due to go. Nothing here deletes:
 * deletion is HR confirming a batch, and a legal hold keeps everything of the
 * person it names, whatever the rule says.
 *
 * - reviews: reviews and nominations about the person, their ratings and goals;
 * - feedback: feedback they received and the requests about them;
 * - notes: notes about them; their own notes go 30 days after they leave;
 * - learning: their assignments and attendance;
 * - ai: what AI wrote for them.
 */

export const RETENTION_KINDS = ['reviews', 'feedback', 'notes', 'learning', 'ai'] as const;
export type RetentionKind = (typeof RETENTION_KINDS)[number];

export interface RetentionRule {
  readonly reviewsYears: number;
  readonly feedbackYears: number;
  readonly notesYears: number;
  readonly learningYears: number;
  readonly aiYears: number;
}

/** A leaver's own notes, whatever the rule: the author's, gone 30 days after they leave (§30). */
export const OWN_NOTES_DAYS = 30;

const YEARS: Readonly<Record<RetentionKind, keyof RetentionRule>> = {
  reviews: 'reviewsYears',
  feedback: 'feedbackYears',
  notes: 'notesYears',
  learning: 'learningYears',
  ai: 'aiYears',
};

function shifted(day: CalendarDate, years: number, days = 0): CalendarDate {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y + years, m - 1, d + days)).toISOString().slice(0, 10) as CalendarDate;
}

/** The day a leaver's records of one kind are due to go. */
export const dueOn = (leftOn: CalendarDate, kind: RetentionKind, rule: RetentionRule): CalendarDate =>
  shifted(leftOn, rule[YEARS[kind]]);

/** The day a leaver's own notes are due to go. */
export const ownNotesDueOn = (leftOn: CalendarDate): CalendarDate =>
  shifted(leftOn, 0, OWN_NOTES_DAYS);

export interface Due {
  readonly personId: string;
  readonly leftOn: CalendarDate;
  /** The kinds whose day has come. */
  readonly kinds: readonly RetentionKind[];
  /** Their own notes' day has come. */
  readonly ownNotes: boolean;
}

/**
 * Whose records are due today, and of which kinds: leavers with a known last
 * day, not on hold. A leaver without a date is never due: nothing is deleted
 * on a guess.
 */
export function dueNow(
  leavers: readonly { readonly personId: string; readonly leftOn: CalendarDate | null }[],
  held: ReadonlySet<string>,
  rule: RetentionRule,
  today: CalendarDate,
): readonly Due[] {
  return leavers.flatMap((l) => {
    if (l.leftOn === null || held.has(l.personId)) return [];
    const leftOn = l.leftOn;
    const kinds = RETENTION_KINDS.filter((k) => dueOn(leftOn, k, rule) <= today);
    const ownNotes = ownNotesDueOn(leftOn) <= today;
    return kinds.length === 0 && !ownNotes ? [] : [{ personId: l.personId, leftOn, kinds, ownNotes }];
  });
}
