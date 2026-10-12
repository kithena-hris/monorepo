import { err, failure, ok, type Result } from '@kithena/domain-kit';
import type { PersonId } from '@kithena/contracts';

/**
 * A policy sent for acknowledgement (PRD §11, F2, F3): to everyone, teams or
 * named people. The audience is worked out when it is read, from who works
 * here then, so somebody who joins later is asked too.
 */

export type Audience =
  | { readonly kind: 'everyone' }
  | { readonly kind: 'teams'; readonly teamKeys: readonly string[] }
  | { readonly kind: 'people'; readonly personIds: readonly PersonId[] };

export interface AudienceMember {
  readonly personId: PersonId;
  readonly teamKey: string | null;
  readonly locationKey: string | null;
  readonly status: string;
}

export function checkAudience(a: Audience): Result<Audience> {
  if (a.kind === 'teams' && (a.teamKeys.length === 0 || a.teamKeys.length > 100)) {
    return err(failure('AUDIENCE', 'Choose one to a hundred teams', ['audience']));
  }
  if (a.kind === 'people' && (a.personIds.length === 0 || a.personIds.length > 5000)) {
    return err(failure('AUDIENCE', 'Choose who it goes to', ['audience']));
  }
  return ok(a);
}

export function audienceOf(a: Audience, members: readonly AudienceMember[]): PersonId[] {
  const working = members.filter((m) => m.status !== 'terminated');
  switch (a.kind) {
    case 'everyone':
      return working.map((m) => m.personId);
    case 'teams':
      return working
        .filter((m) => m.teamKey !== null && a.teamKeys.includes(m.teamKey))
        .map((m) => m.personId);
    case 'people':
      return working.filter((m) => a.personIds.includes(m.personId)).map((m) => m.personId);
  }
}

export function progressOf(
  asked: readonly PersonId[],
  acknowledged: ReadonlySet<string>,
): { done: number; of: number; left: PersonId[] } {
  const left = asked.filter((p) => !acknowledged.has(p));
  return { done: asked.length - left.length, of: asked.length, left };
}
