/** Where a released row comes to rest. */
export type SwipeRest = 'closed' | 'open' | 'full';

/** Speed, in pt/s, past which a release follows the flick rather than the distance. */
const FLICK = 500;
/** Fraction of the row's width past which a pull runs the first action. */
const FULL = 0.6;

/**
 * Where a released row settles, the web's rule (`swipeOutcome` in
 * `@reach/ui`'s list item). `offset` is how far the row is pulled open,
 * `velocity` how fast it was moving, positive towards open. Direction wins
 * over position: a flick back closes from anywhere, because that is somebody
 * changing their mind.
 */
export function swipeOutcome({
  offset,
  velocity,
  tray,
  width,
  full,
}: {
  offset: number;
  velocity: number;
  tray: number;
  width: number;
  full: boolean;
}): SwipeRest {
  'worklet';
  if (velocity < -FLICK) return 'closed';
  if (full && width > 0 && offset >= width * FULL) return 'full';
  if (velocity > FLICK) return 'open';
  return offset >= tray / 2 ? 'open' : 'closed';
}
