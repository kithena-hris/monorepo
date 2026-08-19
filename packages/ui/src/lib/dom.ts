/**
 * Narrowing helpers for values the DOM types describe more loosely than the
 * code needs.
 *
 * Every function here replaces an assertion. That distinction matters: an
 * assertion tells the compiler to stop checking, a guard tells it what was
 * checked. The runtime behaviour differs too, an assertion that is wrong throws
 * somewhere else, later, with a message about the wrong thing.
 */

/**
 * The `Element` an event happened on, or `null`.
 *
 * `EventTarget` is not an `Element`. It can be a `Text` node from a click that
 * landed on a bare string, a `Document`, or a `window`. The usual shortcut is
 * `event.target as HTMLElement`, which is wrong twice over: it crashes on the
 * text-node case when something calls `.closest`, and it is a lie wherever SVG
 * is involved, an `SVGElement` is an `Element` but not an `HTMLElement`, so
 * clicking a chart connector or an icon's path silently claims a type the node
 * does not have.
 *
 * `Element` rather than `HTMLElement` on purpose: `closest`, `matches`,
 * `getAttribute` and `id` all live on `Element`, which is everything this is
 * used for, and it is the widest type that is actually true.
 */
export function elementFrom(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/**
 * The nearest ancestor matching `selector`, starting from the event's target.
 *
 * The pattern this exists for, `(event.target as HTMLElement).closest(sel)`,
 * appears wherever one listener serves many children: pointer handling on a
 * chart, a menu on a board, a drag that must not start on a control.
 */
export function closestFrom(target: EventTarget | null, selector: string): Element | null {
  return elementFrom(target)?.closest(selector) ?? null;
}
