import type { CalendarDate, DocumentTypeKey, PersonId } from '@kithena/contracts';

import { addDays, daysUntil } from '../dates.js';
import type { DocumentType } from '../type/document-type.js';

/**
 * A person's file (PRD §7.3, B3, MH2): the types required of them, what they
 * have, and the one next action on each. HR's Missing queue is these rows
 * across everyone (§12.2).
 */

export interface MemberFacts {
  readonly personId: PersonId;
  readonly hireDate: CalendarDate | null;
  readonly terminationDate: CalendarDate | null;
  readonly status: string;
}

export interface HeldDocument {
  readonly id: string;
  readonly typeKey: DocumentTypeKey | null;
  readonly expiresOn: CalendarDate | null;
}

export interface OpenRequest {
  readonly id: string;
  readonly typeKey: DocumentTypeKey;
  readonly dueOn: CalendarDate | null;
  readonly askedOn: CalendarDate;
}

export type ChecklistState = 'have' | 'expired' | 'asked' | 'missing';

export interface ChecklistRow {
  readonly typeKey: DocumentTypeKey;
  readonly name: string;
  readonly state: ChecklistState;
  readonly documentId: string | null;
  readonly requestId: string | null;
  /** When it is needed by; null when the person is not a new starter. */
  readonly dueOn: CalendarDate | null;
  readonly expiresOn: CalendarDate | null;
  readonly askedOn: CalendarDate | null;
  /** The one thing to do: view it, remind them, or ask for it. */
  readonly action: 'view' | 'remind' | 'ask';
}

/** Somebody who started in the last 90 days, or has not started yet. */
export function isNewStarter(member: MemberFacts, today: CalendarDate): boolean {
  return member.hireDate !== null && daysUntil(member.hireDate, today) <= 90;
}

function requires(type: DocumentType, member: MemberFacts, today: CalendarDate): boolean {
  if (type.requiredFor === 'everyone') return true;
  return type.requiredFor === 'new_starters' && isNewStarter(member, today);
}

export function checklist(
  member: MemberFacts,
  types: readonly DocumentType[],
  held: readonly HeldDocument[],
  requests: readonly OpenRequest[],
  today: CalendarDate,
): ChecklistRow[] {
  return types
    .filter((type) => requires(type, member, today))
    .map((type) => {
      // The one expiring last is the one that counts.
      const doc = held
        .filter((d) => d.typeKey === type.key)
        .toSorted((a, b) => (b.expiresOn ?? '9999').localeCompare(a.expiresOn ?? '9999'))[0];
      const request = requests.find((r) => r.typeKey === type.key);
      const expired = doc?.expiresOn != null && doc.expiresOn < today;
      const state: ChecklistState =
        doc !== undefined && !expired
          ? 'have'
          : request !== undefined
            ? 'asked'
            : expired
              ? 'expired'
              : 'missing';
      return {
        typeKey: type.key,
        name: type.name,
        state,
        documentId: doc?.id ?? null,
        requestId: request?.id ?? null,
        dueOn:
          type.requiredFor === 'new_starters' && member.hireDate !== null
            ? addDays(member.hireDate, -type.requiredBy)
            : null,
        expiresOn: doc?.expiresOn ?? null,
        askedOn: request?.askedOn ?? null,
        action: state === 'have' ? 'view' : state === 'asked' ? 'remind' : 'ask',
      };
    });
}

/** "3 of 5": what they have, of what is required. */
export const progress = (rows: readonly ChecklistRow[]): { have: number; of: number } => ({
  have: rows.filter((r) => r.state === 'have').length,
  of: rows.length,
});
