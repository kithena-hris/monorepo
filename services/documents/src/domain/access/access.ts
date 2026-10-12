import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type {
  AccessLevel,
  CalendarDate,
  ConfidentialBy,
  Grantee,
  Permission,
  PersonId,
} from '@kithena/contracts';

/**
 * Who may do what with a document (PRD §6). Pure: every transport asks this,
 * through the application layer, and a resolver never decides.
 *
 * - The owner (whoever created it) opens, edits, shares and deletes it.
 * - The person it is about always opens and downloads it, Confidential or
 *   not (their right of access), and never reshares or deletes it.
 * - HR opens, shares and deletes every filed document (one with a type), and
 *   never somebody's own document unless it is shared with them.
 * - A grant opens a Shared document until its end date; Private ignores it.
 * - Confidential set by HR or the type is lowered only by HR.
 */

export interface Viewer {
  readonly accountId: string;
  readonly personId: PersonId | null;
  readonly teamKey: string | null;
  readonly hr: boolean;
}

export interface Grant {
  readonly grantee: Grantee;
  readonly permission: Permission;
  /** The last day it opens; null for no end. */
  readonly endsOn: CalendarDate | null;
}

export interface AccessFacts {
  readonly ownerAccount: string;
  readonly subjectPersonId: PersonId | null;
  /** It has a document type: the company's, administered by HR. */
  readonly filed: boolean;
  /** The type's audience besides HR; null for somebody's own document. */
  readonly audience: 'subject' | 'everyone' | 'hr' | null;
  readonly level: AccessLevel;
  readonly confidential: boolean;
  readonly confidentialBy: ConfidentialBy | null;
  readonly grants: readonly Grant[];
  readonly deleted: boolean;
}

const isOwner = (doc: AccessFacts, who: Viewer) => doc.ownerAccount === who.accountId;
const isSubject = (doc: AccessFacts, who: Viewer) =>
  doc.subjectPersonId !== null && doc.subjectPersonId === who.personId;
const administers = (doc: AccessFacts, who: Viewer) => who.hr && doc.filed;

function reaches(grant: Grant, who: Viewer, today: CalendarDate): boolean {
  if (grant.endsOn !== null && grant.endsOn < today) return false;
  switch (grant.grantee.kind) {
    case 'everyone':
      return true;
    case 'member':
      return grant.grantee.personId === who.personId;
    case 'team':
      return grant.grantee.teamKey === who.teamKey;
  }
}

/** The grant that reaches this viewer, the strongest first; none on a Private document. */
function grantFor(doc: AccessFacts, who: Viewer, today: CalendarDate): Grant | undefined {
  if (doc.level !== 'shared') return undefined;
  const reaching = doc.grants.filter((g) => reaches(g, who, today));
  return reaching.find((g) => g.permission === 'edit') ?? reaching[0];
}

export function canOpen(doc: AccessFacts, who: Viewer, today: CalendarDate): boolean {
  if (doc.deleted) return isOwner(doc, who) || administers(doc, who);
  if (isOwner(doc, who) || isSubject(doc, who) || administers(doc, who)) return true;
  if (doc.filed && doc.audience === 'everyone') return true;
  return grantFor(doc, who, today) !== undefined;
}

export function canEdit(doc: AccessFacts, who: Viewer, today: CalendarDate): boolean {
  if (doc.deleted) return false;
  if (isOwner(doc, who) || administers(doc, who)) return true;
  return grantFor(doc, who, today)?.permission === 'edit';
}

/** Confidential refuses a download to anyone but its owner, the person it is about, and HR. */
export function canDownload(doc: AccessFacts, who: Viewer, today: CalendarDate): boolean {
  if (!canOpen(doc, who, today) || doc.deleted) return false;
  if (!doc.confidential) return true;
  return isOwner(doc, who) || isSubject(doc, who) || administers(doc, who);
}

/** Whether it is this viewer's to share, make Private, or delete. */
function controls(doc: AccessFacts, who: Viewer): Result<true> {
  if (administers(doc, who)) return ok(true);
  if (isOwner(doc, who)) return ok(true);
  if (isSubject(doc, who)) {
    return err(failure('ABOUT_YOU', 'Documents about you belong to the company and stay as filed'));
  }
  return err(failure('FORBIDDEN', 'Only its owner can change who sees this'));
}

export const canShare = controls;
export const canDelete = controls;

export function canSetConfidential(doc: AccessFacts, who: Viewer, on: boolean): Result<true> {
  const control = controls(doc, who);
  if (!control.ok) return control;
  if (on || who.hr) return ok(true);
  if (doc.confidentialBy === 'hr' || doc.confidentialBy === 'type') {
    return err(failure('HR_PROTECTED', 'HR made this Confidential; only HR can lower it'));
  }
  return ok(true);
}
