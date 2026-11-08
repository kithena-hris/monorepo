import { recordGaps } from '../../app/(app)/inbox/pane-actions';

/*
 * Its own module, not `detail-people.tsx`: the list asks ahead from here, and
 * the item's pane, with every module's detail, loads only when an item opens.
 */

export type Gaps = Awaited<ReturnType<typeof recordGaps>>;

/** A hire's record gaps, asked for once per hire and kept for the visit: opened again, at once. */
const gapsAsked = new Map<string, Promise<Gaps>>();

/** The Inbox was read again (a write): every kept record may have changed. */
export function forgetGaps(): void {
  gapsAsked.clear();
}

/** One hire's record was saved: asked again next time. */
export function forgetGap(personId: string): void {
  gapsAsked.delete(personId);
}

export function prefetchGaps(personId: string): Promise<Gaps> {
  let asked = gapsAsked.get(personId);
  if (asked === undefined) {
    asked = recordGaps(personId);
    gapsAsked.set(personId, asked);
  }
  return asked;
}
