import { recordGaps, recordGapsOf } from '../../app/(app)/inbox/pane-actions';

/*
 * Its own module, not `detail-people.tsx`: the list asks ahead from here, and
 * the item's pane, with every module's detail, loads only when an item opens.
 */

export type Gaps = Awaited<ReturnType<typeof recordGaps>>;

/** A hire's record gaps, asked for once per hire and kept for the visit: opened again, at once. */
const gapsAsked = new Map<string, Promise<Gaps>>();
/** Those already answered, for a task to draw with at once, with no wait for a promise. */
const gapsHad = new Map<string, Gaps>();

/** The Inbox was read again (a write): every kept record may have changed. */
export function forgetGaps(): void {
  gapsAsked.clear();
  gapsHad.clear();
}

/** One hire's record was saved: asked again next time. */
export function forgetGap(personId: string): void {
  gapsAsked.delete(personId);
  gapsHad.delete(personId);
}

/** A hire's gaps if they are in already. */
export const gapsNow = (personId: string): Gaps | undefined => gapsHad.get(personId);

/*
 * Hires asked for in the same moment (a list reading ahead its tasks) go to
 * the server together, which reads them side by side: the browser sends its
 * reads one after another, so one each left the last hire waiting behind
 * every other.
 */
interface Together {
  readonly ids: string[];
  readonly answer: Promise<Record<string, Gaps>>;
}
let together: Together | null = null;
/** As many as one read answers (`recordGapsOf`); the next hire starts another. */
const TOGETHER = 12;

export function prefetchGaps(personId: string): Promise<Gaps> {
  let asked = gapsAsked.get(personId);
  if (asked === undefined) {
    if (together === null || together.ids.length >= TOGETHER) {
      const ids: string[] = [];
      const mine: Together = {
        ids,
        answer: new Promise<void>((go) => {
          setTimeout(go, 0);
        }).then(() => {
          if (together === mine) together = null;
          return recordGapsOf(ids);
        }),
      };
      together = mine;
    }
    together.ids.push(personId);
    asked = together.answer.then(
      // Past what one read answers: asked for alone.
      (all) => all[personId] ?? recordGaps(personId),
    );
    asked.then(
      (gaps) => {
        if (gapsAsked.get(personId) !== asked) return;
        // A refusal is shown, and asked again when it is next wanted.
        if (gaps.ok) gapsHad.set(personId, gaps);
        else gapsAsked.delete(personId);
      },
      () => {
        // Not answered: asked again when it is next wanted.
        if (gapsAsked.get(personId) === asked) gapsAsked.delete(personId);
      },
    );
    gapsAsked.set(personId, asked);
  }
  return asked;
}
