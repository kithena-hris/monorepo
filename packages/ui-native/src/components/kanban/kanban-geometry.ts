/**
 * The board's drag arithmetic, pure: where a card sits in its column, which
 * slot a lifted card is over, and the board with one card moved. The worklets
 * run on the UI thread every frame of a drag; `moveWithin` is the web's.
 */

/** The space between two cards. Every offset below assumes it. */
export const GAP = 8;

export type LaneCard = { id: string; h: number };

/** A column as the drag sees it, in the board's content coordinates. */
export type Lane = {
  id: string;
  /** The column's left edge and width. */
  x: number;
  w: number;
  /** Where its cards start, inside the column. */
  left: number;
  top: number;
  locked: boolean;
  /** At its limit: refuses a card from another column. */
  full: boolean;
  /** Its cards in the order the props hold them, with their measured heights. */
  cards: LaneCard[];
};

export type Geometry = { lanes: Lane[]; frameW: number; frameH: number; contentW: number };

export function laneOf(g: Geometry, id: string): Lane | undefined {
  'worklet';
  for (const lane of g.lanes) if (lane.id === id) return lane;
  return undefined;
}

/** The column whose centre is nearest `x`. */
export function laneAt(g: Geometry, x: number): Lane | undefined {
  'worklet';
  let found: Lane | undefined;
  let best = Infinity;
  for (const lane of g.lanes) {
    const d = Math.abs(x - (lane.x + lane.w / 2));
    if (d < best) {
      best = d;
      found = lane;
    }
  }
  return found;
}

/** The top of slot `index` in a lane, counting every card but `skip`. */
export function offsetOf(lane: Lane, skip: string, index: number): number {
  'worklet';
  let y = 0;
  let n = 0;
  for (const card of lane.cards) {
    if (card.id === skip) continue;
    if (n === index) break;
    y += card.h + GAP;
    n += 1;
  }
  return y;
}

/** The slot a card centred at `y` takes: past every card whose middle it has crossed. */
export function indexAt(lane: Lane, skip: string, y: number): number {
  'worklet';
  let top = 0;
  let index = 0;
  for (const card of lane.cards) {
    if (card.id === skip) continue;
    if (y <= top + card.h / 2) break;
    index += 1;
    top += card.h + GAP;
  }
  return index;
}

/** The board with one card moved: the throwaway preview a drag renders. */
export function moveWithin<T extends { id: string }>(
  board: Readonly<Record<string, readonly T[]>>,
  itemId: string,
  from: string,
  to: string,
  toIndex: number,
): Record<string, readonly T[]> {
  const source = [...(board[from] ?? [])];
  const position = source.findIndex((item) => item.id === itemId);
  const [moved] = position === -1 ? [] : source.splice(position, 1);
  if (!moved) return board;
  const target = from === to ? source : [...(board[to] ?? [])];
  target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, moved);
  return { ...board, [from]: source, [to]: target };
}
