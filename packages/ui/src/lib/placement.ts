/**
 * Boxes placed on a document's pages to be filled in, in the order a reader
 * meets them: a pure model, shared by Reach on the web and on a phone like
 * `motion` and the filter model, so the two never disagree on what comes
 * next. `PlacementLayer` draws the boxes; this says which one is due.
 *
 * A box holds a string. Empty, or `'false'` (a tick taken back), is unfilled.
 */
export interface Placed {
  readonly id: string;
  /** From 1. */
  readonly page: number;
  /** The box's top-left corner, as fractions of the page. */
  readonly x: number;
  readonly y: number;
  readonly required: boolean;
}

/** Page by page, then top to bottom, then left to right. */
export const readingOrder = (a: Placed, b: Placed): number =>
  a.page - b.page || a.y - b.y || a.x - b.x;

export const isFilled = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== 'false';

/**
 * The first box in reading order still unfilled, or null. A box `optional`
 * says is skipped unless it is required: a tick box nobody has to tick is
 * not a step anyone should be walked to.
 */
export function nextToFill<T extends Placed>(
  boxes: readonly T[],
  values: Readonly<Record<string, string>>,
  optional: (box: T) => boolean = () => false,
): T | null {
  return (
    boxes
      .toSorted(readingOrder)
      .find((b) => !isFilled(values[b.id]) && (b.required || !optional(b))) ?? null
  );
}

/** Every required box is filled. */
export const allRequiredFilled = (
  boxes: readonly Placed[],
  values: Readonly<Record<string, string>>,
): boolean => boxes.every((b) => !b.required || isFilled(values[b.id]));
