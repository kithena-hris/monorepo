/**
 * How long a pointer rests before something opens on hover, and how long it
 * may leave before it closes: the sidebar flyout's timings, shared by every
 * hover-opened surface so they all answer a pointer at the same speed.
 *
 * Opening waits a moment so a pointer crossing the item on its way somewhere
 * else opens nothing; closing waits a little longer so the gap between the
 * trigger and the surface can be crossed.
 */
export const HOVER_OPEN_MS = 50;
export const HOVER_CLOSE_MS = 80;
