import type { CalendarDate, DocumentTypeKey, Instant, PersonId } from '@kithena/contracts';

import { addDays, dateOf } from '../dates.js';
import { trashEnds } from '../document/document.js';
import { retentionEnds, type DocumentType } from '../type/document-type.js';

/**
 * HR's queues (PRD §12.2, H1, MH6): Expiring and To delete, from documents
 * alone. Missing comes from the checklist; To sign from envelopes (Phase 2).
 * Each is ordered by what goes wrong first.
 */

export const EXPIRING_DAYS = 60;

export interface QueueDocument {
  readonly id: string;
  readonly typeKey: DocumentTypeKey | null;
  readonly subjectPersonId: PersonId | null;
  readonly expiresOn: CalendarDate | null;
  readonly createdAt: Instant;
  readonly deletedAt: Instant | null;
  readonly held: boolean;
}

/** Live documents expiring in the next 60 days, or already expired, soonest first. */
export function expiring<D extends QueueDocument>(docs: readonly D[], today: CalendarDate): D[] {
  const until = addDays(today, EXPIRING_DAYS);
  return docs
    .filter((d) => d.deletedAt === null && d.expiresOn !== null && d.expiresOn <= until)
    .toSorted((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''));
}

/**
 * Live documents whose retention has ended and no hold keeps (PRD §12.3).
 * Nothing is deleted from here without HR confirming.
 */
export function dueForDeletion<D extends QueueDocument>(
  docs: readonly D[],
  types: ReadonlyMap<string, DocumentType>,
  leftOn: (personId: PersonId) => CalendarDate | null,
  today: CalendarDate,
): (D & { readonly retentionEnded: CalendarDate })[] {
  const out: (D & { readonly retentionEnded: CalendarDate })[] = [];
  for (const doc of docs) {
    if (doc.deletedAt !== null || doc.held || doc.typeKey === null) continue;
    const type = types.get(doc.typeKey);
    if (type === undefined) continue;
    const ends = retentionEnds(
      type.retention,
      dateOf(doc.createdAt),
      doc.subjectPersonId === null ? null : leftOn(doc.subjectPersonId),
    );
    if (ends !== null && ends <= today) out.push({ ...doc, retentionEnded: ends });
  }
  return out.toSorted((a, b) => a.retentionEnded.localeCompare(b.retentionEnded));
}

/** Deleted documents whose 30 days are over, whose bytes the sweep destroys. */
export function trashOver<D extends QueueDocument>(docs: readonly D[], today: CalendarDate): D[] {
  return docs.filter((d) => d.deletedAt !== null && !d.held && trashEnds(d.deletedAt) <= today);
}
