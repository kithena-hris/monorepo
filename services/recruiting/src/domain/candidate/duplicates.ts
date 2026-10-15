/**
 * Duplicate candidates (Recruiting PRD §11.2, REC-020).
 *
 * Matched by email first, then phone, then name with the same CV. Only an
 * email match joins an application to the existing candidate on its own;
 * anything weaker is shown side by side as "possibly the same person", and
 * merging is a person's decision.
 */

export interface CandidateKey {
  readonly id: string;
  readonly email: string;
  readonly phone: string | null;
  readonly name: string;
  /** SHA-256 of the CV's bytes; null without a CV. */
  readonly cvHash: string | null;
}

export type Match =
  | { readonly kind: 'same'; readonly candidateId: string; readonly by: 'email' }
  | {
      readonly kind: 'possible';
      readonly candidateId: string;
      readonly by: 'phone' | 'name_and_cv';
    };

/** Lowercased, trimmed; Gmail-style `+tags` are kept, because they are a different inbox. */
export const normalEmail = (email: string): string => email.trim().toLowerCase();

/** Digits only, with a leading `+` kept; a national number without a code matches on its last 9 digits. */
export function normalPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/gu, '');
  return digits.startsWith('+') ? digits : digits.replace(/^0+/u, '');
}

const phoneTail = (phone: string) => normalPhone(phone).replace(/^\+/u, '').slice(-9);

/** Case, accents and spacing ignored: "José  Ruiz" is "jose ruiz". */
export const normalName = (name: string): string =>
  name.normalize('NFKD').replace(/[̀-ͯ]/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();

export function findMatches(
  incoming: Omit<CandidateKey, 'id'>,
  existing: readonly CandidateKey[],
): Match[] {
  const email = normalEmail(incoming.email);
  const same = existing.find((c) => normalEmail(c.email) === email);
  if (same !== undefined) return [{ kind: 'same', candidateId: same.id, by: 'email' }];
  const out: Match[] = [];
  for (const candidate of existing) {
    if (
      incoming.phone !== null &&
      candidate.phone !== null &&
      phoneTail(incoming.phone).length >= 7 &&
      phoneTail(incoming.phone) === phoneTail(candidate.phone)
    ) {
      out.push({ kind: 'possible', candidateId: candidate.id, by: 'phone' });
    } else if (
      incoming.cvHash !== null &&
      incoming.cvHash === candidate.cvHash &&
      normalName(incoming.name) === normalName(candidate.name)
    ) {
      out.push({ kind: 'possible', candidateId: candidate.id, by: 'name_and_cv' });
    }
  }
  return out;
}

/**
 * A merge, decided by a person: the survivor keeps its id; every application,
 * file, note and pool membership of the other moves to it; the other is
 * tombstoned with a pointer, never deleted, so the decision can be undone.
 */
export interface MergeDecision {
  readonly survivorId: string;
  readonly absorbedId: string;
  readonly by: string;
  readonly at: string;
}

export function mergeDecision(
  survivorId: string,
  absorbedId: string,
  by: string,
  at: string,
): MergeDecision | null {
  return survivorId === absorbedId ? null : { survivorId, absorbedId, by, at };
}
